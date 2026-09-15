/**
 * src/lib/utils/asset-loader.ts
 *
 * Fetches large static assets (the LibreOffice WASM engine, its font) reliably and caches them.
 *
 * - Large files are downloaded as independently retried Range requests when the server allows
 *   it, so a dropped connection costs one 10MB part instead of the whole file.
 * - Downloads are persisted in Cache Storage as 10MB parts plus a small metadata entry. Chrome
 *   refuses single Cache Storage entries in the ~100MB range (it reports the misleading
 *   "Entry already exists"), which silently disabled caching of the old whole-file entries and
 *   made every visit re-download the engine. Parts also let an interrupted download resume on
 *   the next visit.
 * - Understands the chunked layout (<file>.manifest.json + <file>.part_N) produced by
 *   scripts/chunk-assets.mjs for hosts with a 25MB per-file limit (Cloudflare Pages).
 */

interface ChunkManifest {
    filename: string;
    chunks: number;
    totalSize: number;
    chunkSize: number;
}

export interface FetchProgress {
    loadedBytes: number;
    totalBytes: number;
}

export type ProgressCallback = (progress: FetchProgress) => void;

/** A definitive HTTP error response, as opposed to a network failure. */
export class AssetHttpError extends Error {
    constructor(readonly status: number, readonly url: string) {
        super(`Failed to fetch ${url} (HTTP ${status})`);
        this.name = 'AssetHttpError';
    }
}

/** A Range request was answered with the whole file - the server does not honour ranges. */
class RangeNotSupportedError extends Error {
    constructor(url: string) {
        super(`${url} ignored the Range header`);
        this.name = 'RangeNotSupportedError';
    }
}

const CACHE_NAME = 'atlaspdf-asset-cache-v2';
/** Earlier layouts that stored whole files; deleted on first use. */
const LEGACY_CACHE_NAMES = ['atlaspdf-wasm-cache-v1'];

const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;

const PART_SIZE = 10 * 1024 * 1024;
const RANGE_CONCURRENCY = 4;

const PART_PARAM = '__part';
const META_PARAM = '__meta';

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryable(err: unknown): boolean {
    if (err instanceof RangeNotSupportedError) return false;
    if (err instanceof AssetHttpError) return err.status === 408 || err.status === 429 || err.status >= 500;
    return true; // network errors, truncated bodies
}

async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = MAX_FETCH_ATTEMPTS): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (!isRetryable(err) || attempt === maxAttempts) break;
            const delay = RETRY_BASE_DELAY_MS * attempt;
            console.warn(`[asset-loader] ${label}: attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms:`, err);
            await sleep(delay);
        }
    }
    throw lastError;
}

/** Runs task(i) for i in [0, count) with at most `limit` in flight; results keep index order. */
async function mapWithConcurrency<T>(count: number, limit: number, task: (index: number) => Promise<T>): Promise<T[]> {
    const results: T[] = new Array(count);
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, count) }, async () => {
        while (next < count) {
            const i = next++;
            results[i] = await task(i);
        }
    });
    await Promise.all(workers);
    return results;
}

function mimeTypeForUrl(url: string): string {
    const path = url.split('?')[0].toLowerCase();
    if (path.endsWith('.gz')) return 'application/gzip';
    if (path.includes('.wasm')) return 'application/wasm';
    if (path.endsWith('.js') || path.endsWith('.mjs')) return 'application/javascript';
    if (path.endsWith('.ttf')) return 'font/ttf';
    if (path.endsWith('.otf')) return 'font/otf';
    if (path.endsWith('.woff2')) return 'font/woff2';
    return 'application/octet-stream';
}

function isRealContentEncoding(headers: Headers): boolean {
    const encoding = headers.get('content-encoding');
    return !!encoding && encoding.toLowerCase() !== 'identity';
}

function sum(values: number[]): number {
    return values.reduce((a, b) => a + b, 0);
}

