/**
 * LibreOffice WASM Converter
 *
 * Uses @matbee/libreoffice-converter WorkerBrowserConverter for document conversion.
 *
 * Key design decisions:
 * 1. Uses WorkerBrowserConverter instead of BrowserConverter — runs WASM in a
 *    dedicated Web Worker, avoiding main-thread blocking and eliminating the need
 *    for fragile loadModule patches / Cloudflare Rocket Loader workarounds
 * 2. Downloads the engine as the committed soffice.wasm.bin.gz / soffice.data.bin.gz and
 *    decompresses them in the browser (./gzip.ts). Every host serves those as plain bytes, so
 *    no gzip_static / Content-Encoding / MIME setup is involved, and byte ranges map onto the
 *    file, so downloads resume and cache in parts (../utils/asset-loader.ts). Deployments that
 *    only ship the decompressed .bin files still work (fallback). The desktop build skips all of
 *    that and reads the bundled .bin: a file inside the app needs no ranges and no part cache.
 * 3. Specifies browserWorkerJs for the library's internal worker communication
 * 4. Checks SharedArrayBuffer and the Content-Security-Policy upfront — fails fast with a clear
 *    error before downloading anything
 * 5. The ?v= cache key is generated from the asset contents (./asset-version.ts), so a changed
 *    engine can never be served under a URL browsers already cached as immutable
 *
 * IMPORTANT: The browser.worker.global.js in public/libreoffice-wasm/ MUST match
 * the version from @matbee/libreoffice-converter/dist/. Do NOT modify it — the
 * library's WorkerBrowserConverter expects an unmodified worker script. If you
 * need CJK font support, fonts must be pre-baked into soffice.data.
 *
 * How pthreads work:
 * - soffice.js (Emscripten glue) creates 4 pthread Workers via
 *   new Worker(Module["mainScriptUrlOrBlob"]) — loading soffice.js itself
 * - Each pthread Worker detects ENVIRONMENT_IS_PTHREAD from self.name ("em-pthread-N")
 * - These are NESTED Workers (created from inside the browser.worker.global.js Worker)
 * - They must NOT run from a Blob URL parent, or nested Worker creation breaks
 */

import { WorkerBrowserConverter } from '@matbee/libreoffice-converter/browser';
import {
    AssetHttpError,
    deleteCachedAsset,
    fetchAssembledBlob,
    pruneCachedAssets,
    type FetchProgress,
} from '../utils/asset-loader';
import { withBasePath } from '../utils/path';
import { isTauri } from '../tauri-bridge';
import { LIBREOFFICE_ASSET_VERSION } from './asset-version';
import { detectLibreOfficeCspBlockers } from './csp-probe';
import { describeWorkerSupport } from './worker-probe';
import { gunzipBlobIfNeeded } from './gzip';

const LIBREOFFICE_PATH = withBasePath('/libreoffice-wasm/');
/** Content-derived; regenerate with `node scripts/libreoffice-asset-version.mjs --write`. */
const ASSET_VERSION = LIBREOFFICE_ASSET_VERSION;
// Decompressed engine files: streamed directly under Tauri, and a fallback for deployments
// that ship only these.
const SOFFICE_WASM_FILE = 'soffice.wasm.bin';
const SOFFICE_DATA_FILE = 'soffice.data.bin';
// What browsers download: the committed gzip files, decompressed client-side.
const SOFFICE_WASM_GZ = `${SOFFICE_WASM_FILE}.gz`;
const SOFFICE_DATA_GZ = `${SOFFICE_DATA_FILE}.gz`;
const FONT_PATH = '/fonts/NotoSansSC-Regular.ttf';
/** The worker used to hang forever if the engine never reported ready; bound it. */
const ENGINE_START_TIMEOUT_MS = 5 * 60 * 1000;
/** getRegistrations() can hang on a custom protocol (Tauri) instead of rejecting. */
const SERVICE_WORKER_PROBE_TIMEOUT_MS = 5 * 1000;
/** A blocked blob: fetch rejects immediately; only a stuck protocol handler takes this long. */
const CSP_PROBE_TIMEOUT_MS = 5 * 1000;
/**
 * Bounds the *stall*, not the total: reading ~250MB out of the app bundle is as slow as the
 * platform's asset protocol is, and on the desktop build that is slow enough to matter — the
 * engine start-up it used to sit inside had a 120s budget and blew it. A total cap would just
 * move that failure here, so the read may take as long as it likes provided bytes keep arriving.
 */
