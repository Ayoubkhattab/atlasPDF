/**
 * Executor Tool Coverage Guard
 *
 * Every tool visible in the workflow sidebar (i.e. not in
 * INTERACTIVE_TOOLS_BLACKLIST) should either have a working `case` in
 * executor.ts's executeNode switch, or be explicitly documented as a known
 * gap in KNOWN_MISSING_WORKFLOW_TOOLS. This guards against silent drift: a
 * new standalone tool added to config/tools.ts automatically becomes
 * draggable in the workflow sidebar, but executor.ts's hand-maintained
 * switch statement has to be updated separately - without this test that
 * gap is invisible until a user hits "not supported in workflows yet".
 */

import { describe, it, expect } from 'vitest';
import { executeNode, KNOWN_MISSING_WORKFLOW_TOOLS } from '@/lib/workflow/executor';
import { INTERACTIVE_TOOLS_BLACKLIST } from '@/components/workflow/ToolSidebar';
import { tools } from '@/config/tools';
import type { WorkflowNode } from '@/types/workflow';

const NOT_SUPPORTED_SENTINEL = 'is not supported in workflows yet.';

function fakeNode(toolId: string): WorkflowNode {
    return {
        id: 'coverage-node',
        type: 'toolNode',
        position: { x: 0, y: 0 },
        data: {
            toolId,
            label: toolId,
            icon: 'file',
            category: 'organize',
            acceptedFormats: ['*'],
            outputFormat: '*',
            status: 'idle',
            progress: 0,
        },
    };
}

const visibleToolIds = tools
    .filter((tool) => !INTERACTIVE_TOOLS_BLACKLIST.has(tool.id))
    .map((tool) => tool.id);

describe('workflow executor tool coverage', () => {
    it('has at least one sidebar-visible tool to check (sanity check on the fixture itself)', () => {
        expect(visibleToolIds.length).toBeGreaterThan(50);
    });

    it.each(visibleToolIds)('"%s" is either wired into the executor or a documented known gap', async (toolId) => {
        const result = await executeNode(fakeNode(toolId), []);
        const hitUnsupportedSentinel = result.error?.message?.includes(NOT_SUPPORTED_SENTINEL) ?? false;

        if (KNOWN_MISSING_WORKFLOW_TOOLS.has(toolId)) {
            // Documented gap: no assertion on behavior, just that it's tracked.
            return;
        }

        expect(hitUnsupportedSentinel).toBe(false);
    });

    it('the newly-wired tools are not present in the known-missing allowlist', () => {
        const newlyWired = ['crop-pdf', 'timestamp-pdf', 'overlay-pdf', 'add-page-labels', 'pdf-to-markdown', 'find-and-redact'];
        for (const toolId of newlyWired) {
            expect(KNOWN_MISSING_WORKFLOW_TOOLS.has(toolId)).toBe(false);
        }
    });

    it('regression: crop-pdf (used by the built-in crop-and-resize template) no longer hits the "not supported" fallback', async () => {
        const result = await executeNode(fakeNode('crop-pdf'), []);
        // With no input files it should fail on "No input file", not the generic unsupported-tool sentinel.
        expect(result.error?.message?.includes(NOT_SUPPORTED_SENTINEL)).toBe(false);
    });
});
