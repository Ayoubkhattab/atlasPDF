import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConvertPdfToDocx, mockCancelPdfToDocxConversion } = vi.hoisted(() => ({
    mockConvertPdfToDocx: vi.fn(),
    mockCancelPdfToDocxConversion: vi.fn(),
}));

vi.mock('@/lib/pdf/pdf-to-docx-worker', () => ({
    convertPdfToDocx: (...args: unknown[]) => mockConvertPdfToDocx(...args),
    cancelPdfToDocxConversion: () => mockCancelPdfToDocxConversion(),
}));

import { createPDFToDocxProcessor, pdfToDocx } from '@/lib/pdf/processors/pdf-to-docx';
import type { PdfToDocxProgress } from '@/lib/pdf/pdf-to-docx-worker';
import { PDFErrorCode } from '@/types/pdf';

beforeEach(() => {
    vi.clearAllMocks();
});

describe('PDFToDocxProcessor', () => {
    it('rejects anything other than exactly one file', async () => {
        const processor = createPDFToDocxProcessor();
        const result = await processor.process({ files: [], options: {} });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PDFErrorCode.INVALID_OPTIONS);
        expect(mockConvertPdfToDocx).not.toHaveBeenCalled();
    });

    it('rejects a non-PDF file type', async () => {
        const processor = createPDFToDocxProcessor();
        const file = new File(['hello'], 'notes.docx', {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });

        const result = await processor.process({ files: [file], options: {} });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PDFErrorCode.FILE_TYPE_INVALID);
        expect(mockConvertPdfToDocx).not.toHaveBeenCalled();
    });

    it('rejects a PDF over the 50MB limit — previously this processor had no size guard at all', async () => {
        const processor = createPDFToDocxProcessor();
        const big = new File([new Uint8Array(1)], 'big.pdf', { type: 'application/pdf' });
        Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });

        const result = await processor.process({ files: [big], options: {} });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PDFErrorCode.INVALID_OPTIONS);
        expect(mockConvertPdfToDocx).not.toHaveBeenCalled();
    });

    it('accepts a PDF at exactly the 50MB limit', async () => {
        const processor = createPDFToDocxProcessor();
        const file = new File([new Uint8Array(1)], 'exact.pdf', { type: 'application/pdf' });
        Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });
        mockConvertPdfToDocx.mockResolvedValue(new Blob(['docx']));

        const result = await processor.process({ files: [file], options: {} });

        expect(result.success).toBe(true);
    });

    it('returns the converted blob named after the input, via the shared worker', async () => {
        const processor = createPDFToDocxProcessor();
        const file = new File(['pdf-bytes'], 'report.pdf', { type: 'application/pdf' });
        const docxBlob = new Blob(['docx-bytes']);
        mockConvertPdfToDocx.mockResolvedValue(docxBlob);

        const result = await processor.process({ files: [file], options: {} });

        expect(result.success).toBe(true);
        expect(result.result).toBe(docxBlob);
        expect(result.filename).toBe('report.docx');
        expect(mockConvertPdfToDocx).toHaveBeenCalledTimes(1);
        expect(mockConvertPdfToDocx.mock.calls[0][0]).toBe(file);
    });

    it('forwards the shared worker\'s progress to onProgress', async () => {
        const processor = createPDFToDocxProcessor();
        const file = new File(['pdf-bytes'], 'report.pdf', { type: 'application/pdf' });
        const seen: Array<[number, string | undefined]> = [];

        mockConvertPdfToDocx.mockImplementation(async (_file: File, onProgress: (p: PdfToDocxProgress) => void) => {
            onProgress({ phase: 'loading', percent: 10, message: 'Loading core packages...' });
            onProgress({ phase: 'converting', percent: 60, message: 'Converting to DOCX...' });
            return new Blob(['docx']);
        });

        await processor.process({ files: [file], options: {} }, (percent, message) => {
            seen.push([percent, message]);
        });

        expect(seen).toContainEqual([10, 'Loading core packages...']);
        expect(seen).toContainEqual([60, 'Converting to DOCX...']);
    });

    it('reports a failed conversion as PROCESSING_FAILED with the worker\'s message', async () => {
        const processor = createPDFToDocxProcessor();
        const file = new File(['pdf-bytes'], 'bad.pdf', { type: 'application/pdf' });
        mockConvertPdfToDocx.mockRejectedValue(new Error('input.pdf is encrypted'));

        const result = await processor.process({ files: [file], options: {} });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PDFErrorCode.PROCESSING_FAILED);
        expect(result.error?.details).toBe('input.pdf is encrypted');
    });

    it('cancel() actually tears the shared worker down, not just a local flag', async () => {
        const processor = createPDFToDocxProcessor();
        processor.cancel();

        expect(mockCancelPdfToDocxConversion).toHaveBeenCalledTimes(1);
    });

    it('reports PROCESSING_CANCELLED, not a generic failure, when cancel() interrupts an in-flight conversion', async () => {
        const processor = createPDFToDocxProcessor();
        const file = new File(['pdf-bytes'], 'report.pdf', { type: 'application/pdf' });

        mockConvertPdfToDocx.mockImplementation(() => {
            // cancel() is called while the shared worker "is converting" — simulated here by
            // calling it synchronously once the mocked convert call has started.
            processor.cancel();
            return Promise.reject(new Error('Conversion cancelled'));
        });

        const result = await processor.process({ files: [file], options: {} });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe(PDFErrorCode.PROCESSING_CANCELLED);
    });

    it('pdfToDocx() convenience function delegates to a processor the same way', async () => {
        const file = new File(['pdf-bytes'], 'report.pdf', { type: 'application/pdf' });
        mockConvertPdfToDocx.mockResolvedValue(new Blob(['docx']));

        const result = await pdfToDocx(file);

        expect(result.success).toBe(true);
    });
});