const BUNDLE_STALL_TIMEOUT_MS = 60 * 1000;
const MB = 1024 * 1024;

interface EngineFile {
    label: string;
    gz: string;
    raw: string;
    type: string;
    estimatedBytes: number;
}

const ENGINE_FILES: EngineFile[] = [
    { label: 'soffice.wasm', gz: SOFFICE_WASM_GZ, raw: SOFFICE_WASM_FILE, type: 'application/wasm', estimatedBytes: 48 * MB },
    { label: 'soffice.data', gz: SOFFICE_DATA_GZ, raw: SOFFICE_DATA_FILE, type: 'application/octet-stream', estimatedBytes: 28 * MB },
];
const FONT_ESTIMATED_BYTES = 16.4 * MB;

function normalizeBasePath(path: string): string {
    return path.endsWith('/') ? path : `${path}/`;
}

function isLibreOfficeAssetUrl(url: URL): boolean {
    return url.pathname.includes('/libreoffice-wasm/') || url.pathname.endsWith(FONT_PATH);
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
        promise.finally(() => clearTimeout(timer)),
        new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(message)), ms);
        }),
    ]);
}

export interface LoadProgress {
    phase: 'loading' | 'initializing' | 'converting' | 'complete' | 'ready';
    percent: number;
    message: string;
}

export type ProgressCallback = (progress: LoadProgress) => void;

// Singleton for converter instance
let converterInstance: LibreOfficeConverter | null = null;

export class LibreOfficeConverter {
    private converter: WorkerBrowserConverter | null = null;
    private initialized = false;
    private initPromise: Promise<void> | null = null;
    private basePath: string;
    /** Total size of the engine downloads in MB, computed during environment check */
    private totalAssetSizeMB = 0;
    /** Once the downloads are done, progress refers to the worker starting the engine */
    private downloadsComplete = false;
    /** Replaceable progress callback — allows late-binding when preload started without one */
    private progressCallback?: ProgressCallback;
    /** Track Blob URLs for cleanup */
    private blobUrls: string[] = [];

    constructor(basePath?: string) {
        this.basePath = normalizeBasePath(basePath || LIBREOFFICE_PATH);
    }

    async initialize(onProgress?: ProgressCallback): Promise<void> {
        // Allow hot-swapping the progress callback even if init is already in flight.
        // This covers the case where preload started silently (no callback), and later
        // the user clicks "Convert" which provides a real callback.
        if (onProgress) this.progressCallback = onProgress;

        if (this.initialized) return;

        // If already initializing, wait for the existing promise
        if (this.initPromise) return this.initPromise;

        this.initPromise = this._doInitialize();
        try {
            await this.initPromise;
        } catch (e) {
            // Allow retry on failure
            this.initPromise = null;
            throw e;
        }
    }

    /**
     * Build a human-readable progress message for the engine start-up phase.
     */
    private buildProgressMessage(info: { percent: number; message?: string }): string {
        // The worker says what it is actually doing — "Compiling WebAssembly module...",
        // "Setting up filesystem...", "Initializing LibreOfficeKit...". Keep it: when start-up
        // stalls, the phase on screen is the only clue a build without devtools can give.
        const reported = info.message?.trim();
        if (this.downloadsComplete && reported) {
            return `${reported} (${Math.round(info.percent)}%)`;
        }
        if (info.percent >= 95 && info.percent < 100) {
            return 'Initializing conversion engine...';
        }
        if (this.downloadsComplete) {
            return `Starting conversion engine (${Math.round(info.percent)}%)...`;
        }
        if (this.totalAssetSizeMB > 0 && info.percent < 95) {
            const downloadedMB = (info.percent / 100 * this.totalAssetSizeMB).toFixed(1);
            const totalMB = this.totalAssetSizeMB.toFixed(1);
            return `Downloading: ${downloadedMB} MB / ${totalMB} MB`;
        }
        return `Loading conversion engine (${Math.round(info.percent)}%)...`;
    }

