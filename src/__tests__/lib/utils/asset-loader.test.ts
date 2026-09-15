import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Minimal fetch Response stand-in. Using a hand-rolled object instead of the
 * real Response class keeps these tests independent of how the current
 * runtime (Node/undici vs jsdom) computes/overrides Content-Length, and lets
 * a test declare one size while delivering another to exercise the
 * truncated-download guard.
 */
function fakeResponse(opts: {
    ok?: boolean;
    status?: number;
    contentLength?: number;
    blobSize: number;
    contentEncoding?: string;
}) {
    const { ok = true, status = 200, contentLength, blobSize, contentEncoding } = opts;
    return {
        ok,
        status,
        headers: {
            get: (name: string) => {
                const n = name.toLowerCase();
                if (n === 'content-length' && contentLength !== undefined) return String(contentLength);
                if (n === 'content-encoding' && contentEncoding !== undefined) return contentEncoding;
                return null;
            },
        },
        body: null, // forces the simpler `!res.body -> res.blob()` code path (no onProgress needed)
        blob: async () => new Blob([new Uint8Array(blobSize)]),
    } as unknown as Response;
}

/** A HEAD response reporting a small size - keeps fetchDirectAsset on the fetchWholeAsset path. */
function fakeSmallHead(size: number) {
    return {
        ok: true,
        status: 200,
        headers: {
            get: (name: string) => (name.toLowerCase() === 'content-length' ? String(size) : null),
        },
    } as unknown as Response;
}

