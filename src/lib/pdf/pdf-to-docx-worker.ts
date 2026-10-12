/**
 * Shared PDF → DOCX conversion worker.
 *
 * One persistent Worker — and the ~50MB Pyodide/numpy/opencv/pymupdf/pdf2docx runtime inside
 * it — is created once and reused for every conversion, in the single-file tool and in
 * workflow runs alike. This mirrors src/lib/libreoffice/shared-converter.ts.
 *
 * Before this module existed, src/lib/pdf/processors/pdf-to-docx.ts spun up a brand-new
 * Worker (re-downloading and re-initializing the whole ~50MB runtime) on every single
 * conversion, and only ever terminated it if the worker itself crashed — never on success.
 * Converting two files in one session, without reloading the page, left two separate ~50MB
 * Python runtimes alive in memory at once; a third conversion made three. Routing every
 * conversion through this module's singleton fixes that at the source.
 */

export interface PdfToDocxProgress {
    phase: 'loading' | 'converting';
    percent: number;
    message: string;
}

type ProgressCallback = (progress: PdfToDocxProgress) => void;

/**
 * Rough, increasing percentages for the fixed sequence of status messages the worker sends
 * while Pyodide and its packages load. Without this the old code pinned progress at a flat 0%
 * for the whole ~50MB download — the text changed but the bar never moved, the same
 * "looks hung but isn't" shape of problem later diagnosed in the desktop LibreOffice engine.
 * Any status text not listed here just keeps whatever percent was last shown.
 */
const INIT_PHASE_PERCENT: Record<string, number> = {
    'Loading Python environment...': 2,
    'Installing dependencies...': 5,
    'Loading core packages...': 10,
    'Loading converters...': 18,
    'Installing pdf2docx...': 24,
    'Initializing converter...': 28,
};

/**
 * Everything tied to one running worker, bundled into a single object so there is exactly one
 * module-level pointer (`current`) to reassign. An earlier version of this module tracked the
 * worker and its "is it ready" promise as two separate variables, set at different times by
 * different async callbacks — cancelling right as init finished could land between those two
 * writes and leave the module believing a just-terminated worker was still the live one. A
 * single atomic pointer, reassigned synchronously wherever it changes, has no such gap.
 */
interface Session {
    worker: Worker;
    /** Resolves once the worker's own 'init-complete' message arrives; rejects (and clears
     *  `current` if this is still the active session) on an init failure or a cancellation. */
    ready: Promise<Worker>;
}

let current: Session | null = null;
/** Serializes conversions: pdf2docx reads/writes fixed input.pdf/output.docx paths on one
 *  Python interpreter's virtual filesystem, so two conversions cannot safely run at once
 *  against the same worker. */
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;
/** Rejects whichever init or conversion is in flight when a session is torn down by a cancel.
 *  A terminated Worker fires no event of its own, so this is the only signal either side gets. */
const terminationHandlers = new Set<() => void>();

function startSession(onProgress?: ProgressCallback): Session {
    const w = new Worker('/workers/pdf-to-docx.worker.js', { type: 'module' });
    const initId = `init-${++nextId}`;

    const session: Session = {
        worker: w,
        ready: new Promise<Worker>((resolve, reject) => {
            let lastPercent = 0;

            const cleanup = () => {
                w.removeEventListener('message', handleMessage);
                w.removeEventListener('error', handleError);
                terminationHandlers.delete(onCancelled);
            };
            const handleMessage = (event: MessageEvent) => {
                const { type, error, message } = event.data ?? {};
                if (type === 'init-complete') {
                    cleanup();
                    resolve(w);
                } else if (type === 'status') {
                    lastPercent = INIT_PHASE_PERCENT[message] ?? lastPercent;
                    onProgress?.({ phase: 'loading', percent: lastPercent, message: message || '' });
                } else if (type === 'error') {
                    cleanup();
                    w.terminate();
                    reject(new Error(error || 'Worker initialization failed'));
                }
            };
            const handleError = () => {
                cleanup();
                w.terminate();
                reject(new Error('Worker connection failed'));
            };
            const onCancelled = () => {
                cleanup();
                reject(new Error('Conversion cancelled'));
            };

            terminationHandlers.add(onCancelled);
            w.addEventListener('message', handleMessage);
            w.addEventListener('error', handleError);
            w.postMessage({ type: 'init', id: initId, data: {} });
        }).catch((err) => {
            // An init that fails or is cancelled must not poison the singleton forever: clear
            // it (unless something newer already replaced it) so the next call starts clean.
            if (current === session) current = null;
            throw err;
        }),
    };

    return session;
}