    /**
     * Aggregated byte progress across the engine files, mapped onto the 0-90% loading band.
     */
    private trackProgress(totals: Record<string, number>, verb: string) {
        const loaded: Record<string, number> = {};
        return (key: string) => (loadedBytes: number, totalBytes: number) => {
            loaded[key] = loadedBytes;
            if (totalBytes > 0) totals[key] = totalBytes;
            const total = Object.values(totals).reduce((a, b) => a + b, 0);
            const done = Object.values(loaded).reduce((a, b) => a + b, 0);
            this.progressCallback?.({
                phase: 'loading',
                percent: Math.min(90, Math.round((done / total) * 90)),
                message: `${verb}: ${(done / MB).toFixed(1)} MB / ${(total / MB).toFixed(1)} MB`,
            });
        };
    }

    /**
     * Reads a file the desktop bundle ships, reporting progress as it arrives. Deliberately plain:
     * a file inside the app needs no Range requests, no part cache and no gzip step, and each of
     * those would cost another full copy of a 150MB file inside the WebView.
     */
    private async readBundledFile(
        url: string,
        label: string,
        onProgress: (loadedBytes: number, totalBytes: number) => void,
    ): Promise<Blob> {
        const stalled = (what: string) =>
            `Reading ${label} from the app bundle stalled: ${what} for ` +
            `${BUNDLE_STALL_TIMEOUT_MS / 1000}s. Restart the app and try again.`;
        const res = await withTimeout(fetch(url), BUNDLE_STALL_TIMEOUT_MS, stalled('no response'));
        if (!res.ok) {
            throw new Error(`The app bundle did not return ${label} (HTTP ${res.status}).`);
        }
        const declared = Number(res.headers.get('content-length')) || 0;
        if (!res.body) {
            const whole = await res.blob();
            onProgress(whole.size, whole.size);
            return whole;
        }
        const reader = res.body.getReader();
        const chunks: BlobPart[] = [];
        let loaded = 0;
        for (;;) {
            const { done, value } = await withTimeout(
                reader.read(),
                BUNDLE_STALL_TIMEOUT_MS,
                stalled(`no data after ${(loaded / MB).toFixed(1)}MB`),
            );
            if (done) break;
            chunks.push(value as BlobPart);
            loaded += value.byteLength;
            onProgress(loaded, declared);
        }
        return new Blob(chunks);
    }

    /**
     * Downloads one engine file (the .gz, or the decompressed .bin on older deployments) and
     * returns its decompressed bytes.
     */
    private async fetchEngineFile(file: EngineFile, onProgress: (p: FetchProgress) => void): Promise<Blob> {
        let sourceUrl = `${this.basePath}${file.gz}?v=${ASSET_VERSION}`;
        let blob: Blob;
        try {
            blob = await fetchAssembledBlob(sourceUrl, onProgress);
        } catch (e) {
            if (!(e instanceof AssetHttpError && e.status === 404)) throw e;
            sourceUrl = `${this.basePath}${file.raw}?v=${ASSET_VERSION}`;
            console.warn(`[LibreOffice] ${file.gz} not found, falling back to ${file.raw}`);
            blob = await fetchAssembledBlob(sourceUrl, onProgress);
        }

        this.progressCallback?.({ phase: 'loading', percent: 91, message: 'Decompressing conversion engine...' });
        try {
            return await gunzipBlobIfNeeded(blob, file.type);
        } catch (e) {
            // A corrupt cached copy (e.g. storage evicted mid-write): drop it and download once more.
            console.warn(`[LibreOffice] ${file.label} failed to decompress, downloading it again:`, e);
            await deleteCachedAsset(sourceUrl);
            return gunzipBlobIfNeeded(await fetchAssembledBlob(sourceUrl, onProgress), file.type);
        }
    }