// ---------------------------------------------------------------------------------------------
// Cache Storage (parts + metadata)
// ---------------------------------------------------------------------------------------------

interface CachedAssetMeta {
    totalBytes: number;
    partSize: number;
    parts: number;
    complete: boolean;
}

function withParam(url: string, name: string, value: string | number): string {
    return `${url}${url.includes('?') ? '&' : '?'}${name}=${value}`;
}

function baseHref(): string {
    return typeof location !== 'undefined' ? location.href : 'http://localhost/';
}

/** The asset a cache key belongs to, ignoring the part/metadata markers. */
function assetIdentity(url: string): string {
    const parsed = new URL(url, baseHref());
    parsed.searchParams.delete(PART_PARAM);
    parsed.searchParams.delete(META_PARAM);
    return `${parsed.pathname}${parsed.search}`;
}

let legacyCleanupStarted = false;

async function openAssetCache(): Promise<Cache | null> {
    if (typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(CACHE_NAME);
        if (!legacyCleanupStarted) {
            legacyCleanupStarted = true;
            for (const legacy of LEGACY_CACHE_NAMES) caches.delete(legacy).catch(() => {});
        }
        return cache;
    } catch (e) {
        console.warn('[asset-loader] Cache Storage unavailable:', e);
        return null;
    }
}

function partSizeAt(meta: CachedAssetMeta, index: number): number {
    return index < meta.parts - 1 ? meta.partSize : meta.totalBytes - meta.partSize * (meta.parts - 1);
}

async function readMeta(cache: Cache, url: string): Promise<CachedAssetMeta | null> {
    try {
        const res = await cache.match(withParam(url, META_PARAM, 1));
        if (!res) return null;
        const meta = (await res.json()) as CachedAssetMeta;
        return Number.isFinite(meta?.totalBytes) && meta.partSize > 0 && meta.parts > 0 ? meta : null;
    } catch {
        return null;
    }
}

async function readCachedParts(cache: Cache, url: string, meta: CachedAssetMeta): Promise<Map<number, Blob>> {
    const found = new Map<number, Blob>();
    await Promise.all(
        Array.from({ length: meta.parts }, async (_, i) => {
            try {
                const res = await cache.match(withParam(url, PART_PARAM, i));
                if (!res) return;
                const blob = await res.blob();
                if (blob.size === partSizeAt(meta, i)) found.set(i, blob);
            } catch {
                /* treat as missing */
            }
        })
    );
    return found;
}

/** Writes parts/metadata for one asset; stops caching (but not downloading) after the first failure. */
class PartCacheWriter {
    private disabled = false;

    constructor(private readonly cache: Cache | null, private readonly url: string) {}

    async put(index: number, data: Blob): Promise<void> {
        if (!this.cache || this.disabled) return;
        try {
            await this.cache.put(
                withParam(this.url, PART_PARAM, index),
                new Response(data, { headers: { 'Content-Type': 'application/octet-stream' } })
            );
        } catch (e) {
            this.fail(e);
        }
    }

    async meta(meta: CachedAssetMeta): Promise<void> {
        if (!this.cache || this.disabled) return;
        try {
            await this.cache.put(
                withParam(this.url, META_PARAM, 1),
                new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } })
            );
        } catch (e) {
            this.fail(e);
        }
    }

    private fail(e: unknown) {
        this.disabled = true;
        console.warn(`[asset-loader] Could not cache ${this.url}, continuing without caching:`, e);
    }
}

function ordered(parts: Map<number, Blob>, count: number): Blob[] {
    return Array.from({ length: count }, (_, i) => parts.get(i) as Blob);
}

/** Removes every cached part and the metadata entry of one asset. */
export async function deleteCachedAsset(url: string): Promise<void> {
    const cache = await openAssetCache();
    if (!cache) return;
    const target = assetIdentity(url);
    const keys = await cache.keys();
    await Promise.all(keys.filter((req) => assetIdentity(req.url) === target).map((req) => cache.delete(req)));
}

