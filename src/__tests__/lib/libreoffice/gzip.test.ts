// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'node:zlib';
import { gunzipBlobIfNeeded, isGzip } from '@/lib/libreoffice/gzip';

const original = new Uint8Array(Array.from({ length: 5000 }, (_, i) => (i * 31) % 251));

describe('gunzipBlobIfNeeded', () => {
    it('decompresses a gzip blob and types the result', async () => {
        const out = await gunzipBlobIfNeeded(new Blob([gzipSync(original)]), 'application/wasm');

        expect(out.type).toBe('application/wasm');
        expect(new Uint8Array(await out.arrayBuffer())).toEqual(original);
    });

    it('passes data through when the host already decoded it', async () => {
        const wasmHeader = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
        const out = await gunzipBlobIfNeeded(new Blob([wasmHeader]), 'application/wasm');

        expect(out.type).toBe('application/wasm');
        expect(new Uint8Array(await out.arrayBuffer())).toEqual(wasmHeader);
    });

    it('rejects a truncated gzip stream instead of returning partial data', async () => {
        const gz = gzipSync(original);
        await expect(gunzipBlobIfNeeded(new Blob([gz.subarray(0, gz.length - 12)]), 'application/wasm')).rejects.toThrow();
    });

    it('does not treat tiny or non-gzip blobs as gzip', async () => {
        expect(await isGzip(new Blob([new Uint8Array([0x1f])]))).toBe(false);
        expect(await isGzip(new Blob(['hello']))).toBe(false);
        expect(await isGzip(new Blob([gzipSync(original)]))).toBe(true);
    });
});
