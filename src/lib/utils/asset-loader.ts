/**
 * src/lib/utils/asset-loader.ts
 * 
 * General-purpose utility to fetch and reassemble chunked assets.
 * Used to bypass 25MB file size limits on platforms like Cloudflare Pages.
 * 
 * Enhanced with Cache Storage API caching for WebAssembly assets to prevent 
 * timeouts on slow networks, and support for real-time progress callbacks.
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

const CACHE_NAME = 'atlaspdf-wasm-cache-v1';

// Large same-origin transfers (the LibreOffice WASM/data files are 100-150MB)
// have been observed failing mid-stream with a bare "net::ERR_FAILED" even
// though the server sent a normal 200 response and (verified separately with
// curl) the full file - this matches known behavior of local antivirus/VPN
// web-protection proxies that intercept localhost traffic and occasionally
// drop large streamed bodies. A short retry gives those an easy way to
// succeed on a second attempt instead of failing the whole tool outright.
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
    label: string,
    fn: () => Promise<T>,
    maxAttempts: number = MAX_FETCH_ATTEMPTS
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (attempt < maxAttempts) {
                const delay = RETRY_BASE_DELAY_MS * attempt;
                console.warn(
                    `[asset-loader] ${label}: attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms:`,
                    err
                );
                await sleep(delay);
            }
        }
    }
    throw lastError;
}

/**
 * Run `tasks` with at most `limit` running concurrently, preserving order in
 * the returned array (task i's result lands at index i regardless of finish
 * order).
 */
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
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.includes('.wasm')) return 'application/wasm';
    if (lowerUrl.includes('.js')) return 'application/javascript';
    if (lowerUrl.includes('.ttf')) return 'font/ttf';
    if (lowerUrl.includes('.otf')) return 'font/otf';
    if (lowerUrl.includes('.woff2')) return 'font/woff2';
    return 'application/octet-stream';
}

function isRealContentEncoding(headers: Headers): boolean {
    const encoding = headers.get('content-encoding');
    return !!encoding && encoding.toLowerCase() !== 'identity';
}

// Large single fetches (the LibreOffice WASM/data files are 100-150MB) are
// where "net::ERR_FAILED, 200 OK" has been reported from local dev - a single
// multi-hundred-megabyte connection is simply a bigger target for anything
// that can interrupt a long-lived transfer. Splitting into modest, independently
// retryable range requests (the server already advertises "Accept-Ranges: bytes")
// means a hiccup costs one small re-fetch instead of restarting the whole file,
// and no single request stays open anywhere near as long.
const RANGE_CHUNK_SIZE = 10 * 1024 * 1024; // 10MB
const RANGE_CONCURRENCY = 4;
const RANGE_MIN_TOTAL_SIZE = RANGE_CHUNK_SIZE * 2; // not worth ranging smaller files

/**
 * Fetch a same-origin URL in small Range-request pieces when the server
 * supports it and the file is large enough to benefit, falling back to a
 * single retried fetch otherwise (small file, or a server/proxy that doesn't
 * pass Range/Accept-Ranges through).
 */
