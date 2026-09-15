// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const PART = 10 * 1024 * 1024;
const CACHE = 'atlaspdf-asset-cache-v2';

/**
 * Minimal fetch Response stand-in. A hand-rolled object keeps these tests independent of how
 * the runtime computes Content-Length, and lets a test declare one size while delivering
 * another to exercise the truncated-download guard.
 */
function fakeResponse(opts: {
    status?: number;
    contentLength?: number;
    blobSize: number;
    contentEncoding?: string;
    acceptRanges?: boolean;
}) {
    const { status = 200, contentLength, blobSize, contentEncoding, acceptRanges } = opts;
    const headers = new Headers();
    if (contentLength !== undefined) headers.set('content-length', String(contentLength));
    if (contentEncoding) headers.set('content-encoding', contentEncoding);
    if (acceptRanges) headers.set('accept-ranges', 'bytes');
    return {
        ok: status >= 200 && status < 300,
        status,
        headers,
        body: null, // the simpler `!res.body` path
        blob: async () => new Blob([new Uint8Array(blobSize)]),
        arrayBuffer: async () => new ArrayBuffer(blobSize),
    } as unknown as Response;
}

const head = (size: number, extra: { ranges?: boolean; encoding?: string } = {}) =>
    fakeResponse({ contentLength: size, blobSize: 0, acceptRanges: extra.ranges, contentEncoding: extra.encoding });

const rangeOf = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Range;

function rangeResponse(init?: RequestInit) {
    const m = /bytes=(\d+)-(\d+)/.exec(rangeOf(init) ?? '')!;
    const length = Number(m[2]) - Number(m[1]) + 1;
    return { ok: true, status: 206, headers: new Headers(), arrayBuffer: async () => new ArrayBuffer(length) } as unknown as Response;
}

