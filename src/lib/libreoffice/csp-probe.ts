/**
 * Content-Security-Policy preflight for the LibreOffice engine.
 *
 * Both CSP gaps that broke production surfaced only *after* the ~75MB engine download: as an
 * EvalError thrown by soffice.js inside the worker (script-src without 'unsafe-eval'), or as an
 * opaque "Failed to fetch" on the worker's blob: URLs (connect-src without blob:). The page and
 * its same-origin workers are served under the same policy, so probing both capabilities here,
 * before downloading anything, turns them into an immediate, specific error.
 */

export interface CspProbeDeps {
    /** Must throw if the policy forbids string-to-code evaluation. */
    evaluate?: () => unknown;
    /** Must reject if the policy forbids fetching blob: URLs. */
    fetchBlobUrl?: () => Promise<unknown>;
}

// This IS the probe for 'unsafe-eval': it throws when the policy forbids string evaluation.
const defaultEvaluate = () => new Function('return 1')();

const defaultFetchBlobUrl = async () => {
    const url = URL.createObjectURL(new Blob(['ok']));
    try {
        await (await fetch(url)).text();
    } finally {
        URL.revokeObjectURL(url);
    }
};

/** Returns one human-readable entry per missing CSP permission (empty when nothing is blocked). */
export async function detectLibreOfficeCspBlockers(deps: CspProbeDeps = {}): Promise<string[]> {
    const blockers: string[] = [];

    try {
        (deps.evaluate ?? defaultEvaluate)();
    } catch {
        blockers.push("script-src must include 'unsafe-eval' (soffice.js builds functions at runtime)");
    }

    try {
        await (deps.fetchBlobUrl ?? defaultFetchBlobUrl)();
    } catch {
        blockers.push('connect-src must include blob: (the engine worker reads its own blob: URLs)');
    }

    return blockers;
}