async function fetchDirectAsset(url: string, onProgress?: ProgressCallback): Promise<Blob> {
    let totalBytes = 0;
    let acceptsRanges = false;
    let isContentEncoded = false;
    try {
        const headRes = await fetch(url, { method: 'HEAD' });
        if (headRes.ok) {
            totalBytes = parseInt(headRes.headers.get('content-length') || '0', 10);
            acceptsRanges = headRes.headers.get('accept-ranges') === 'bytes';
            isContentEncoded = isRealContentEncoding(headRes.headers);
        }
    } catch (err) {
        console.debug(`[asset-loader] HEAD check failed for ${url}, falling back to a single fetch:`, err);
    }

    // Range applies to the on-the-wire (encoded) representation, not the
    // decoded one (RFC 9110 §14.4) - a transparently gzip-encoded resource
    // (e.g. nginx's `gzip_static` serving a precompressed .gz sibling for the
    // LibreOffice WASM/data files) can't be sliced this way: each requested
    // byte range would land on an arbitrary, independently-undecodable
    // fragment of the gzip stream rather than a piece of the real WASM bytes.
    // Skip straight to one whole-file fetch, which the browser decodes correctly.
    if (isContentEncoded || !acceptsRanges || totalBytes < RANGE_MIN_TOTAL_SIZE) {
        return fetchWholeAsset(url, onProgress);
    }

    const numChunks = Math.ceil(totalBytes / RANGE_CHUNK_SIZE);
    const chunkLoaded = new Array(numChunks).fill(0);
    const reportProgress = () => {
        onProgress?.({ loadedBytes: chunkLoaded.reduce((a, b) => a + b, 0), totalBytes });
    };
    onProgress?.({ loadedBytes: 0, totalBytes });

    try {
        const parts = await mapWithConcurrency(numChunks, RANGE_CONCURRENCY, (i) => {
            const start = i * RANGE_CHUNK_SIZE;
            const end = Math.min(start + RANGE_CHUNK_SIZE, totalBytes) - 1;
            const expectedLength = end - start + 1;

            return withRetry(`${url} [range ${i + 1}/${numChunks}]`, async () => {
                chunkLoaded[i] = 0;
                const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
                if (res.status !== 206 && res.status !== 200) {
                    throw new Error(`Range request failed for ${url}: HTTP ${res.status}`);
                }
                const buf = await res.arrayBuffer();
                if (buf.byteLength !== expectedLength) {
                    throw new Error(
                        `Incomplete range for ${url} [${start}-${end}]: got ${buf.byteLength} of ${expectedLength} bytes`
                    );
                }
                chunkLoaded[i] = buf.byteLength;
                reportProgress();
                return new Uint8Array(buf);
            });
        });

        return new Blob(parts as unknown as BlobPart[], { type: mimeTypeForUrl(url) });
    } catch (err) {
        console.warn(`[asset-loader] Ranged fetch failed for ${url}, falling back to a single whole-file fetch:`, err);
        return fetchWholeAsset(url, onProgress);
    }
}

/**
 * Fetch a URL as one request (no Range splitting), retrying on transient
 * failures and rejecting a response that's shorter than its declared
 * Content-Length (see MAX_FETCH_ATTEMPTS / the truncation note below).
 */
async function fetchWholeAsset(url: string, onProgress?: ProgressCallback): Promise<Blob> {
    return withRetry(url, async () => {
        onProgress?.({ loadedBytes: 0, totalBytes: 0 });

        const res = await fetch(url);
        if (!res.ok) {
            throw new Error(`Failed to fetch asset: ${url} (HTTP ${res.status})`);
        }

        const contentLength = res.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
        // Content-Length reflects the on-the-wire (possibly gzip-encoded) size,
        // but fetch() transparently decodes the body before handing it to us -
        // a fully successful transfer of a compressed resource will legitimately
        // deliver more bytes than that header says. Only trust it as a
        // completeness check when the response isn't content-encoded.
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

        // A local proxy/interceptor ending a large transfer early can leave the
        // reader loop exiting cleanly (no thrown error) with fewer bytes than
        // promised. Catch that here so it surfaces as a retryable failure
        // instead of silently handing back a truncated asset.
        if (canVerifyLength && loadedBytes !== totalBytes) {
            throw new Error(`Incomplete download for ${url}: got ${loadedBytes} of ${totalBytes} bytes`);
        }

        return new Blob(chunks as unknown as BlobPart[], { type: mimeTypeForUrl(url) });
    });
}

/**
 * Check if the asset is in browser Cache Storage.
 */
async function getCachedBlob(url: string): Promise<Blob | null> {
    if (typeof caches === 'undefined') return null;
    try {
        const cache = await caches.open(CACHE_NAME);
        const cachedResponse = await cache.match(url);
        if (cachedResponse) {
            console.log(`[asset-loader] Cache hit for ${url}`);
            return await cachedResponse.blob();
        }
    } catch (e) {
        console.warn(`[asset-loader] Failed to read from Cache Storage:`, e);
    }
    return null;
}

/**
 * Cache the asset in browser Cache Storage.
 */
async function putCachedBlob(url: string, blob: Blob): Promise<void> {
    if (typeof caches === 'undefined') return;
    try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(
            url,
            new Response(blob, {
                headers: {
                    'Content-Type': blob.type,
                    'Content-Length': blob.size.toString(),
                    'Cache-Control': 'public, max-age=31536000, immutable',
                },
            })
        );
        console.log(`[asset-loader] Cached ${url} successfully (${(blob.size / 1024 / 1024).toFixed(1)}MB)`);
    } catch (e) {
        console.warn(`[asset-loader] Failed to write to Cache Storage:`, e);
    }
}

/**
 * Fetch a file/chunk and stream its contents to track progress, once.
 */