/** Deletes cached entries whose URL matches `shouldDelete`; returns how many were removed. */
export async function pruneCachedAssets(shouldDelete: (url: URL) => boolean): Promise<number> {
    const cache = await openAssetCache();
    if (!cache) return 0;
    const keys = await cache.keys();
    const stale = keys.filter((req) => shouldDelete(new URL(req.url, baseHref())));
    await Promise.all(stale.map((req) => cache.delete(req)));
    return stale.length;
}

// ---------------------------------------------------------------------------------------------
// Network
// ---------------------------------------------------------------------------------------------

interface AssetProbe {
    status: number;
    totalBytes: number;
    acceptsRanges: boolean;
    encoded: boolean;
}

async function probeAsset(url: string): Promise<AssetProbe | null> {
    try {
        const res = await fetch(url, { method: 'HEAD' });
        return {
            status: res.status,
            totalBytes: res.ok ? parseInt(res.headers.get('content-length') || '0', 10) || 0 : 0,
            acceptsRanges: res.headers.get('accept-ranges') === 'bytes',
            encoded: isRealContentEncoding(res.headers),
        };
    } catch (err) {
        console.debug(`[asset-loader] HEAD check failed for ${url}:`, err);
        return null;
    }
}

async function fetchManifest(url: string): Promise<ChunkManifest | null> {
    const [baseUrl, query] = url.split('?');
    try {
        const res = await fetch(`${baseUrl}.manifest.json${query ? `?${query}` : ''}`);
        if (!res.ok) return null;
        const manifest = (await res.json()) as ChunkManifest;
        return manifest?.chunks > 0 && manifest.totalSize > 0 && manifest.chunkSize > 0 ? manifest : null;
    } catch {
        return null;
    }
}

/**
 * Fetch a URL as one request, retrying transient failures and rejecting a response shorter
 * than its declared Content-Length.
 */
async function fetchWholeAsset(url: string, onProgress?: ProgressCallback): Promise<Blob> {
    return withRetry(url, async () => {
        onProgress?.({ loadedBytes: 0, totalBytes: 0 });

        const res = await fetch(url);
        if (!res.ok) throw new AssetHttpError(res.status, url);

        const totalBytes = parseInt(res.headers.get('content-length') || '0', 10) || 0;
        // Content-Length is the on-the-wire (possibly gzip-encoded) size, but fetch() decodes the
        // body before we see it - a complete transfer of an encoded response legitimately yields
        // more bytes. Only trust it as a completeness check for identity-encoded responses.
        const canVerifyLength = totalBytes > 0 && !isRealContentEncoding(res.headers);

        if (!res.body || totalBytes === 0 || !onProgress) {
            const blob = await res.blob();
            if (canVerifyLength && blob.size !== totalBytes) {
                throw new Error(`Incomplete download for ${url}: got ${blob.size} of ${totalBytes} bytes`);
            }
            onProgress?.({ loadedBytes: blob.size, totalBytes: blob.size });
            return blob;
        }

        const reader = res.body.getReader();
        let loadedBytes = 0;
        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) {
                chunks.push(value);
                loadedBytes += value.length;
                onProgress({ loadedBytes, totalBytes });
            }
        }

        // An interrupted transfer can end the reader loop cleanly with fewer bytes than promised;
        // surface that as a retryable failure instead of handing back a truncated asset.
        if (canVerifyLength && loadedBytes !== totalBytes) {
            throw new Error(`Incomplete download for ${url}: got ${loadedBytes} of ${totalBytes} bytes`);
        }
        return new Blob(chunks as BlobPart[], { type: mimeTypeForUrl(url) });
    });
}

