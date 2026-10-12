import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * jsdom has no real Worker, so this test double stands in for
 * public/workers/pdf-to-docx.worker.js: it records what was posted to it and lets the test
 * drive its replies (status/progress/init-complete/convert-complete/error), exactly as the
 * real worker would send them.
 */
class MockWorker {
    static instances: MockWorker[] = [];
    url: string;
    opts: unknown;
    terminated = false;
    sent: Array<Record<string, unknown>> = [];
    private listeners: Record<string, Array<(event: unknown) => void>> = { message: [], error: [] };

    constructor(url: string, opts?: unknown) {
        this.url = url;
        this.opts = opts;
        MockWorker.instances.push(this);
    }

    addEventListener(type: string, fn: (event: unknown) => void): void {
        (this.listeners[type] ??= []).push(fn);
    }

    removeEventListener(type: string, fn: (event: unknown) => void): void {
        this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn);
    }

    postMessage(data: Record<string, unknown>): void {
        this.sent.push(data);
    }

    terminate(): void {
        this.terminated = true;
    }

    /** Test helper: deliver a message as if it arrived from the real worker. */
    emitMessage(data: Record<string, unknown>): void {
        for (const fn of [...this.listeners.message]) fn({ data });
    }

    /** Test helper: fire the worker's error event (a crash, not an application-level error). */
    emitError(message = 'worker crashed'): void {
        for (const fn of [...this.listeners.error]) fn({ message });
    }

    lastSent(type: string): Record<string, unknown> | undefined {
        return [...this.sent].reverse().find((m) => m.type === type);
    }
}

async function resetModule() {
    vi.resetModules();
    MockWorker.instances = [];
    vi.stubGlobal('Worker', MockWorker as unknown as typeof Worker);
    return import('@/lib/pdf/pdf-to-docx-worker');
}

