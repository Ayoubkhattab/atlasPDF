/**
 * Workflow Node Selection Tests
 */

import { describe, it, expect } from 'vitest';
import { deriveSelectedNode, isNodeAmongDeleted } from '@/lib/workflow/node-selection';
import type { WorkflowNode } from '@/types/workflow';

function makeNode(id: string): WorkflowNode {
    return {
        id,
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
        },
    };
}

describe('deriveSelectedNode', () => {
    const nodes = [makeNode('a'), makeNode('b')];

    it('returns null when selectedNodeId is null', () => {
        expect(deriveSelectedNode(nodes, null)).toBeNull();
    });

    it('returns null when the id is not present in nodes', () => {
        expect(deriveSelectedNode(nodes, 'missing')).toBeNull();
    });

    it('returns the matching node when present', () => {
        expect(deriveSelectedNode(nodes, 'b')).toBe(nodes[1]);
    });

    it('returns null once a previously-selected node is removed from the array', () => {
        const remaining = nodes.filter((n) => n.id !== 'b');
        expect(deriveSelectedNode(remaining, 'b')).toBeNull();
    });

    it('returns an empty-array-safe null', () => {
        expect(deriveSelectedNode([], 'a')).toBeNull();
    });
});

describe('isNodeAmongDeleted', () => {
    it('returns false when selectedNodeId is null', () => {
        expect(isNodeAmongDeleted(['a', 'b'], null)).toBe(false);
    });

    it('returns false when the deleted list is empty', () => {
        expect(isNodeAmongDeleted([], 'a')).toBe(false);
    });

    it('returns true when the selected id is among the deleted ids', () => {
        expect(isNodeAmongDeleted(['a', 'b'], 'b')).toBe(true);
    });

    it('returns false when the selected id is not among the deleted ids', () => {
        expect(isNodeAmongDeleted(['a', 'b'], 'c')).toBe(false);
    });
});
