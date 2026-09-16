/**
 * Nested-worker probe.
 *
 * The LibreOffice engine cannot start until every pthread worker in its pool reports back
 * (soffice.js holds a "loading-workers" run dependency until then), and those workers are
 * NESTED: created with new Worker(...) from inside another worker. If that creation fails,
 * nothing errors — start-up simply waits forever, burning no CPU, until the library's own
 * 120s timeout fires.
 *
 * This file plays both roles. Spawned with the name "child" it just answers; spawned by the
 * page it tries to create a child both ways — from the URL it was given (which on the desktop
 * build goes through the app's custom protocol) and from an in-memory blob — and reports which
 * of the two works. See src/lib/libreoffice/worker-probe.ts.
 */
if (self.name === 'nested-worker-probe-child') {
    self.postMessage('pong');
} else {
    const CHILD_TIMEOUT_MS = 5000;

    function spawn(makeWorker) {
        return new Promise((resolve) => {
            let worker;
            const finish = (verdict) => {
                clearTimeout(timer);
                try { worker && worker.terminate(); } catch { /* already gone */ }
                resolve(verdict);
            };
            const timer = setTimeout(() => finish('timeout'), CHILD_TIMEOUT_MS);
            try {
                worker = makeWorker();
            } catch (e) {
                finish('threw: ' + (e && e.message ? e.message : String(e)));
                return;
            }
            worker.onmessage = () => finish('ok');
            worker.onerror = (e) => finish('error: ' + (e && e.message ? e.message : 'unknown'));
        });
    }

    self.onmessage = async (event) => {
        const { scriptUrl } = event.data || {};
        const options = { name: 'nested-worker-probe-child' };

        const fromUrl = await spawn(() => new Worker(scriptUrl, options));

        let blobUrl = '';
        const fromBlob = await spawn(() => {
            blobUrl = URL.createObjectURL(
                new Blob(['self.postMessage("pong");'], { type: 'text/javascript' }),
            );
            return new Worker(blobUrl, options);
        });
        if (blobUrl) URL.revokeObjectURL(blobUrl);

        self.postMessage({
            fromUrl,
            fromBlob,
            sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
            crossOriginIsolated: typeof self.crossOriginIsolated === 'boolean' ? self.crossOriginIsolated : null,
        });
    };
}
