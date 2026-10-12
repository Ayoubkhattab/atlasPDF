/**
 * PDF to DOCX Processor
 *
 * Converts PDF files to Word documents (DOCX).
 * Uses Pyodide via a shared Web Worker (./pdf-to-docx-worker.ts) to avoid blocking the UI
 * and to avoid paying the ~50MB Pyodide/pdf2docx init cost on every single conversion.
 */

import type {
    ProcessInput,
    ProcessOutput,
    ProgressCallback,
} from '@/types/pdf';
import { PDFErrorCode } from '@/types/pdf';
import { BasePDFProcessor } from '../processor';
import { cancelPdfToDocxConversion, convertPdfToDocx } from '../pdf-to-docx-worker';

/** Matches the limit every other document-conversion processor (word/pptx/rtf/excel-to-pdf)
 *  already enforces. This file was previously the one exception with no size guard at all. */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * PDF to DOCX options (none yet — kept as a type so the signature matches the other
 * *-to-pdf/docx processors, which all take an options object).
 */
export type PDFToDocxOptions = Record<string, never>;

/**
 * PDF to DOCX Processor
 * Converts PDF files to DOCX via the shared pdf-to-docx worker.
 */
export class PDFToDocxProcessor extends BasePDFProcessor {
    /**
     * Reset processor state
     */
    protected reset(): void {
        super.reset();
    }

    /**
     * Stops the in-flight conversion for real, not just cooperatively. The base class's
     * cancel() only flips a flag this.checkCancelled() reads between awaits — nothing was
     * ever checking it *during* the Pyodide call, so a "cancelled" conversion used to keep
     * running to completion in the background regardless. cancelPdfToDocxConversion()
     * terminates the shared worker outright; see its doc comment for why that, rather than a
     * cooperative interrupt, is the only reliable way to actually stop pdf2docx mid-flight.
     */
    cancel(): void {
        super.cancel();
        cancelPdfToDocxConversion();
    }

    /**
     * Process PDF and convert to DOCX
     */
    async process(
        input: ProcessInput,
        onProgress?: ProgressCallback
    ): Promise<ProcessOutput> {
        this.reset();
        this.onProgress = onProgress;

        const { files } = input;

        // Validate we have exactly 1 PDF file
        if (files.length !== 1) {
            return this.createErrorOutput(
                PDFErrorCode.INVALID_OPTIONS,
                'Please provide exactly one PDF file.',
                `Received ${files.length} file(s).`
            );
        }

        const file = files[0];

        // Validate file type
        if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
            return this.createErrorOutput(
                PDFErrorCode.FILE_TYPE_INVALID,
                'Invalid file type. Please upload a PDF file.',
                `Received: ${file.type || 'unknown'}`
            );
        }

        if (file.size > MAX_FILE_SIZE) {
            return this.createErrorOutput(
                PDFErrorCode.INVALID_OPTIONS,
                `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum supported size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
                `File size: ${file.size} bytes, limit: ${MAX_FILE_SIZE} bytes`
            );
        }

        try {
            this.updateProgress(2, 'Starting conversion...');

            if (this.checkCancelled()) {
                return this.createErrorOutput(
                    PDFErrorCode.PROCESSING_CANCELLED,
                    'Processing was cancelled.'
                );
            }

            const docxBlob = await convertPdfToDocx(file, (progress) => {
                this.updateProgress(progress.percent, progress.message);
            });

            if (this.checkCancelled()) {
                return this.createErrorOutput(
                    PDFErrorCode.PROCESSING_CANCELLED,
                    'Processing was cancelled.'
                );
            }

            this.updateProgress(100, 'Conversion complete!');

            const baseName = file.name.replace(/\.pdf$/i, '');
            const outputName = `${baseName}.docx`;

            return this.createSuccessOutput(
                docxBlob,
                outputName,
                { format: 'docx' }
            );

        } catch (error) {
            console.error('Conversion error:', error);

            // cancel() terminates the worker, which surfaces here as a rejected promise —
            // report it as a cancellation, not a generic failure.
            if (this.checkCancelled()) {
                return this.createErrorOutput(
                    PDFErrorCode.PROCESSING_CANCELLED,
                    'Processing was cancelled.'
                );
            }

            return this.createErrorOutput(
                PDFErrorCode.PROCESSING_FAILED,
                'Failed to convert PDF to DOCX.',
                error instanceof Error ? error.message : 'Unknown error'
            );
        }
    }
}

/**
 * Create a new instance of the PDF to DOCX processor
 */
export function createPDFToDocxProcessor(): PDFToDocxProcessor {
    return new PDFToDocxProcessor();
}

/**
 * Convert PDF to DOCX (convenience function)
 */
export async function pdfToDocx(
    file: File,
    options?: Partial<PDFToDocxOptions>,
    onProgress?: ProgressCallback
): Promise<ProcessOutput> {
    const processor = createPDFToDocxProcessor();
    return processor.process(
        {
            files: [file],
            options: options || {},
        },
        onProgress
    );
}