/** Advances the mock worker through the real worker's init handshake. */
function completeInit(worker: MockWorker) {
    worker.emitMessage({ type: 'status', message: 'Loading Python environment...' });
    worker.emitMessage({ type: 'init-complete', id: worker.lastSent('init')!.id });
}

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('pdf-to-docx-worker (shared Pyodide worker singleton)', () => {
    it('creates exactly one worker across two sequential conversions', async () => {
        const mod = await resetModule();
        const file = new File(['pdf-bytes'], 'a.pdf', { type: 'application/pdf' });

        const first = mod.convertPdfToDocx(file);
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        completeInit(worker);
        await vi.waitFor(() => expect(worker.lastSent('convert')).toBeDefined());
        worker.emitMessage({
            type: 'convert-complete',
            id: worker.lastSent('convert')!.id,
            result: new Blob(['docx-1']),
        });
        await expect(first).resolves.toBeInstanceOf(Blob);

        const second = mod.convertPdfToDocx(file);
        await vi.waitFor(() => expect(worker.lastSent('convert')!.id).not.toBe(worker.sent[1]?.id));
        // Still the same worker instance — no second one was spun up for the second conversion.
        expect(MockWorker.instances).toHaveLength(1);
        worker.emitMessage({
            type: 'convert-complete',
            id: worker.lastSent('convert')!.id,
            result: new Blob(['docx-2']),
        });
        await expect(second).resolves.toBeInstanceOf(Blob);
    });

    it('reports increasing percentages during init instead of a flat 0%', async () => {
        const mod = await resetModule();
        const file = new File(['pdf-bytes'], 'a.pdf', { type: 'application/pdf' });
        const seen: number[] = [];

        const pending = mod.convertPdfToDocx(file, (p) => {
            if (p.phase === 'loading') seen.push(p.percent);
        });
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];

        worker.emitMessage({ type: 'status', message: 'Loading Python environment...' });
        worker.emitMessage({ type: 'status', message: 'Installing dependencies...' });
        worker.emitMessage({ type: 'status', message: 'Loading core packages...' });
        worker.emitMessage({ type: 'init-complete', id: worker.lastSent('init')!.id });
        await vi.waitFor(() => expect(worker.lastSent('convert')).toBeDefined());
        worker.emitMessage({
            type: 'convert-complete',
            id: worker.lastSent('convert')!.id,
            result: new Blob(['x']),
        });
        await pending;

        expect(seen.length).toBeGreaterThanOrEqual(3);
        // Strictly increasing — this is the whole point: the bar must visibly move.
        for (let i = 1; i < seen.length; i++) {
            expect(seen[i]).toBeGreaterThan(seen[i - 1]);
        }
    });

    it('ignores a convert-complete whose id does not match the request in flight', async () => {
        const mod = await resetModule();
        const file = new File(['pdf-bytes'], 'a.pdf', { type: 'application/pdf' });

        const pending = mod.convertPdfToDocx(file);
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        completeInit(worker);
        await vi.waitFor(() => expect(worker.lastSent('convert')).toBeDefined());

        const wrongBlob = new Blob(['wrong']);
        const rightBlob = new Blob(['right']);
        worker.emitMessage({ type: 'convert-complete', id: 'some-other-request', result: wrongBlob });
        worker.emitMessage({ type: 'convert-complete', id: worker.lastSent('convert')!.id, result: rightBlob });

        // Reference equality, not content — jsdom's Blob has no text()/arrayBuffer() to read
        // content back with, and identity is the precise thing this test needs to prove.
        await expect(pending).resolves.toBe(rightBlob);
    });

    it('forwards convert-phase progress with phase "converting"', async () => {
        const mod = await resetModule();
        const file = new File(['pdf-bytes'], 'a.pdf', { type: 'application/pdf' });
        const phases: string[] = [];

        const pending = mod.convertPdfToDocx(file, (p) => phases.push(p.phase));
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        completeInit(worker);
        await vi.waitFor(() => expect(worker.lastSent('convert')).toBeDefined());

        worker.emitMessage({ type: 'progress', message: 'Converting to DOCX...', percent: 50 });
        worker.emitMessage({
            type: 'convert-complete',
            id: worker.lastSent('convert')!.id,
            result: new Blob(['x']),
        });
        await pending;

        expect(phases).toContain('converting');
    });

    it('rejects with the worker-reported error message', async () => {
        const mod = await resetModule();
        const file = new File(['pdf-bytes'], 'a.pdf', { type: 'application/pdf' });

        const pending = mod.convertPdfToDocx(file);
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        completeInit(worker);
        await vi.waitFor(() => expect(worker.lastSent('convert')).toBeDefined());

        worker.emitMessage({ type: 'error', id: worker.lastSent('convert')!.id, error: 'input.pdf is encrypted' });

        await expect(pending).rejects.toThrow('input.pdf is encrypted');
    });

    it('cancelPdfToDocxConversion() terminates the worker and rejects the in-flight conversion', async () => {
        const mod = await resetModule();
        const file = new File(['pdf-bytes'], 'a.pdf', { type: 'application/pdf' });

        const pending = mod.convertPdfToDocx(file);
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        completeInit(worker);
        await vi.waitFor(() => expect(worker.lastSent('convert')).toBeDefined());

        mod.cancelPdfToDocxConversion();

        await expect(pending).rejects.toThrow(/cancel/i);
        expect(worker.terminated).toBe(true);
    });

    it('builds a fresh worker after a cancel instead of reusing the terminated one', async () => {
        const mod = await resetModule();
        const file = new File(['pdf-bytes'], 'a.pdf', { type: 'application/pdf' });

        const first = mod.convertPdfToDocx(file);
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        completeInit(MockWorker.instances[0]);
        mod.cancelPdfToDocxConversion();
        await expect(first).rejects.toThrow();

        const second = mod.convertPdfToDocx(file);
        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(2));
        const freshWorker = MockWorker.instances[1];
        expect(freshWorker.terminated).toBe(false);
        completeInit(freshWorker);
        await vi.waitFor(() => expect(freshWorker.lastSent('convert')).toBeDefined());
        freshWorker.emitMessage({
            type: 'convert-complete',
            id: freshWorker.lastSent('convert')!.id,
            result: new Blob(['recovered']),
        });
        await expect(second).resolves.toBeInstanceOf(Blob);
    });

    it('queues a second conversion behind the first instead of interleaving them', async () => {
        const mod = await resetModule();
        const fileA = new File(['a'], 'a.pdf', { type: 'application/pdf' });
        const fileB = new File(['b'], 'b.pdf', { type: 'application/pdf' });

        const pendingA = mod.convertPdfToDocx(fileA);
        const pendingB = mod.convertPdfToDocx(fileB);

        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        completeInit(worker);
        await vi.waitFor(() => expect(worker.lastSent('convert')).toBeDefined());

        // Only A's input should have been handed to the worker so far.
        const firstConvertMsg = worker.sent.find((m) => m.type === 'convert')!;
        expect((firstConvertMsg.data as { file: File }).file).toBe(fileA);
        expect(worker.sent.filter((m) => m.type === 'convert')).toHaveLength(1);

        worker.emitMessage({ type: 'convert-complete', id: firstConvertMsg.id, result: new Blob(['A']) });
        await pendingA;

        // Only now should B's convert message appear.
        await vi.waitFor(() => expect(worker.sent.filter((m) => m.type === 'convert')).toHaveLength(2));
        const secondConvertMsg = worker.sent.filter((m) => m.type === 'convert')[1];
        expect((secondConvertMsg.data as { file: File }).file).toBe(fileB);

        worker.emitMessage({ type: 'convert-complete', id: secondConvertMsg.id as string, result: new Blob(['B']) });
        await expect(pendingB).resolves.toBeInstanceOf(Blob);
    });

    it('still runs the next queued conversion after an earlier one fails', async () => {
        const mod = await resetModule();
        const fileA = new File(['a'], 'a.pdf', { type: 'application/pdf' });
        const fileB = new File(['b'], 'b.pdf', { type: 'application/pdf' });

        const pendingA = mod.convertPdfToDocx(fileA);
        const pendingB = mod.convertPdfToDocx(fileB);

        await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
        const worker = MockWorker.instances[0];
        completeInit(worker);
        await vi.waitFor(() => expect(worker.lastSent('convert')).toBeDefined());

        worker.emitMessage({ type: 'error', id: worker.lastSent('convert')!.id, error: 'A is corrupted' });
        await expect(pendingA).rejects.toThrow('A is corrupted');

        await vi.waitFor(() => expect(worker.sent.filter((m) => m.type === 'convert')).toHaveLength(2));
        const secondConvertMsg = worker.sent.filter((m) => m.type === 'convert')[1];
        worker.emitMessage({ type: 'convert-complete', id: secondConvertMsg.id as string, result: new Blob(['B']) });

        await expect(pendingB).resolves.toBeInstanceOf(Blob);
    });
});
