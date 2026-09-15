/**
 * In-browser gzip decoding for the LibreOffice engine files.
 *
 * The engine is committed as soffice.wasm.bin.gz / soffice.data.bin.gz (the raw files exceed
 * GitHub's 100MB limit). Requesting those .gz files directly means every host serves them as
 * plain bytes - no gzip_static, Content-Encoding or MIME configuration involved - and byte
 * ranges line up with the file on disk, so downloads can resume. The browser's native
 * DecompressionStream then restores the original bytes.
 */

const GZIP_MAGIC = [0x1f, 0x8b, 0x08] as const;

export async function isGzip(blob: Blob): Promise<boolean> {
    if (blob.size < GZIP_MAGIC.length) return false;
    const head = new Uint8Array(await blob.slice(0, GZIP_MAGIC.length).arrayBuffer());
    return GZIP_MAGIC.every((byte, i) => head[i] === byte);
}

/**
 * Returns the decompressed contents, typed as `type`.
 *
 * If the host already decoded the file (it served the .gz with `Content-Encoding: gzip`, so
 * fetch() handed back the raw bytes), the data is passed through untouched. A corrupt or
 * truncated gzip stream rejects - DecompressionStream verifies the gzip CRC and length.
 *
 * The output is collected into memory first rather than with `new Response(stream).blob()`:
 * Chrome registers a streamed Blob of unknown size by writing it to disk, and refuses that
 * when free disk space is low - the read then fails with a bare "TypeError: Failed to fetch".
 * A Blob built from an in-memory buffer of this size (~100-150MB) stays in memory.
 */
export async function gunzipBlobIfNeeded(blob: Blob, type: string): Promise<Blob> {
    if (!(await isGzip(blob))) {
        return blob.type === type ? blob : new Blob([blob], { type });
    }
    if (typeof DecompressionStream === 'undefined') {
        throw new Error(
            'This browser cannot decompress the conversion engine (DecompressionStream is not supported). Please update your browser.'
        );
    }
    const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
    const decompressed = await new Response(stream).arrayBuffer();
    return new Blob([decompressed], { type });
}