async function fetchWithProgressOnce(url: string, onProgress?: (loaded: number) => void): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new AssetHttpError(res.status, url);

    const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
    const canVerifyLength = total > 0 && !isRealContentEncoding(res.headers);

    if (!res.body || !onProgress) {
        const buf = await res.arrayBuffer();
        if (canVerifyLength && buf.byteLength !== total) {
            throw new Error(`Incomplete download for ${url}: got ${buf.byteLength} of ${total} bytes`);
        }
        return buf;
    }

    const reader = res.body.getReader();
    let loaded = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
            chunks.push(value);
            loaded += value.length;
            onProgress(loaded);
        }
    }
    if (canVerifyLength && loaded !== total) {
        throw new Error(`Incomplete download for ${url}: got ${loaded} of ${total} bytes`);
    }

    const assembled = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) {
        assembled.set(chunk, offset);
        offset += chunk.length;
    }
    return assembled.buffer;
}

function fetchWithProgress(url: string, onProgress?: (loaded: number) => void): Promise<ArrayBuffer> {
    return withRetry(url, () => {
        onProgress?.(0);
        return fetchWithProgressOnce(url, onProgress);
    });
}

async function downloadRanged(
    url: string,
    totalBytes: number,
    cache: Cache | null,
    onProgress: ProgressCallback | undefined,
    existing: Map<number, Blob>
): Promise<Blob> {
    const parts = Math.ceil(totalBytes / PART_SIZE);
    const writer = new PartCacheWriter(cache, url);
    const loaded = Array.from({ length: parts }, (_, i) => existing.get(i)?.size ?? 0);
    const report = () => onProgress?.({ loadedBytes: sum(loaded), totalBytes });
    report();
    await writer.meta({ totalBytes, partSize: PART_SIZE, parts, complete: false });

    const blobs = await mapWithConcurrency(parts, RANGE_CONCURRENCY, async (i) => {
        const cached = existing.get(i);
        if (cached) return cached;

        const start = i * PART_SIZE;
        const end = Math.min(start + PART_SIZE, totalBytes) - 1;
        const expected = end - start + 1;
        const blob = await withRetry(`${url} [part ${i + 1}/${parts}]`, async () => {
            loaded[i] = 0;
            const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
            if (res.status === 200) {
                res.body?.cancel().catch(() => {});
                throw new RangeNotSupportedError(url);
            }
            if (res.status !== 206) throw new AssetHttpError(res.status, url);
            const buf = await res.arrayBuffer();
            if (buf.byteLength !== expected) {
                throw new Error(`Incomplete part ${i + 1}/${parts} of ${url}: got ${buf.byteLength} of ${expected} bytes`);
            }
            return new Blob([buf]);
        });
        loaded[i] = blob.size;
        report();
        await writer.put(i, blob);
        return blob;
    });

    await writer.meta({ totalBytes, partSize: PART_SIZE, parts, complete: true });
    return new Blob(blobs, { type: mimeTypeForUrl(url) });
}

async function downloadFromManifest(
    url: string,
    manifest: ChunkManifest,
    cache: Cache | null,
    onProgress: ProgressCallback | undefined,
    existing: Map<number, Blob>
): Promise<Blob> {
    console.log(`[asset-loader] Manifest found for ${manifest.filename}. Reassembling from ${manifest.chunks} chunks...`);
    const [baseUrl, query] = url.split('?');
    const queryString = query ? `?${query}` : '';
    const writer = new PartCacheWriter(cache, url);
    const meta = { totalBytes: manifest.totalSize, partSize: manifest.chunkSize, parts: manifest.chunks };
    const loaded = Array.from({ length: manifest.chunks }, (_, i) => existing.get(i)?.size ?? 0);
    const report = () => onProgress?.({ loadedBytes: sum(loaded), totalBytes: manifest.totalSize });
    report();
    await writer.meta({ ...meta, complete: false });

    const blobs = await mapWithConcurrency(manifest.chunks, RANGE_CONCURRENCY, async (i) => {
        const cached = existing.get(i);
        if (cached) return cached;
        const buf = await fetchWithProgress(`${baseUrl}.part_${i}${queryString}`, (n) => {
            loaded[i] = n;
            report();
        });
        loaded[i] = buf.byteLength;
        report();
        const blob = new Blob([buf]);
        await writer.put(i, blob);
        return blob;
    });

    await writer.meta({ ...meta, complete: true });
    return new Blob(blobs, { type: mimeTypeForUrl(url) });
}

