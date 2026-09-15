import { describe, it, expect, afterEach } from 'vitest';
import { RTFToPDFProcessor } from '@/lib/pdf/processors/rtf-to-pdf';
import { PDFErrorCode } from '@/types/pdf';

function setCrossOriginIsolated(value: boolean | undefined) {
    Object.defineProperty(window, 'crossOriginIsolated', {
        value,
        configurable: true,
    });
}

describe('RTFToPDFProcessor', () => {
    afterEach(() => {
        setCrossOriginIsolated(undefined);
    });

    it('rejects a non-RTF file type', async () => {
        const processor = new RTFToPDFProcessor();
        const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });

        const result = await processor.process({ files: [file], options: {} });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PDFErrorCode.FILE_TYPE_INVALID);
    });

    it('rejects a file over the 50MB size limit', async () => {
        const processor = new RTFToPDFProcessor();
        const big = new File([new Uint8Array(1)], 'doc.rtf', { type: 'application/rtf' });
        Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });

        const result = await processor.process({ files: [big], options: {} });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PDFErrorCode.INVALID_OPTIONS);
    });

    it('regression: fails fast with an actionable message when Cross-Origin Isolation is missing, instead of attempting a doomed LibreOffice download', async () => {
        // RTF conversion has no fallback engine unlike word-to-pdf/excel-to-pdf,
        // so without this pre-flight check it used to fall straight through to
        // getSharedLibreOfficeConverter() and only fail deep inside the ~250MB
        // WASM engine load, with whatever error that layer happens to surface.
        setCrossOriginIsolated(false);
        const processor = new RTFToPDFProcessor();
        const file = new File(['rtf-bytes'], 'doc.rtf', { type: 'application/rtf' });

        const result = await processor.process({ files: [file], options: {} });

        expect(result.success).toBe(false);
        expect(result.error?.message).toContain('Cross-Origin Isolation');
    });
});