/** In-memory Cache Storage double (string keys, like relative URLs). */
function installCacheMock() {
    const stores = new Map<string, Map<string, { body: Uint8Array; type: string }>>();
    const keyOf = (req: RequestInfo) => (typeof req === 'string' ? req : req.url);
    const open = async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const store = stores.get(name)!;
        return {
            match: async (req: RequestInfo) => {
                const entry = store.get(keyOf(req));
                return entry ? new Response(entry.body.slice(), { headers: { 'Content-Type': entry.type } }) : undefined;
            },
            put: async (req: RequestInfo, res: Response) => {
                store.set(keyOf(req), { body: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') || '' });
            },
            keys: async () => [...store.keys()].map((url) => ({ url })),
            delete: async (req: RequestInfo) => store.delete(keyOf(req)),
        };
    };
    vi.stubGlobal('caches', { open, delete: async (name: string) => stores.delete(name) });
    return { stores, open };
}

const load = () => import('@/lib/utils/asset-loader');

describe('fetchAssembledBlob', () => {
    beforeEach(() => {
        vi.resetModules();
        // Only the retry back-off uses timers; leave Node's stream internals on real ones.
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe('network', () => {
        it('retries a failing request and succeeds once the connection recovers', async () => {
            let gets = 0;
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(5);
                gets++;
                if (gets < 3) throw new TypeError('Failed to fetch');
                return fakeResponse({ blobSize: 5, contentLength: 5 });
            }));

            const { fetchAssembledBlob } = await load();
            const promise = fetchAssembledBlob('/test/retry-success.bin');
            await vi.runAllTimersAsync();

            expect((await promise).size).toBe(5);
            expect(gets).toBe(3);
        });

        it('gives up after every retry attempt fails', async () => {
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(5);
                throw new TypeError('Failed to fetch');
            }));

            const { fetchAssembledBlob } = await load();
            const promise = fetchAssembledBlob('/test/retry-exhausted.bin');
            const assertion = expect(promise).rejects.toThrow('Failed to fetch');
            await vi.runAllTimersAsync();
            await assertion;
        });

        it('treats a body shorter than its Content-Length as a retryable failure', async () => {
            let gets = 0;
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(10);
                gets++;
                return gets === 1
                    ? fakeResponse({ blobSize: 3, contentLength: 10 })
                    : fakeResponse({ blobSize: 10, contentLength: 10 });
            }));

            const { fetchAssembledBlob } = await load();
            const promise = fetchAssembledBlob('/test/truncated-then-complete.bin');
            await vi.runAllTimersAsync();

            expect((await promise).size).toBe(10);
            expect(gets).toBe(2);
        });

        it('does not mistake a decoded gzip body for a truncated download', async () => {
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(5);
                return fakeResponse({ contentLength: 5, blobSize: 20, contentEncoding: 'gzip' });
            }));

            const { fetchAssembledBlob } = await load();
            expect((await fetchAssembledBlob('/test/gzip-encoded-small.bin')).size).toBe(20);
        });

        it('throws AssetHttpError for a missing file without retrying, after checking for a chunk manifest', async () => {
            const calls: string[] = [];
            vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
                calls.push(`${init?.method ?? 'GET'} ${url}`);
                return fakeResponse({ status: 404, blobSize: 0 });
            }));

            const { fetchAssembledBlob, AssetHttpError } = await load();
            const err = await fetchAssembledBlob('/test/missing.bin').catch((e) => e);

            expect(err).toBeInstanceOf(AssetHttpError);
            expect(err.status).toBe(404);
            expect(calls).toEqual(['HEAD /test/missing.bin', 'GET /test/missing.bin.manifest.json']);
        });

        it('does not retry a definitive 4xx response', async () => {
            let gets = 0;
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') throw new TypeError('Failed to fetch');
                gets++;
                return fakeResponse({ status: 403, blobSize: 0 });
            }));

            const { fetchAssembledBlob, AssetHttpError } = await load();
            const err = await fetchAssembledBlob('/test/forbidden.bin').catch((e) => e);

            expect(err).toBeInstanceOf(AssetHttpError);
            expect(gets).toBe(1);
        });

        it('reassembles a file the host split into a chunk manifest', async () => {
            const partsRequested: number[] = [];
            vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return fakeResponse({ status: 404, blobSize: 0 });
                if (url.includes('.manifest.json')) {
                    return {
                        ok: true, status: 200, headers: new Headers(),
                        json: async () => ({ filename: 'chunked.bin', chunks: 2, totalSize: 7, chunkSize: 4 }),
                    } as unknown as Response;
                }
                const index = Number(/\.part_(\d+)/.exec(url)![1]);
                partsRequested.push(index);
                const size = index === 0 ? 4 : 3;
                return fakeResponse({ contentLength: size, blobSize: size });
            }));

            const { fetchAssembledBlob } = await load();
            const blob = await fetchAssembledBlob('/test/chunked.bin?v=1');

            expect(blob.size).toBe(7);
            expect(partsRequested.sort()).toEqual([0, 1]);
        });
    });

    describe('ranged download', () => {
        it('splits a large file into 10MB Range requests and reassembles it', async () => {
            const total = PART * 2 + 1;
            const ranges: string[] = [];
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(total, { ranges: true });
                ranges.push(rangeOf(init)!);
                return rangeResponse(init);
            }));

            const { fetchAssembledBlob } = await load();
            const blob = await fetchAssembledBlob('/test/large-ranged.bin');

            expect(blob.size).toBe(total);
            expect(ranges.sort()).toEqual([
                `bytes=0-${PART - 1}`,
                `bytes=${PART}-${PART * 2 - 1}`,
                `bytes=${PART * 2}-${PART * 2}`,
            ].sort());
        });

        it('retries one failed part without re-fetching the others', async () => {
            const total = PART * 2 + 1;
            const attempts = new Map<string, number>();
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(total, { ranges: true });
                const range = rangeOf(init)!;
                const n = (attempts.get(range) ?? 0) + 1;
                attempts.set(range, n);
                if (range === `bytes=0-${PART - 1}` && n === 1) throw new TypeError('Failed to fetch');
                return rangeResponse(init);
            }));

            const { fetchAssembledBlob } = await load();
            const promise = fetchAssembledBlob('/test/large-ranged-retry.bin');
            await vi.runAllTimersAsync();

            expect((await promise).size).toBe(total);
            expect(attempts.get(`bytes=0-${PART - 1}`)).toBe(2);
            expect(attempts.get(`bytes=${PART * 2}-${PART * 2}`)).toBe(1);
        });

        it('does not slice a response the server content-encodes (Range would address the encoded bytes)', async () => {
            const total = PART + 1;
            let rangeSeen = false;
            let gets = 0;
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(total, { ranges: true, encoding: 'gzip' });
                gets++;
                if (rangeOf(init)) rangeSeen = true;
                return fakeResponse({ contentLength: total, blobSize: total * 2, contentEncoding: 'gzip' });
            }));

            const { fetchAssembledBlob } = await load();
            const blob = await fetchAssembledBlob('/test/gzip-encoded-large.bin');

            expect(rangeSeen).toBe(false);
            expect(gets).toBe(1);
            expect(blob.size).toBe(total * 2);
        });

        it('falls back to one whole request when the server ignores Range', async () => {
            const total = PART * 2 + 1;
            let wholeGets = 0;
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(total, { ranges: true });
                if (rangeOf(init)) {
                    return { ok: true, status: 200, headers: new Headers(), body: { cancel: async () => {} } } as unknown as Response;
                }
                wholeGets++;
                return fakeResponse({ contentLength: total, blobSize: total });
            }));

            const { fetchAssembledBlob } = await load();
            const blob = await fetchAssembledBlob('/test/range-ignored.bin');

            expect(blob.size).toBe(total);
            expect(wholeGets).toBe(1);
        });
    });

    describe('Cache Storage', () => {
        it('stores the download as parts and serves the next request without the network', async () => {
            const { stores } = installCacheMock();
            let network = 0;
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                network++;
                if (init?.method === 'HEAD') return head(5);
                return fakeResponse({ contentLength: 5, blobSize: 5 });
            }));

            const { fetchAssembledBlob } = await load();
            expect((await fetchAssembledBlob('/test/small.bin')).size).toBe(5);
            const afterFirst = network;
            expect((await fetchAssembledBlob('/test/small.bin')).size).toBe(5);

            expect(network).toBe(afterFirst);
            expect([...stores.get(CACHE)!.keys()].sort()).toEqual(['/test/small.bin?__meta=1', '/test/small.bin?__part=0']);
        });

        it('resumes a partial download, fetching only the parts that are not cached yet', async () => {
            const { open } = installCacheMock();
            const total = PART * 2 + 1;
            const cache = await open(CACHE);
            await cache.put('/test/resume.bin?__meta=1', new Response(JSON.stringify({ totalBytes: total, partSize: PART, parts: 3, complete: false })));
            await cache.put('/test/resume.bin?__part=0', new Response(new Uint8Array(PART)));

            const ranges: string[] = [];
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
                if (init?.method === 'HEAD') return head(total, { ranges: true });
                ranges.push(rangeOf(init)!);
                return rangeResponse(init);
            }));

            const { fetchAssembledBlob } = await load();
            const blob = await fetchAssembledBlob('/test/resume.bin');

            expect(blob.size).toBe(total);
            expect(ranges.sort()).toEqual([`bytes=${PART}-${PART * 2 - 1}`, `bytes=${PART * 2}-${PART * 2}`].sort());
            const meta = await (await cache.match('/test/resume.bin?__meta=1'))!.json();
            expect(meta.complete).toBe(true);
        });

        it('prunes entries by URL and deletes all parts of a single asset', async () => {
            const { stores, open } = installCacheMock();
            const cache = await open(CACHE);
            for (const key of [
                '/libreoffice-wasm/a.gz?v=old&__part=0',
                '/libreoffice-wasm/a.gz?v=old&__meta=1',
                '/libreoffice-wasm/a.gz?v=new&__part=0',
                '/fonts/x.ttf?v=old&__part=0',
                '/fonts/x.ttf?v=old&__meta=1',
            ]) {
                await cache.put(key, new Response('x'));
            }

            const { pruneCachedAssets, deleteCachedAsset } = await load();
            const removed = await pruneCachedAssets((u) => u.pathname.startsWith('/libreoffice-wasm/') && u.searchParams.get('v') !== 'new');
            expect(removed).toBe(2);

            await deleteCachedAsset('/fonts/x.ttf?v=old');
            expect([...stores.get(CACHE)!.keys()]).toEqual(['/libreoffice-wasm/a.gz?v=new&__part=0']);
        });

        it('removes the old whole-file cache that Chrome could not store large engines in', async () => {
            const { stores, open } = installCacheMock();
            await (await open('atlaspdf-wasm-cache-v1')).put('/old', new Response('x'));
            vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) =>
                init?.method === 'HEAD' ? head(5) : fakeResponse({ contentLength: 5, blobSize: 5 })));

            const { fetchAssembledBlob } = await load();
            await fetchAssembledBlob('/test/any.bin');

            expect(stores.has('atlaspdf-wasm-cache-v1')).toBe(false);
        });
    });
});
