/**
 * Runs public/workers/nested-worker-probe.js and reports whether a worker can create a nested
 * worker — the one capability the LibreOffice engine needs that nothing else in the app exercises.
 *
 * Why this exists: when nested worker creation fails, soffice.js never lifts its "loading-workers"
 * run dependency, so start-up neither errors nor progresses — it idles at zero CPU until the
 * library's 120s timeout. A desktop build has no devtools, so without this the only evidence is a
 * stuck progress bar. The summary is appended to the error the user sees.
 */

import { withBasePath } from '../utils/path';

const PROBE_PATH = '/workers/nested-worker-probe.js';
const PROBE_TIMEOUT_MS = 15 * 1000;

export interface WorkerProbeResult {
    /** A nested worker created from a normal URL — the app's own protocol on the desktop build. */
    fromUrl: string;
    /** A nested worker created from an in-memory blob, which no protocol handler ever sees. */
    fromBlob: string;
    sharedArrayBuffer: boolean;
    crossOriginIsolated: boolean | null;
}

export async function probeNestedWorkers(): Promise<WorkerProbeResult> {
    const scriptUrl = withBasePath(PROBE_PATH);
    const worker = new Worker(scriptUrl);
    try {
        return await new Promise<WorkerProbeResult>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('the probe worker itself never answered')),
                PROBE_TIMEOUT_MS,
            );
            worker.onmessage = (event: MessageEvent<WorkerProbeResult>) => {
                clearTimeout(timer);
                resolve(event.data);
            };
            worker.onerror = (event) => {
                clearTimeout(timer);
                reject(new Error(event.message || 'the probe worker failed to start'));
            };
            worker.postMessage({ scriptUrl });
        });
    } finally {
        worker.terminate();
    }
}

/** One line, short enough to sit inside an error message on screen. */
export function summarizeWorkerProbe(result: WorkerProbeResult): string {
    return (
        `nested worker from URL: ${result.fromUrl}; from blob: ${result.fromBlob}; ` +
        `SharedArrayBuffer: ${result.sharedArrayBuffer ? 'yes' : 'no'}; ` +
        `crossOriginIsolated: ${result.crossOriginIsolated}`
    );
}

/** Never throws: diagnostics must not replace the failure they are explaining. */
export async function describeWorkerSupport(): Promise<string> {
    try {
        return summarizeWorkerProbe(await probeNestedWorkers());
    } catch (e) {
        return `worker probe failed: ${e instanceof Error ? e.message : String(e)}`;
    }
}