    private async _doInitialize(): Promise<void> {
        try {
            this.progressCallback?.({ phase: 'loading', percent: 0, message: 'Checking environment...' });

            // Fail fast if SharedArrayBuffer / COOP+COEP / CSP is not in place
            await this.checkEnvironment();

            const totalInfo = this.totalAssetSizeMB > 0
                ? ` (${this.totalAssetSizeMB.toFixed(1)} MB to download)`
                : '';
            this.progressCallback?.({ phase: 'loading', percent: 5, message: `Loading conversion engine${totalInfo}...` });

            // Both paths end at blob: URLs, because the library's worker starts a 120 second
            // initialization timeout *before* Emscripten fetches the engine — so whatever is still
            // on the wire then is spending that budget. On the desktop build, moving ~250MB through
            // the app's own protocol consumed all of it and start-up died as "WASM initialization
            // timeout". Reading the bytes here leaves that budget for what it is meant to cover,
            // compiling the module and starting its threads, and turns a frozen percentage into a
            // progress bar with real numbers.
            const fromAppBundle = isTauri();
            const totals: Record<string, number> = {
                [ENGINE_FILES[0].label]: ENGINE_FILES[0].estimatedBytes,
                [ENGINE_FILES[1].label]: ENGINE_FILES[1].estimatedBytes,
                font: FONT_ESTIMATED_BYTES,
            };
            const track = this.trackProgress(totals, fromAppBundle ? 'Reading engine' : 'Downloading');
            const fromFetch = (key: string) => (p: FetchProgress) => track(key)(p.loadedBytes, p.totalBytes);
            const readStartedAt = performance.now();

            // The desktop bundle always ships the decompressed engine — scripts/decompress-wasm.mjs
            // fails a Tauri build that cannot produce it — so read the .bin straight out of the app:
            // no .gz, no Range requests and no part cache, none of which a local file needs.
            const [sofficeWasmBlob, sofficeDataBlob, fontBlob] = fromAppBundle
                ? await Promise.all([
                    this.readBundledFile(`${this.basePath}${SOFFICE_WASM_FILE}?v=${ASSET_VERSION}`, SOFFICE_WASM_FILE, track(ENGINE_FILES[0].label)),
                    this.readBundledFile(`${this.basePath}${SOFFICE_DATA_FILE}?v=${ASSET_VERSION}`, SOFFICE_DATA_FILE, track(ENGINE_FILES[1].label)),
                    this.readBundledFile(withBasePath(`${FONT_PATH}?v=${ASSET_VERSION}`), 'the engine font', track('font')),
                ])
                : await Promise.all([
                    this.fetchEngineFile(ENGINE_FILES[0], fromFetch(ENGINE_FILES[0].label)),
                    this.fetchEngineFile(ENGINE_FILES[1], fromFetch(ENGINE_FILES[1].label)),
                    fetchAssembledBlob(withBasePath(`${FONT_PATH}?v=${ASSET_VERSION}`), fromFetch('font')),
                ]);

            const readSeconds = (performance.now() - readStartedAt) / 1000;
            const readMB = (sofficeWasmBlob.size + sofficeDataBlob.size + fontBlob.size) / MB;
            console.warn(
                `[LibreOffice] Engine bytes ready: ${readMB.toFixed(1)} MB in ${readSeconds.toFixed(1)}s ` +
                `(${(readMB / Math.max(readSeconds, 0.001)).toFixed(1)} MB/s)`
            );

            const sofficeWasmUrl = URL.createObjectURL(sofficeWasmBlob);
            const sofficeDataUrl = URL.createObjectURL(sofficeDataBlob);
            this.blobUrls = [sofficeWasmUrl, sofficeDataUrl];
            const fontArrayBuffer = await fontBlob.arrayBuffer();

            // Every pthread the engine starts is created as `new Worker(sofficeJs)` from inside the
            // library's worker — soffice.js does `pthreadMainJs = Module.mainScriptUrlOrBlob`. On the
            // desktop build that URL belongs to the app's own protocol, and a nested worker created
            // through it never reports back, so soffice.js keeps its "loading-workers" run dependency
            // forever: start-up idles at zero CPU until the library's 120s timeout, which is what
            // "WASM initialization timeout" was. A blob: URL keeps thread creation in memory, where no
            // protocol handler is involved. The parent worker (browserWorkerJs) stays a real URL —
            // nested creation breaks the other way round (see the note at the top of this file).
            let sofficeJsUrl = `${this.basePath}soffice.js?v=${ASSET_VERSION}`;
            if (fromAppBundle) {
                const glue = await this.readBundledFile(sofficeJsUrl, 'soffice.js', () => {});
                sofficeJsUrl = URL.createObjectURL(new Blob([glue], { type: 'text/javascript' }));
                this.blobUrls.push(sofficeJsUrl);
            }

            this.downloadsComplete = true;
            this.progressCallback?.({ phase: 'initializing', percent: 92, message: 'Starting conversion engine...' });

            const converter = new WorkerBrowserConverter({
                sofficeJs: sofficeJsUrl,
                sofficeWasm: sofficeWasmUrl,
                sofficeData: sofficeDataUrl,
                sofficeWorkerJs: `${this.basePath}soffice.worker.js?v=${ASSET_VERSION}`,
                browserWorkerJs: `${this.basePath}browser.worker.global.js?v=${ASSET_VERSION}`,
                verbose: false,
                fonts: [
                    { filename: 'NotoSansSC-Regular.ttf', data: fontArrayBuffer }
                ],
                onProgress: (info: { phase: string; percent: number; message: string }) => {
                    // Use this.progressCallback so a late-arriving callback from the UI gets picked up
                    if (this.progressCallback && !this.initialized) {
                        this.progressCallback({
                            phase: info.phase as LoadProgress['phase'],
                            percent: info.percent,
                            message: this.buildProgressMessage(info),
                        });
                    }
                },
                onReady: () => {
                    console.log('[LibreOffice] Ready!');
                },
                onError: (error: Error) => {
                    console.error('[LibreOffice] Error:', error);
                },
            });
            this.converter = converter;

            console.log('[LibreOffice] Starting initialization via WorkerBrowserConverter...');
            const initStart = performance.now();
            try {
                await withTimeout(
                    converter.initialize(),
                    ENGINE_START_TIMEOUT_MS,
                    'The conversion engine did not finish starting within 5 minutes. The device may be low on memory; reload the page to try again.'
                );
            } catch (e) {
                converter.destroy().catch(() => {});
                throw e;
            }
            const initDuration = Math.round(performance.now() - initStart);
            console.log(`[LibreOffice] Initialization completed in ${initDuration}ms`);

            this.initialized = true;

            // Signal completion
            this.progressCallback?.({ phase: 'ready', percent: 100, message: 'Conversion engine ready!' });

            // Null out the callback to prevent any late-firing progress updates
            this.progressCallback = undefined;

            // Free the storage used by engine builds that are no longer served.
            void pruneCachedAssets((url) => isLibreOfficeAssetUrl(url) && url.searchParams.get('v') !== ASSET_VERSION)
                .then((removed) => {
                    if (removed > 0) console.warn(`[LibreOffice] Removed ${removed} cached entries from previous engine versions`);
                })
                .catch(() => {});
        } catch (e) {
            this.converter = null;
            this.initialized = false;
            this.downloadsComplete = false;
            this.blobUrls.forEach(url => URL.revokeObjectURL(url));
            this.blobUrls = [];

            // The desktop build ships without devtools, so a bare "timeout" leaves nothing to go on.
            // Name the capability that actually decides whether the engine can start.
            if (isTauri()) {
                const support = await describeWorkerSupport();
                console.error(`[LibreOffice] Worker support: ${support}`);
                throw new Error(`${e instanceof Error ? e.message : String(e)} — ${support}`);
            }
            throw e;
        }
    }