async function cacheWholeBlob(cache: Cache | null, url: string, blob: Blob): Promise<void> {
    if (!cache) return;
    const writer = new PartCacheWriter(cache, url);
    const parts = Math.max(1, Math.ceil(blob.size / PART_SIZE));
    const meta = { totalBytes: blob.size, partSize: PART_SIZE, parts };
    await writer.meta({ ...meta, complete: false });
    for (let i = 0; i < parts; i++) {
        await writer.put(i, blob.slice(i * PART_SIZE, Math.min(blob.size, (i + 1) * PART_SIZE)));
    }
    await writer.meta({ ...meta, complete: true });
}

/**
 * Fetches an asset - from the part cache when complete, resuming a partial download when
 * possible, via a chunk manifest when the host splits files, otherwise directly.
 *
 * @throws AssetHttpError when the asset does not exist (HTTP 404) or the server refuses it.
 */
export async function fetchAssembledBlob(url: string, onProgress?: ProgressCallback): Promise<Blob> {
    const cache = await openAssetCache();
    let meta = cache ? await readMeta(cache, url) : null;
    let cachedParts = new Map<number, Blob>();

    if (cache && meta) {
        cachedParts = await readCachedParts(cache, url, meta);
        if (meta.complete && cachedParts.size === meta.parts) {
            console.log(`[asset-loader] Cache hit for ${url}`);
            onProgress?.({ loadedBytes: meta.totalBytes, totalBytes: meta.totalBytes });
            return new Blob(ordered(cachedParts, meta.parts), { type: mimeTypeForUrl(url) });
        }
    }

    const reusable = (totalBytes: number, partSize: number) => {
        if (!meta || cachedParts.size === 0) return new Map<number, Blob>();
        if (meta.totalBytes === totalBytes && meta.partSize === partSize) {
            console.log(`[asset-loader] Resuming ${url}: ${cachedParts.size}/${meta.parts} parts already cached`);
            return cachedParts;
        }
        return new Map<number, Blob>();
    };
    const discardStale = async (totalBytes: number) => {
        if (meta && meta.totalBytes !== totalBytes) {
            await deleteCachedAsset(url);
            meta = null;
            cachedParts = new Map();
        }
    };

    const probe = await probeAsset(url);

    // Hosts with a per-file size limit ship <file>.manifest.json + <file>.part_N instead of <file>.
    if (probe?.status === 404) {
        const manifest = await fetchManifest(url);
        if (!manifest) throw new AssetHttpError(404, url);
        await discardStale(manifest.totalSize);
        return downloadFromManifest(url, manifest, cache, onProgress, reusable(manifest.totalSize, manifest.chunkSize));
    }

    // Range applies to the on-the-wire (encoded) representation (RFC 9110 §14.4), so a resource
    // the server transparently gzip-encodes can't be sliced into parts - use one request instead.
    const canRange = !!probe && probe.status >= 200 && probe.status < 300 && probe.acceptsRanges && !probe.encoded && probe.totalBytes > PART_SIZE;
    if (canRange && probe) {
        await discardStale(probe.totalBytes);
        try {
            return await downloadRanged(url, probe.totalBytes, cache, onProgress, reusable(probe.totalBytes, PART_SIZE));
        } catch (err) {
            console.warn(`[asset-loader] Ranged download failed for ${url}, falling back to a single request:`, err);
        }
    }

    const blob = await fetchWholeAsset(url, onProgress);
    await cacheWholeBlob(cache, url, blob);
    return blob;
}
