/**
 * Workflow Executor Tests
 * Tests for node execution and file handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collectInputFiles } from '@/lib/workflow/executor';
import type { WorkflowNode, WorkflowEdge, WorkflowOutputFile } from '@/types/workflow';

// pdf-to-markdown and find-and-redact both extract text via pdfjs-dist's
// getDocument/getPage/getTextContent, which needs a real worker thread that
// jsdom can't provide ("Setting up fake worker failed"). Mock pdfjs-dist so
// these two executor cases can be exercised end-to-end without a worker.
// Uses vi.hoisted so the mutable text-items fixture is available inside the
// hoisted vi.mock factory below.
const { getMockPdfTextItems, setMockPdfTextItems } = vi.hoisted(() => {
    let items: Array<{ str: string; transform: number[]; width: number; height: number; fontName: string }> = [];
    return {
        getMockPdfTextItems: () => items,
        setMockPdfTextItems: (next: typeof items) => { items = next; },
    };
});

vi.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: {},
    getDocument: () => ({
        promise: Promise.resolve({
            numPages: 1,
            getPage: async () => ({
                getTextContent: async () => ({ items: getMockPdfTextItems() }),
                getAnnotations: async () => [],
                getViewport: () => ({ width: 612, height: 792 }),
                render: () => ({ promise: Promise.resolve() }),
            }),
        }),
    }),
}));

// vector-extractor uses a separate legacy pdf.js build via this loader (not
// the already-mocked 'pdfjs-dist'). typeof window !== 'undefined' is true
// under jsdom, so it takes the real-SVGGraphics branch - mock both exports.
vi.mock('@/lib/pdf/loader-legacy', () => ({
    loadPdfjsLegacy: async () => ({
        getDocument: () => ({
            promise: Promise.resolve({
                numPages: 1,
                getPage: async () => ({
                    getViewport: () => ({ width: 612, height: 792 }),
                    getOperatorList: async () => ({}),
                    commonObjs: {},
                    objs: {},
                }),
            }),
        }),
    }),
    loadSVGGraphics: async () => {
        return class MockSVGGraphics {
            async getSVG() {
                return {
                    removeAttribute: vi.fn(),
                    setAttribute: vi.fn(),
                    outerHTML: '<svg></svg>',
                };
            }
        };
    },
}));

// A permissive 2D canvas context stub shared by tools that rasterize via
// document.createElement('canvas') (pdf-to-cbz, batch-barcode-injector,
// handwriting-ink-contrast-booster, signature-ink-optimizer) - jsdom has no
// real canvas backend (no `canvas` npm package installed).
function installCanvasMock() {
    const ctxStub: Record<string, unknown> = {
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        getImageData: () => ({ data: new Uint8ClampedArray(4) }),
        putImageData: vi.fn(),
        fillText: vi.fn(),
        strokeRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        closePath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
    };
    const mockCanvas = {
        width: 0,
        height: 0,
        getContext: () => ctxStub,
        toBlob: (cb: (b: Blob | null) => void) => {
            const blob = new Blob(['x'], { type: 'image/png' }) as any;
            blob.arrayBuffer = async () => new ArrayBuffer(1);
            cb(blob);
        },
        toDataURL: () => `data:image/png;base64,${ONE_PX_PNG_BASE64}`,
    };
    const realCreateElement = document.createElement.bind(document);
    return vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'canvas') return mockCanvas as unknown as HTMLCanvasElement;
        return realCreateElement(tag);
    });
}

// Helper to create a real minimal PDF using pdf-lib (same pattern as src/__tests__/lib/pdf/overlay.test.ts)
async function createRealPDFFile(name: string, pageCount: number = 1): Promise<File> {
    const { PDFDocument } = await import('pdf-lib');
    const pdfDoc = await PDFDocument.create();

    for (let i = 0; i < pageCount; i++) {
        const page = pdfDoc.addPage([612, 792]);
        page.drawText(' ', { x: 0, y: 0 });
    }

    const pdfBytes = await pdfDoc.save();
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
    const file = new File([blob], name, { type: 'application/pdf' }) as any;
    file.arrayBuffer = async () => pdfBytes.buffer.slice(0) as ArrayBuffer;
    return file as File;
}

// A valid 1x1 transparent PNG, used to test image-watermark embedding
const ONE_PX_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function createRealPNGFile(name: string = 'stamp.png'): File {
    const bytes = Uint8Array.from(atob(ONE_PX_PNG_BASE64), (c) => c.charCodeAt(0));
    const file = new File([bytes], name, { type: 'image/png' }) as any;
    file.arrayBuffer = async () => bytes.buffer.slice(0) as ArrayBuffer;
    return file as File;
}

function buildNode(toolId: string, settings: Record<string, unknown>, acceptedFormats: string[] = ['.pdf']): WorkflowNode {
    return {
        id: `${toolId}-node`,
        type: 'toolNode',
        position: { x: 0, y: 0 },
        data: {
            toolId,
            label: toolId,
            icon: 'file',
            category: 'organize',
            acceptedFormats,
            outputFormat: '.pdf',
            status: 'idle',
            progress: 0,
            settings,
        },
    };
}

function buildWatermarkNode(settings: Record<string, unknown>): WorkflowNode {
    return {
        id: 'wm-node',
        type: 'toolNode',
        position: { x: 0, y: 0 },
        data: {
            toolId: 'add-watermark',
            label: 'Add Watermark',
            icon: 'droplet',
            category: 'edit-annotate',
            acceptedFormats: ['.pdf'],
            outputFormat: '.pdf',
            status: 'idle',
            progress: 0,
            settings,
        },
    };
}

describe('Workflow Executor', () => {
    describe('collectInputFiles', () => {
        const nodes: WorkflowNode[] = [
            {
                id: 'node1',
                type: 'toolNode',
                position: { x: 0, y: 0 },
                data: {
                    toolId: 'merge-pdf',
                    label: 'Merge PDF',
                    icon: 'file-plus',
                    category: 'organize',
                    acceptedFormats: ['.pdf'],
                    outputFormat: '.pdf',
                    status: 'idle',
                    progress: 0,
                    inputFiles: [
                        new File([new Blob(['test1'])], 'input1.pdf', { type: 'application/pdf' }),
                        new File([new Blob(['test2'])], 'input2.pdf', { type: 'application/pdf' }),
                    ],
                },
            },
            {
                id: 'node2',
                type: 'toolNode',
                position: { x: 200, y: 0 },
                data: {
                    toolId: 'compress-pdf',
                    label: 'Compress PDF',
                    icon: 'minimize',
                    category: 'optimize',
                    acceptedFormats: ['.pdf'],
                    outputFormat: '.pdf',
                    status: 'idle',
                    progress: 0,
                },
            },
        ];

        const edges: WorkflowEdge[] = [
            { id: 'e1-2', source: 'node1', target: 'node2' },
        ];

        it('should return input files for nodes without parents', () => {
            const inputs = collectInputFiles('node1', nodes, [], new Map());
            expect(inputs).toHaveLength(2);
            expect(inputs[0]).toBeInstanceOf(File);
        });

        it('should return empty array for nodes without parents or input files', () => {
            const nodesWithoutInput = nodes.map(n => ({
                ...n,
                data: { ...n.data, inputFiles: undefined },
            }));
            const inputs = collectInputFiles('node1', nodesWithoutInput, [], new Map());
            expect(inputs).toHaveLength(0);
        });

        it('should prefer inputAssignments over stale node.data.inputFiles', () => {
            const assigned = new File([new Blob(['png'])], 'only.png', { type: 'image/png' });
            const assignments = new Map<string, File[]>([['node1', [assigned]]]);
            const inputs = collectInputFiles('node1', nodes, [], new Map(), assignments);
            expect(inputs).toHaveLength(1);
            expect((inputs[0] as File).name).toBe('only.png');
        });

        it('should collect outputs from parent nodes', () => {
            const nodeOutputs = new Map<string, (Blob | WorkflowOutputFile)[]>();
            const output1: WorkflowOutputFile = {
                blob: new Blob(['output1'], { type: 'application/pdf' }),
                filename: 'merged.pdf',
            };
            nodeOutputs.set('node1', [output1]);

            const inputs = collectInputFiles('node2', nodes, edges, nodeOutputs);
            expect(inputs).toHaveLength(1);
            expect(inputs[0]).toEqual(output1);
        });

        it('should collect outputs from multiple parent nodes', () => {
            const multiParentEdges: WorkflowEdge[] = [
                { id: 'e1-2', source: 'node1', target: 'node2' },
                { id: 'e3-2', source: 'node3', target: 'node2' },
            ];

            const node3: WorkflowNode = {
                id: 'node3',
                type: 'toolNode',
                position: { x: 0, y: 100 },
                data: {
                    toolId: 'rotate-pdf',
                    label: 'Rotate PDF',
                    icon: 'rotate-cw',
                    category: 'organize',
                    acceptedFormats: ['.pdf'],
                    outputFormat: '.pdf',
                    status: 'idle',
                    progress: 0,
                },
            };

            const nodeOutputs = new Map<string, (Blob | WorkflowOutputFile)[]>();
            nodeOutputs.set('node1', [{
                blob: new Blob(['output1'], { type: 'application/pdf' }),
                filename: 'out1.pdf',
            }]);
            nodeOutputs.set('node3', [{
                blob: new Blob(['output3'], { type: 'application/pdf' }),
                filename: 'out3.pdf',
            }]);

            const inputs = collectInputFiles('node2', [...nodes, node3], multiParentEdges, nodeOutputs);
            expect(inputs).toHaveLength(2);
        });

        it('should handle Blob outputs without metadata', () => {
            const nodeOutputs = new Map<string, (Blob | WorkflowOutputFile)[]>();
            const plainBlob = new Blob(['plain output'], { type: 'application/pdf' });
            nodeOutputs.set('node1', [plainBlob]);

            const inputs = collectInputFiles('node2', nodes, edges, nodeOutputs);
            expect(inputs).toHaveLength(1);
            expect(inputs[0]).toBeInstanceOf(Blob);
        });
    });

    describe('executeNode - ocr-pdf', () => {
        it('throws error if files array is empty', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const ocrNode: WorkflowNode = {
                id: 'ocr-node',
                type: 'toolNode',
                position: { x: 0, y: 0 },
                data: {
                    toolId: 'ocr-pdf',
                    label: 'OCR PDF',
                    icon: 'scan-text',
                    category: 'organize-manage',
                    acceptedFormats: ['.pdf', '.png', '.jpg', '.jpeg', '.webp'],
                    outputFormat: 'pdf',
                    status: 'idle',
                    progress: 0,
                    settings: {
                        language: 'chi_sim',
                    },
                },
            };

            const result = await executeNode(ocrNode, []);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('No input file');
        });
    });

    describe('executeNode - add-watermark', () => {
        it('embeds the uploaded image when watermarkType is image', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const imageFile = createRealPNGFile();
            const node = buildWatermarkNode({ watermarkType: 'image', imageFile });

            const result = await executeNode(node, [pdfFile]);

            expect(result.success).toBe(true);
            expect(result.result).toBeInstanceOf(Blob);
        });

        it('fails with a clear validation error when image watermark has no image', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const node = buildWatermarkNode({ watermarkType: 'image' });

            const result = await executeNode(node, [pdfFile]);

            expect(result.success).toBe(false);
            expect(result.error?.message.toLowerCase()).toContain('image');
        });
    });

    describe('executeNode - output nodes', () => {
        it('handles download-pdf with custom filename', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const file = new File(['dummy pdf content'], 'test.pdf', { type: 'application/pdf' });
            const downloadNode: WorkflowNode = {
                id: 'dl-node',
                type: 'toolNode',
                position: { x: 0, y: 0 },
                data: {
                    toolId: 'download-pdf',
                    label: 'Download PDF',
                    icon: 'file-down',
                    category: 'output',
                    acceptedFormats: ['application/pdf'],
                    outputFormat: 'application/pdf',
                    status: 'idle',
                    progress: 0,
                    settings: {
                        filename: 'custom_report.pdf',
                    },
                },
            };

            const result = await executeNode(downloadNode, [file]);
            expect(result.success).toBe(true);
            expect(result.filename).toBe('custom_report.pdf');
        });

        it('handles download-zip by bundling multiple files', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const file1 = new File(['file 1 content'], 'page1.pdf', { type: 'application/pdf' });
            const file2 = new File(['file 2 content'], 'page2.pdf', { type: 'application/pdf' });
            const zipNode: WorkflowNode = {
                id: 'zip-node',
                type: 'toolNode',
                position: { x: 0, y: 0 },
                data: {
                    toolId: 'download-zip',
                    label: 'Download ZIP',
                    icon: 'archive',
                    category: 'output',
                    acceptedFormats: ['*'],
                    outputFormat: 'application/zip',
                    status: 'idle',
                    progress: 0,
                    settings: {
                        filename: 'archive_bundle.zip',
                    },
                },
            };

            const result = await executeNode(zipNode, [file1, file2]);
            expect(result.success).toBe(true);
            expect(result.filename).toBe('archive_bundle.zip');
            expect(result.result).toBeInstanceOf(Blob);
            expect(result.metadata?.fileCount).toBe(2);
        });
    });

    describe('executeNode - crop-pdf', () => {
        it('crops a PDF using margin settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const node = buildNode('crop-pdf', { marginTop: 50, marginBottom: 50, marginLeft: 30, marginRight: 30 });

            const result = await executeNode(node, [pdfFile]);

            expect(result.success).toBe(true);
            expect(result.result).toBeInstanceOf(Blob);
        });

        it('regression: the built-in crop-and-resize template no longer fails with "not supported"', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const { workflowTemplates } = await import('@/config/workflow-templates');
            const template = workflowTemplates.find((t) => t.id === 'crop-and-resize');
            expect(template).toBeDefined();

            const cropNode = template!.nodes.find((n) => n.id === 'crop-1');
            expect(cropNode).toBeDefined();
            expect(cropNode!.data.toolId).toBe('crop-pdf');

            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(cropNode!, [pdfFile]);

            expect(result.success).toBe(true);
        });
    });

    describe('executeNode - timestamp-pdf', () => {
        it('applies a local timestamp with the default profile', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const node = buildNode('timestamp-pdf', {});

            const result = await executeNode(node, [pdfFile]);

            expect(result.success).toBe(true);
            expect(result.result).toBeInstanceOf(Blob);
        });
    });

    describe('executeNode - overlay-pdf', () => {
        it('overlays a layer PDF onto a base PDF', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const base = await createRealPDFFile('base.pdf', 3);
            const layer = await createRealPDFFile('layer.pdf', 1);
            const node = buildNode('overlay-pdf', { mode: 'overlay' });

            const result = await executeNode(node, [base, layer]);

            expect(result.success).toBe(true);
            expect(result.result).toBeInstanceOf(Blob);
        });

        it('fails with a clear error when given only one file', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const base = await createRealPDFFile('base.pdf');
            const node = buildNode('overlay-pdf', { mode: 'overlay' });

            const result = await executeNode(node, [base]);

            expect(result.success).toBe(false);
            expect(result.error?.message).toContain('2 PDF files');
        });
    });

    describe('executeNode - add-page-labels', () => {
        it('injects page labels using a single global rule', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf', 5);
            const node = buildNode('add-page-labels', { style: 'D', pageRange: '' });

            const result = await executeNode(node, [pdfFile]);

            expect(result.success).toBe(true);
            expect(result.result).toBeInstanceOf(Blob);
        });
    });

    describe('executeNode - pdf-to-markdown', () => {
        beforeEach(() => {
            setMockPdfTextItems([
                { str: 'Hello world', transform: [12, 0, 0, 12, 50, 700], width: 80, height: 12, fontName: 'Helvetica' },
            ]);
        });

        it('converts a PDF to markdown', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const node = buildNode('pdf-to-markdown', {});

            const result = await executeNode(node, [pdfFile]);

            expect(result.success).toBe(true);
            expect(result.result).toBeInstanceOf(Blob);
        });
    });

    describe('executeNode - find-and-redact', () => {
        beforeEach(() => {
            setMockPdfTextItems([
                { str: 'CONFIDENTIAL', transform: [12, 0, 0, 12, 50, 700], width: 120, height: 12, fontName: 'Helvetica' },
            ]);
        });

        async function createPdfWithText(text: string): Promise<File> {
            const { PDFDocument, StandardFonts } = await import('pdf-lib');
            const pdfDoc = await PDFDocument.create();
            const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
            const page = pdfDoc.addPage([612, 792]);
            page.drawText(text, { x: 50, y: 700, size: 24, font });

            const pdfBytes = await pdfDoc.save();
            const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
            const file = new File([blob], 'doc.pdf', { type: 'application/pdf' }) as any;
            file.arrayBuffer = async () => pdfBytes.buffer.slice(0) as ArrayBuffer;
            return file as File;
        }

        it('redacts matching text', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createPdfWithText('CONFIDENTIAL');
            const node = buildNode('find-and-redact', { searchTerm: 'CONFIDENTIAL' });

            const result = await executeNode(node, [pdfFile]);

            expect(result.success).toBe(true);
            expect(result.result).toBeInstanceOf(Blob);
        });

        it('fails with a clear validation error when searchTerm is empty', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createPdfWithText('CONFIDENTIAL');
            const node = buildNode('find-and-redact', { searchTerm: '' });

            const result = await executeNode(node, [pdfFile]);

            expect(result.success).toBe(false);
            expect(result.error?.message.toLowerCase()).toContain('search term');
        });
    });

    describe('executeNode - newly-wired tools (batch 2)', () => {
        it('smart-data-redactor succeeds with default patterns', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('smart-data-redactor', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('pdf-to-cbz succeeds with default settings', async () => {
            const spy = installCanvasMock();
            try {
                const { executeNode } = await import('@/lib/workflow/executor');
                const pdfFile = await createRealPDFFile('comic.pdf');
                const result = await executeNode(buildNode('pdf-to-cbz', {}), [pdfFile]);
                expect(result.success).toBe(true);
            } finally {
                spy.mockRestore();
            }
        });

        it('pdf-to-slide succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('pdf-to-slide', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('pdf-page-resizer-uniform succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('pdf-page-resizer-uniform', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('pdf-deskew-aligner succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('pdf-deskew-aligner', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('interactive-toc-generator succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf', 3);
            const result = await executeNode(buildNode('interactive-toc-generator', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('bookmarks-auto-generator succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf', 3);
            const result = await executeNode(buildNode('bookmarks-auto-generator', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('batch-barcode-injector succeeds with default settings', async () => {
            const spy = installCanvasMock();
            try {
                const { executeNode } = await import('@/lib/workflow/executor');
                const pdfFile = await createRealPDFFile('doc.pdf');
                const result = await executeNode(buildNode('batch-barcode-injector', {}), [pdfFile]);
                expect(result.success).toBe(true);
            } finally {
                spy.mockRestore();
            }
        });

        it('cert-cryptor succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('cert-cryptor', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('vector-extractor succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('vector-extractor', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('deep-sanitize succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('deep-sanitize', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('batch-watermark-remover succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('batch-watermark-remover', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('annotation-exporter succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('annotation-exporter', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('ai-pdf-reflower succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('ai-pdf-reflower', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('citation-linker succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('citation-linker', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('eink-optimizer succeeds with default settings (no canvas mock needed)', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('eink-optimizer', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('passport-id-composer succeeds with a single (front-only) image', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const front = createRealPNGFile('front.png');
            const result = await executeNode(buildNode('passport-id-composer', {}, ['.jpg', '.jpeg', '.png']), [front]);
            expect(result.success).toBe(true);
        });

        it('passport-id-composer succeeds with front+back images in one call', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const front = createRealPNGFile('front.png');
            const back = createRealPNGFile('back.png');
            const result = await executeNode(buildNode('passport-id-composer', {}, ['.jpg', '.jpeg', '.png']), [front, back]);
            expect(result.success).toBe(true);
        });

        it('photo-tiling-prepress succeeds with an image input', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const photo = createRealPNGFile('photo.png');
            const result = await executeNode(buildNode('photo-tiling-prepress', {}, ['.jpg', '.jpeg', '.png']), [photo]);
            expect(result.success).toBe(true);
        });

        it('booklet-folding-simulator succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf', 8);
            const result = await executeNode(buildNode('booklet-folding-simulator', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('pdf-lossless-slicer succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('pdf-lossless-slicer', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('pdf-scratchpad-canvas succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('pdf-scratchpad-canvas', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('pdf-signature-anchor-helper succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('pdf-signature-anchor-helper', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('pdf-spine-bookbinder succeeds with zero input files (design without uploading)', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const result = await executeNode(buildNode('pdf-spine-bookbinder', {}), []);
            expect(result.success).toBe(true);
        });

        it('pdf-two-column-reflower succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('doc.pdf');
            const result = await executeNode(buildNode('pdf-two-column-reflower', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });

        it('handwriting-ink-contrast-booster succeeds with an image input', async () => {
            const spy = installCanvasMock();
            const originalCreateImageBitmap = (global as any).createImageBitmap;
            (global as any).createImageBitmap = vi.fn().mockResolvedValue({ width: 10, height: 10 });
            try {
                const { executeNode } = await import('@/lib/workflow/executor');
                const image = createRealPNGFile('ink.png');
                const result = await executeNode(buildNode('handwriting-ink-contrast-booster', {}, ['.jpg', '.jpeg', '.png']), [image]);
                expect(result.success).toBe(true);
            } finally {
                spy.mockRestore();
                (global as any).createImageBitmap = originalCreateImageBitmap;
            }
        });

        it('signature-ink-optimizer succeeds with an image input', async () => {
            const spy = installCanvasMock();
            const originalCreateImageBitmap = (global as any).createImageBitmap;
            (global as any).createImageBitmap = vi.fn().mockResolvedValue({ width: 10, height: 10 });
            try {
                const { executeNode } = await import('@/lib/workflow/executor');
                const image = createRealPNGFile('sig.png');
                const result = await executeNode(buildNode('signature-ink-optimizer', {}, ['.jpg', '.jpeg', '.png']), [image]);
                expect(result.success).toBe(true);
            } finally {
                spy.mockRestore();
                (global as any).createImageBitmap = originalCreateImageBitmap;
            }
        });

        it('global-invoice-parser succeeds with default settings', async () => {
            const { executeNode } = await import('@/lib/workflow/executor');
            const pdfFile = await createRealPDFFile('invoice.pdf');
            const result = await executeNode(buildNode('global-invoice-parser', {}), [pdfFile]);
            expect(result.success).toBe(true);
        });
    });
});

