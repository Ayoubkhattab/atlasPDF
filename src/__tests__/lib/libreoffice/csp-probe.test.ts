// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { detectLibreOfficeCspBlockers } from '@/lib/libreoffice/csp-probe';

describe('detectLibreOfficeCspBlockers', () => {
    it('reports nothing when both capabilities are allowed', async () => {
        expect(await detectLibreOfficeCspBlockers({ evaluate: () => 1, fetchBlobUrl: async () => undefined })).toEqual([]);
    });

    it("reports the missing 'unsafe-eval' when string evaluation is blocked", async () => {
        const blockers = await detectLibreOfficeCspBlockers({
            evaluate: () => {
                throw new EvalError("Evaluating a string as JavaScript violates the following Content Security Policy directive");
            },
            fetchBlobUrl: async () => undefined,
        });

        expect(blockers).toHaveLength(1);
        expect(blockers[0]).toContain("'unsafe-eval'");
    });

    it('reports the missing blob: when fetching a blob URL is blocked', async () => {
        const blockers = await detectLibreOfficeCspBlockers({
            evaluate: () => 1,
            fetchBlobUrl: async () => {
                throw new TypeError('Failed to fetch');
            },
        });

        expect(blockers).toHaveLength(1);
        expect(blockers[0]).toContain('blob:');
    });

    it('reports both at once so the fix can be made in one deploy', async () => {
        const blockers = await detectLibreOfficeCspBlockers({
            evaluate: () => { throw new EvalError('blocked'); },
            fetchBlobUrl: async () => { throw new TypeError('Failed to fetch'); },
        });

        expect(blockers).toHaveLength(2);
    });
});