describe('fetchAssembledBlob', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // No Cache Storage API in this test environment - fetchAssembledBlob
        // already handles that (`typeof caches === 'undefined'`) as a no-op.
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('retries a failing direct fetch and succeeds once the connection recovers', async () => {
        // Reproduces the reported symptom: the first attempt(s) fail with a
        // network-level error (matching net::ERR_FAILED from an intercepting
        // local proxy/antivirus), and a later attempt goes through cleanly.
        let call = 0;
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('.manifest.json')) return fakeResponse({ ok: false, blobSize: 0 });
            if (init?.method === 'HEAD') return fakeSmallHead(5);
            call++;
            if (call < 3) throw new TypeError('Failed to fetch');
            return fakeResponse({ blobSize: 5, contentLength: 5 });
        }));

        const { fetchAssembledBlob } = await import('@/lib/utils/asset-loader');
        const promise = fetchAssembledBlob('/test/retry-success.bin');
        await vi.runAllTimersAsync();
        const blob = await promise;

        expect(blob.size).toBe(5);
        expect(call).toBe(3);
    });

    it('gives up and throws after exhausting every retry attempt', async () => {
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('.manifest.json')) return fakeResponse({ ok: false, blobSize: 0 });
            if (init?.method === 'HEAD') return fakeSmallHead(5);
            throw new TypeError('Failed to fetch');
        }));

        const { fetchAssembledBlob } = await import('@/lib/utils/asset-loader');
        const promise = fetchAssembledBlob('/test/retry-exhausted.bin');
        const assertion = expect(promise).rejects.toThrow('Failed to fetch');
        await vi.runAllTimersAsync();
        await assertion;
    });

    it('treats a Content-Length mismatch (silent truncation) as a retryable failure', async () => {
        // The specific case a "200 OK but short body" proxy interception
        // produces: no thrown network error, just fewer bytes than promised.
        let call = 0;
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('.manifest.json')) return fakeResponse({ ok: false, blobSize: 0 });
            if (init?.method === 'HEAD') return fakeSmallHead(10);
            call++;
            if (call === 1) return fakeResponse({ blobSize: 3, contentLength: 10 }); // truncated
            return fakeResponse({ blobSize: 10, contentLength: 10 }); // complete on retry
        }));

        const { fetchAssembledBlob } = await import('@/lib/utils/asset-loader');
        const promise = fetchAssembledBlob('/test/truncated-then-complete.bin');
        await vi.runAllTimersAsync();
        const blob = await promise;

        expect(blob.size).toBe(10);
        expect(call).toBe(2);
    });

    it('splits a large asset into Range requests and reassembles it byte-correctly', async () => {
        // Mirrors the real soffice.wasm.bin case: large + Accept-Ranges: bytes
        // -> fetched as several independently-retryable pieces instead of one
        // multi-hundred-megabyte request.
        const RANGE_CHUNK_SIZE = 10 * 1024 * 1024;
        const totalBytes = RANGE_CHUNK_SIZE * 2 + 1; // -> 3 ranges: 10MB, 10MB, 1 byte
        const rangesRequested: string[] = [];

        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('.manifest.json')) return fakeResponse({ ok: false, blobSize: 0 });

            if (init?.method === 'HEAD') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name: string) => {
                            const n = name.toLowerCase();
                            if (n === 'content-length') return String(totalBytes);
                            if (n === 'accept-ranges') return 'bytes';
                            return null;
                        },
                    },
                } as unknown as Response;
            }

            const rangeHeader = (init?.headers as Record<string, string> | undefined)?.Range;
            expect(rangeHeader).toBeDefined();
            rangesRequested.push(rangeHeader!);
            const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader!)!;
            const start = parseInt(match[1], 10);
            const end = parseInt(match[2], 10);
            const length = end - start + 1;

            return {
                ok: true,
                status: 206,
                headers: { get: () => null },
                arrayBuffer: async () => new ArrayBuffer(length),
            } as unknown as Response;
        }));

        const { fetchAssembledBlob } = await import('@/lib/utils/asset-loader');
        const promise = fetchAssembledBlob('/test/large-ranged.bin');
        await vi.runAllTimersAsync();
        const blob = await promise;

        expect(blob.size).toBe(totalBytes);
        expect(rangesRequested).toEqual([
            `bytes=0-${RANGE_CHUNK_SIZE - 1}`,
            `bytes=${RANGE_CHUNK_SIZE}-${RANGE_CHUNK_SIZE * 2 - 1}`,
            `bytes=${RANGE_CHUNK_SIZE * 2}-${RANGE_CHUNK_SIZE * 2}`,
        ]);
    });

    it('retries a single failed Range chunk without re-fetching the other chunks', async () => {
        const RANGE_CHUNK_SIZE = 10 * 1024 * 1024;
        const totalBytes = RANGE_CHUNK_SIZE * 2 + 1;
        const attemptsPerRange = new Map<string, number>();

        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('.manifest.json')) return fakeResponse({ ok: false, blobSize: 0 });

            if (init?.method === 'HEAD') {
                return {
                    ok: true,
                    status: 200,
                    headers: {
                        get: (name: string) => {
                            const n = name.toLowerCase();
                            if (n === 'content-length') return String(totalBytes);
                            if (n === 'accept-ranges') return 'bytes';
                            return null;
                        },
                    },
                } as unknown as Response;
            }

            const rangeHeader = (init?.headers as Record<string, string> | undefined)?.Range as string;
            const attempt = (attemptsPerRange.get(rangeHeader) ?? 0) + 1;
            attemptsPerRange.set(rangeHeader, attempt);

            // The very first range (bytes 0-...) fails once, then succeeds.
            if (rangeHeader === `bytes=0-${RANGE_CHUNK_SIZE - 1}` && attempt === 1) {
                throw new TypeError('Failed to fetch');
            }

            const match = /bytes=(\d+)-(\d+)/.exec(rangeHeader)!;
            const length = parseInt(match[2], 10) - parseInt(match[1], 10) + 1;
            return {
                ok: true,
                status: 206,
                headers: { get: () => null },
                arrayBuffer: async () => new ArrayBuffer(length),
            } as unknown as Response;
        }));

        const { fetchAssembledBlob } = await import('@/lib/utils/asset-loader');
        const promise = fetchAssembledBlob('/test/large-ranged-retry.bin');
        await vi.runAllTimersAsync();
        const blob = await promise;

        expect(blob.size).toBe(totalBytes);
        expect(attemptsPerRange.get(`bytes=0-${RANGE_CHUNK_SIZE - 1}`)).toBe(2);
        expect(attemptsPerRange.get(`bytes=${RANGE_CHUNK_SIZE * 2}-${RANGE_CHUNK_SIZE * 2}`)).toBe(1);
    });

    it('skips Range splitting for a large resource served with Content-Encoding (e.g. nginx gzip_static)', async () => {
        // Range applies to the on-the-wire (encoded) bytes, not the decoded
        // ones - ranging a gzip-encoded resource would fetch arbitrary,
        // independently-undecodable fragments of the compressed stream. A
        // large asset whose HEAD response carries Content-Encoding must fall
        // straight through to a single whole-file fetch instead.
        const totalBytes = 30 * 1024 * 1024; // large enough to range if it weren't encoded
        let getRequests = 0;
        let rangeHeaderSeen = false;

        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('.manifest.json')) return fakeResponse({ ok: false, blobSize: 0 });

            if (init?.method === 'HEAD') {
                return fakeResponse({ contentLength: totalBytes, blobSize: 0, contentEncoding: 'gzip' });
            }

            getRequests++;
            if ((init?.headers as Record<string, string> | undefined)?.Range) rangeHeaderSeen = true;
            // The real decoded size exceeds the encoded Content-Length - exactly
            // what a successful gzip transfer looks like once fetch() decodes it.
            return fakeResponse({ contentLength: totalBytes, blobSize: totalBytes * 3, contentEncoding: 'gzip' });
        }));

        const { fetchAssembledBlob } = await import('@/lib/utils/asset-loader');
        const promise = fetchAssembledBlob('/test/gzip-encoded-large.bin');
        await vi.runAllTimersAsync();
        const blob = await promise;

        expect(rangeHeaderSeen).toBe(false);
        expect(getRequests).toBe(1);
        expect(blob.size).toBe(totalBytes * 3);
    });

    it('does not mistake a decoded gzip body for a truncated download', async () => {
        // fetchWholeAsset's own integrity check must not compare the decoded
        // byte count fetch() delivers against the encoded Content-Length -
        // that legitimately differs on a fully successful transfer.
        vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
            if (url.includes('.manifest.json')) return fakeResponse({ ok: false, blobSize: 0 });
            if (init?.method === 'HEAD') {
                // Small enough (and/or unranged) that fetchDirectAsset goes
                // straight to fetchWholeAsset regardless.
                return fakeResponse({ contentLength: 5, blobSize: 0 });
            }
            return fakeResponse({ contentLength: 5, blobSize: 20, contentEncoding: 'gzip' });
        }));

        const { fetchAssembledBlob } = await import('@/lib/utils/asset-loader');
        const promise = fetchAssembledBlob('/test/gzip-encoded-small.bin');
        await vi.runAllTimersAsync();
        const blob = await promise;

        expect(blob.size).toBe(20);
    });
});