    /**
     * Drops Service Workers that would intercept or corrupt local asset loading. On the web the
     * coi-serviceworker is kept: it is what provides cross-origin isolation there. Under Tauri
     * the headers come from the native side (app.security.headers), so nothing is worth keeping.
     */
    private async cleanupServiceWorkers(): Promise<void> {
        const inTauri = isTauri();
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
            const scriptUrl = reg.active?.scriptURL || reg.waiting?.scriptURL || reg.installing?.scriptURL || '';
            if (!inTauri && scriptUrl.includes('coi-serviceworker')) {
                console.log(`[LibreOffice] Preserving coi-serviceworker for cross-origin isolation: ${scriptUrl}`);
                continue;
            }
            await reg.unregister();
            console.warn(`[LibreOffice] Unregistered conflicting Service Worker: ${reg.scope}`);
        }
    }

    /**
     * Diagnose environment issues — fail fast if SharedArrayBuffer is not available or the
     * Content-Security-Policy would block the engine.
     * SharedArrayBuffer requires Cross-Origin Isolation (COOP + COEP headers).
     */
    private async checkEnvironment(): Promise<void> {
        console.warn('[LibreOffice] === Environment Check ===');

        // In Tauri desktop app, headers are provided natively by Tauri (app.security.headers).
        // Any registered ServiceWorker should be removed to prevent it from intercepting
        // or corrupting local asset loading.
        // In browser environments, preserve coi-serviceworker for cross-origin isolation.
        if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
            // Bounded: on a custom protocol (Tauri) getRegistrations() can stay pending forever,
            // and a pending promise is not something the catch below would ever see.
            try {
                await withTimeout(
                    this.cleanupServiceWorkers(),
                    SERVICE_WORKER_PROBE_TIMEOUT_MS,
                    'Service Worker check timed out',
                );
            } catch (e) {
                console.warn('[LibreOffice] Failed to check Service Worker:', e);
            }
        }

        // 1. Check COOP/COEP — this is the #1 cause of WASM timeout
        const isIsolated = typeof window !== 'undefined' ? window.crossOriginIsolated : false;
        console.warn(`[LibreOffice] Cross-Origin Isolated: ${isIsolated ? 'YES ✅' : 'NO ❌'}`);

        // 2. Check SharedArrayBuffer directly
        const hasSAB = typeof SharedArrayBuffer !== 'undefined';
        console.warn(`[LibreOffice] SharedArrayBuffer: ${hasSAB ? 'Available ✅' : 'NOT available ❌'}`);

        if (!isIsolated || !hasSAB) {
            if (!isTauri() && typeof window !== 'undefined' && 'serviceWorker' in navigator) {
                try {
                    const basePath = window.location.pathname.startsWith('/atlaspdf') ? '/atlaspdf/' : '/';
                    navigator.serviceWorker.register(`${basePath}coi-serviceworker.js`).then((reg) => {
                        if (reg.active && !navigator.serviceWorker.controller) {
                            window.location.reload();
                        }
                    }).catch(() => {});
                } catch (_) {}
            }

            const errorMsg = [
                'LibreOffice WASM requires SharedArrayBuffer for multi-threading.',
                '',
                'SharedArrayBuffer is only available in Cross-Origin Isolated contexts.',
                'If self-hosting (Nginx/Docker), ensure your server returns:',
                '  Cross-Origin-Opener-Policy: same-origin',
                '  Cross-Origin-Embedder-Policy: require-corp',
                '  Cross-Origin-Resource-Policy: cross-origin',
                '',
                `Current state: crossOriginIsolated=${isIsolated}, SharedArrayBuffer=${hasSAB}`,
                'A cross-origin isolation service worker has been initialized. Please reload the page if this error persists.',
            ].join('\n');
            console.error(`[LibreOffice] ${errorMsg}`);
            throw new Error(
                `SharedArrayBuffer is not available (crossOriginIsolated=${isIsolated}). ` +
                'Your server must set Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy headers. ' +
                'If using static hosting, reload the page to allow the isolation worker to take effect.'
            );
        }

        // 3. Content-Security-Policy — probed here because inside the worker it only fails after
        //    the whole engine has been downloaded, and then as an unhelpful EvalError/fetch error.
        // Bounded like the probe above: a policy violation rejects at once, so a probe that
        // hangs says nothing about the policy — and must not take initialization down with it.
        const cspBlockers = await withTimeout(
            detectLibreOfficeCspBlockers(),
            CSP_PROBE_TIMEOUT_MS,
            'Content-Security-Policy probe timed out',
        ).catch((e) => {
            console.warn('[LibreOffice] CSP probe did not finish, continuing without it:', e);
            return [] as string[];
        });
        if (cspBlockers.length > 0) {
            const message =
                `The server's Content-Security-Policy blocks the conversion engine: ${cspBlockers.join('; ')}. ` +
                'Update the Content-Security-Policy header (see DEPLOYMENT.md) and reload the page.';
            console.error(`[LibreOffice] ${message}`);
            throw new Error(message);
        }

        // 4. Under Tauri every asset is bundled inside the executable, so the 404 / wrong-MIME
        //    failures this sweep exists to catch cannot happen — and each probe is ruinous there:
        //    the tauri:// protocol builds the full response body whatever the method, so HEADing
        //    soffice.wasm.bin.gz + soffice.data.bin.gz alone decompresses ~77MB in the WebView.
        if (isTauri()) {
            this.totalAssetSizeMB = 0;
            console.warn('[LibreOffice] === Environment Check Passed ✅ (desktop: bundled assets, probes skipped) ===');
            return;
        }

        // 5. Check file connectivity (parallel for speed) & accumulate the download size
        const checks: Array<{ label: string; candidates: string[]; engine: boolean }> = [
            ...ENGINE_FILES.map((f) => ({
                label: f.gz,
                candidates: [f.gz, `${f.gz}.manifest.json`, f.raw],
                engine: true,
            })),
            { label: 'soffice.js', candidates: ['soffice.js'], engine: false },
            { label: 'soffice.worker.js', candidates: ['soffice.worker.js'], engine: false },
            { label: 'browser.worker.global.js', candidates: ['browser.worker.global.js'], engine: false },
        ];
        let engineBytes = 0;
        await Promise.all(checks.map(async ({ label, candidates, engine }) => {
            const start = performance.now();
            let lastStatus = 0;
            for (const candidate of candidates) {
                let res: Response;
                try {
                    res = await fetch(`${this.basePath}${candidate}?v=${ASSET_VERSION}`, { method: 'HEAD' });
                } catch (e) {
                    console.error(`[LibreOffice] ${label}: NETWORK ERROR`, e);
                    throw new Error(`Cannot fetch ${label}: ${e}`);
                }
                if (res.ok) {
                    const size = parseInt(res.headers.get('content-length') || '0', 10) || 0;
                    if (engine && !candidate.endsWith('.manifest.json')) engineBytes += size;
                    console.warn(
                        `[LibreOffice] ${label}: OK via ${candidate} (${res.status}) ${Math.round(performance.now() - start)}ms | ` +
                        `${(size / MB).toFixed(2)}MB | type=${res.headers.get('content-type')}`
                    );
                    return;
                }
                lastStatus = res.status;
            }
            console.error(`[LibreOffice] ${label}: FAILED (HTTP ${lastStatus})`);
            throw new Error(`Required file ${label} returned HTTP ${lastStatus}`);
        }));

        this.totalAssetSizeMB = engineBytes / MB;
        if (this.totalAssetSizeMB > 0) {
            console.warn(`[LibreOffice] Engine download size: ${this.totalAssetSizeMB.toFixed(1)} MB`);
        }
        console.warn('[LibreOffice] === Environment Check Passed ✅ ===');
    }

    isReady(): boolean {
        return this.initialized && this.converter !== null;
    }

    async convert(file: File, outputFormat: string): Promise<Blob> {
        if (!this.converter) {
            throw new Error('Converter not initialized');
        }

        console.log(`[LibreOffice] Converting ${file.name} to ${outputFormat}...`);
        console.log(`[LibreOffice] File type: ${file.type}, Size: ${file.size} bytes`);

        try {
            const arrayBuffer = await file.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);
            const ext = file.name.split('.').pop()?.toLowerCase() || '';

            console.log(`[LibreOffice] Detected format from extension: ${ext}`);

            const startTime = Date.now();
            const result = await this.converter.convert(uint8Array, {
                outputFormat: outputFormat as any,
                inputFormat: ext as any,
            }, file.name);

            const duration = Date.now() - startTime;
            console.log(`[LibreOffice] Conversion complete! Duration: ${duration}ms, Size: ${result.data.length} bytes`);

            // SharedArrayBuffer-backed data cannot be passed to Blob directly;
            // copy only when necessary to avoid unnecessary allocation.
            const isSAB = typeof SharedArrayBuffer !== 'undefined'
                && result.data.buffer instanceof SharedArrayBuffer;
            const outputData = isSAB
                ? new Uint8Array(result.data) // copies into a regular ArrayBuffer
                : result.data;
            return new Blob([outputData as BlobPart], { type: result.mimeType });
        } catch (error) {
            console.error(`[LibreOffice] Conversion FAILED for ${file.name}:`, error);
            throw error;
        }
    }

    async convertToPdf(file: File): Promise<Blob> {
        return this.convert(file, 'pdf');
    }

    async wordToPdf(file: File): Promise<Blob> {
        return this.convertToPdf(file);
    }

    async pptToPdf(file: File): Promise<Blob> {
        return this.convertToPdf(file);
    }

    async excelToPdf(file: File): Promise<Blob> {
        return this.convertToPdf(file);
    }

    async destroy(): Promise<void> {
        if (this.converter) {
            await this.converter.destroy();
        }

        // Revoke Blob URLs to release memory
        this.blobUrls.forEach(url => URL.revokeObjectURL(url));
        this.blobUrls = [];

        this.converter = null;
        this.initialized = false;
        this.downloadsComplete = false;
    }
}

export function getLibreOfficeConverter(basePath?: string): LibreOfficeConverter {
    if (!converterInstance) {
        converterInstance = new LibreOfficeConverter(basePath);
    }
    return converterInstance;
}