async function fetchWithProgressOnce(
    url: string,
    onProgress?: (loaded: number) => void
): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch chunk: ${url} (HTTP ${res.status})`);
    }

    const contentLength = res.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;
    // See the matching note in fetchWholeAsset: Content-Length is the
    // on-the-wire size, which won't match the decoded byte count fetch()
    // delivers for a content-encoded response even on full success.
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

    // A local antivirus/VPN proxy intercepting a large localhost transfer can
    // end the stream early without the reader ever throwing - the response
    // still reads as 200 OK, just short. Catch that here so it surfaces as a
    // retryable error instead of silently handing back a truncated asset.
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

/**
 * Helper to fetch a file/chunk and stream its contents to track progress,
 * retrying a couple of times on transient failures (see MAX_FETCH_ATTEMPTS).
 */
async function fetchWithProgress(
    url: string,
    onProgress?: (loaded: number) => void
): Promise<ArrayBuffer> {
    return withRetry(url, () => {
        // Reset progress to 0 at the start of each attempt so the UI reflects
        // what's actually been received on the current (possibly restarted) try.
        onProgress?.(0);
        return fetchWithProgressOnce(url, onProgress);
    });
}

/**
 * Fetches an asset, potentially reassembling it from chunks if a manifest exists.
 * Bypasses the network if the asset is already present in Cache Storage.
 * 
 * @param url The base URL of the asset (e.g., /libreoffice-wasm/soffice.wasm)
 * @param onProgress Optional callback to track the loading progress in bytes
 * @returns A Blob containing the reassembled or directly fetched asset
 */
export async function fetchAssembledBlob(
    url: string,
    onProgress?: ProgressCallback
): Promise<Blob> {
    // 1. Check Cache Storage first
    const cached = await getCachedBlob(url);
    if (cached) {
        onProgress?.({ loadedBytes: cached.size, totalBytes: cached.size });
        return cached;
    }

    // Determine the manifest URL by stripping query parameters and appending .manifest.json
    const [baseUrl, query] = url.split('?');
    const queryString = query ? `?${query}` : '';
    const manifestUrl = `${baseUrl}.manifest.json${queryString}`;
    
    let manifest: ChunkManifest | null = null;
    const isDev = process.env.NODE_ENV === 'development';
    if (!isDev) {
        try {
            const manifestRes = await fetch(manifestUrl);
            if (manifestRes.ok) {
                manifest = await manifestRes.json();
            }
        } catch (err) {
            console.debug(`[asset-loader] Manifest check skipped for ${url}:`, err);
        }
    }

    let resultBlob: Blob;

    // 2. Fetch and assemble from either chunks or directly
    if (manifest) {
        console.log(`[asset-loader] Manifest found for ${manifest.filename}. Reassembling from ${manifest.chunks} chunks...`);
        
        const chunkBytesLoaded = new Array(manifest.chunks).fill(0);
        const totalSize = manifest.totalSize;

        const reportOverallProgress = () => {
            if (!onProgress) return;
            const loadedBytes = chunkBytesLoaded.reduce((a, b) => a + b, 0);
            onProgress({ loadedBytes, totalBytes: totalSize });
        };

        // Fetch chunks in parallel, reporting combined progress
        const chunkPromises: Promise<ArrayBuffer>[] = [];
        for (let i = 0; i < manifest.chunks; i++) {
            const chunkUrl = `${baseUrl}.part_${i}${queryString}`;
            chunkPromises.push(
                fetchWithProgress(chunkUrl, (loaded) => {
                    chunkBytesLoaded[i] = loaded;
                    reportOverallProgress();
                }).then(buf => {
                    chunkBytesLoaded[i] = buf.byteLength;
                    reportOverallProgress();
                    return buf;
                })
            );
        }

        const chunks = await Promise.all(chunkPromises);
        resultBlob = new Blob(chunks as unknown as BlobPart[], { type: mimeTypeForUrl(url) });
    } else {
        // Fallback: no pre-built chunk manifest (the normal case in local dev,
        // and any deployment without the Cloudflare-oriented chunking step) -
        // fetch the file ourselves, splitting large ones into retryable Range
        // requests. See fetchDirectAsset / RANGE_CHUNK_SIZE above.
        resultBlob = await fetchDirectAsset(url, onProgress);
    }

    // 3. Cache the final Blob persistently
    await putCachedBlob(url, resultBlob);
    return resultBlob;
}