function getSession(onProgress?: ProgressCallback): Session {
    if (!current) current = startSession(onProgress);
    return current;
}

/**
 * Terminates the shared worker immediately, discarding whatever it was doing, and rejects
 * whichever init or conversion was in flight. The next call to convertPdfToDocx() transparently
 * builds a fresh worker.
 *
 * This does not try to interrupt Python cooperatively. pdf2docx spends nearly all of its time
 * inside PyMuPDF's and OpenCV's compiled C extensions, which do not check for interrupts the
 * way interpreted Python bytecode does — Pyodide's own interrupt-buffer mechanism could sit
 * unheard for the rest of the conversion. Terminating the worker is the only way to be sure
 * the work has actually stopped, not just that the UI stopped showing it.
 *
 * The cost is that the next conversion pays the ~50MB init cost again. That trade is the
 * right one: it is paid only when someone deliberately cancels, not on every routine
 * conversion the way the pre-fix code paid it unconditionally.
 */
export function cancelPdfToDocxConversion(): void {
    const session = current;
    current = null;
    const handlers = [...terminationHandlers];
    terminationHandlers.clear();
    for (const handler of handlers) handler();
    session?.worker.terminate();
}

function runConversion(file: File, onProgress?: ProgressCallback): Promise<Blob> {
    const session = getSession(onProgress);

    return session.ready.then((w) => {
        if (current !== session) {
            // Cancelled in the narrow window between the worker reporting ready and this
            // conversion actually starting on it. `w` below is already terminated and would
            // silently swallow postMessage() forever, so stop here instead of hanging.
            throw new Error('Conversion cancelled');
        }

        return new Promise<Blob>((resolve, reject) => {
            const msgId = `convert-${++nextId}`;
            let settled = false;

            const cleanup = () => {
                w.removeEventListener('message', handleMessage);
                w.removeEventListener('error', handleError);
                terminationHandlers.delete(onCancelled);
            };
            const settle = (run: () => void) => {
                if (settled) return;
                settled = true;
                cleanup();
                run();
            };

            const handleMessage = (event: MessageEvent) => {
                const { type, id, result, error, message, percent } = event.data ?? {};

                // Status/progress messages carry no id — they are broadcasts, not replies —
                // so they must be checked before the id filter below discards them.
                if (type === 'status' || type === 'progress') {
                    onProgress?.({
                        phase: 'converting',
                        percent: typeof percent === 'number' ? percent : 30,
                        message: message || '',
                    });
                    return;
                }

                if (id !== msgId) return;

                if (type === 'convert-complete') {
                    settle(() => resolve(result));
                } else if (type === 'error') {
                    settle(() => reject(new Error(error || 'Conversion failed')));
                }
            };
            const handleError = (event: ErrorEvent) => {
                settle(() => reject(new Error('Worker error: ' + event.message)));
            };
            const onCancelled = () => settle(() => reject(new Error('Conversion cancelled')));

            terminationHandlers.add(onCancelled);
            w.addEventListener('message', handleMessage);
            w.addEventListener('error', handleError);
            w.postMessage({ type: 'convert', id: msgId, data: { file } });
        });
    });
}

/**
 * Converts one PDF to DOCX using the shared worker, queued behind any conversion already in
 * flight (see the module comment on `queue`).
 */
export function convertPdfToDocx(file: File, onProgress?: ProgressCallback): Promise<Blob> {
    const run = queue.then(() => runConversion(file, onProgress));
    // Keep the queue alive even when this conversion fails, so the next one still gets a turn.
    queue = run.catch(() => undefined);
    return run;
}

/**
 * Warms up the shared worker without converting anything — the same shape as
 * preloadLibreOfficeConverter(). Safe to call speculatively (e.g. when a tool page mounts):
 * a failure here is swallowed by the caller and simply leaves the module ready to retry on
 * the next real convertPdfToDocx() call, since a failed session clears itself (see
 * startSession()'s .catch()).
 */
export async function preloadPdfToDocxWorker(onProgress?: ProgressCallback): Promise<void> {
    await getSession(onProgress).ready;
}
