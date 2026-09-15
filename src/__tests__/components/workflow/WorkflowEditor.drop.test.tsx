import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';

vi.mock('@/config/tools', () => ({
    tools: [
        {
            id: 'merge-pdf',
            category: 'organize-manage',
            icon: 'merge',
            acceptedFormats: ['pdf'],
            outputFormat: 'pdf',
        },
    ],
}));

vi.mock('@/config/tool-content', () => ({
    getToolContent: () => ({ title: 'Merge PDF' }),
}));

vi.mock('next-intl', () => ({
    useTranslations: () => (key: string) => key,
    useLocale: () => 'en',
}));

// The executor pulls in the whole PDF toolchain, which this test never runs.
vi.mock('@/lib/workflow/executor', () => ({
    executeNode: vi.fn(),
    collectInputFiles: vi.fn(() => []),
}));

vi.mock('@/lib/libreoffice/shared-converter', () => ({
    LIBREOFFICE_TOOL_IDS: [] as string[],
    preloadLibreOfficeConverter: vi.fn(),
}));

import { WorkflowEditor } from '@/components/workflow/WorkflowEditor';

/**
 * jsdom has no layout engine, so React Flow resolves every drop to the same
 * flow position. That is fine here: the test counts nodes, not coordinates.
 */
function dropToolOnCanvas(target: Element, toolId: string) {
    const data: Record<string, string> = {
        'application/reactflow': JSON.stringify({
            toolId,
            label: 'Merge PDF',
            icon: 'merge',
            category: 'organize-manage',
            acceptedFormats: ['pdf'],
            outputFormat: 'pdf',
            status: 'idle',
            progress: 0,
            settings: {},
        }),
        'text/plain': toolId,
    };

    const dataTransfer = {
        getData: (format: string) => data[format] ?? '',
        setData: (format: string, value: string) => { data[format] = value; },
        dropEffect: 'move',
        effectAllowed: 'move',
    };

    fireEvent.dragOver(target, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });
}

describe('WorkflowEditor drag and drop', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    it('adds exactly one node when a tool is dropped on the React Flow pane', async () => {
        const { container } = render(<WorkflowEditor />);

        // React Flow hands over its instance a tick after the viewport is up,
        // and the drop handler needs that instance to place the node.
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
        });

        const flowPane = container.querySelector('.react-flow');
        expect(flowPane).not.toBeNull();

        dropToolOnCanvas(flowPane!, 'merge-pdf');

        // A single drop bubbles through both the React Flow root and the
        // wrapper around it; only one node may come out of that.
        expect(container.querySelectorAll('.react-flow__node')).toHaveLength(1);
    });
});
