/**
 * useUndoRedo Hook Tests
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoRedo } from '@/hooks/useUndoRedo';
import type { WorkflowNode, WorkflowEdge } from '@/types/workflow';

function makeNodes(label: string): WorkflowNode[] {
    return [{
        id: 'n1',
        type: 'toolNode',
        position: { x: 0, y: 0 },
        data: {
            toolId: 'merge-pdf',
            label,
            icon: 'file-plus',
            category: 'organize',
            acceptedFormats: ['.pdf'],
            outputFormat: '.pdf',
            status: 'idle',
            progress: 0,
        },
    }];
}

const edges: WorkflowEdge[] = [];

interface HistorySnapshot {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}

// Runs `fn` inside `act` and returns its result. Kept as a helper (rather than
// `let x = null; act(() => { x = fn(); })`) because TS narrows a `let`
// reassigned only inside a callback passed to a function call to `never` at
// the read site after the call — a known control-flow-analysis quirk.
function actAndReturn<T>(fn: () => T): T {
    let value!: T;
    act(() => {
        value = fn();
    });
    return value;
}

describe('useUndoRedo', () => {
    it('starts with empty history and both undo/redo unavailable', () => {
        const { result } = renderHook(() => useUndoRedo());
        expect(result.current.historyLength).toBe(0);
        expect(result.current.historyIndex).toBe(-1);
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });

    it('pushHistory grows the history and enables undo once there are 2+ entries', () => {
        const { result } = renderHook(() => useUndoRedo());

        act(() => result.current.pushHistory(makeNodes('v1'), edges));
        expect(result.current.historyLength).toBe(1);
        expect(result.current.canUndo).toBe(false); // only one entry, nothing to go back to

        act(() => result.current.pushHistory(makeNodes('v2'), edges));
        expect(result.current.historyLength).toBe(2);
        expect(result.current.historyIndex).toBe(1);
        expect(result.current.canUndo).toBe(true);
        expect(result.current.canRedo).toBe(false);
    });

    it('undo returns the previous snapshot and enables redo', () => {
        const { result } = renderHook(() => useUndoRedo());
        act(() => result.current.pushHistory(makeNodes('v1'), edges));
        act(() => result.current.pushHistory(makeNodes('v2'), edges));

        const restored = actAndReturn(() => result.current.undo());

        expect(restored?.nodes[0].data.label).toBe('v1');
        expect(result.current.canRedo).toBe(true);
    });

    it('redo restores the state that was undone', () => {
        const { result } = renderHook(() => useUndoRedo());
        act(() => result.current.pushHistory(makeNodes('v1'), edges));
        act(() => result.current.pushHistory(makeNodes('v2'), edges));
        act(() => { result.current.undo(); });

        const restored = actAndReturn(() => result.current.redo());

        expect(restored?.nodes[0].data.label).toBe('v2');
        expect(result.current.canRedo).toBe(false);
    });

    it('undo/redo return null when there is nothing to undo/redo', () => {
        const { result } = renderHook(() => useUndoRedo());
        expect(result.current.undo()).toBeNull();
        expect(result.current.redo()).toBeNull();

        act(() => result.current.pushHistory(makeNodes('v1'), edges));
        // Only one entry: still nothing to undo to
        expect(result.current.undo()).toBeNull();
    });

    it('a push right after undo/redo (the restore itself) does not grow history or truncate redo', () => {
        const { result } = renderHook(() => useUndoRedo());
        act(() => result.current.pushHistory(makeNodes('v1'), edges));
        act(() => result.current.pushHistory(makeNodes('v2'), edges));
        act(() => { result.current.undo(); });

        // Simulate the app re-applying the restored state, which would otherwise
        // look like a new edit and push a duplicate/redo-truncating entry.
        act(() => result.current.pushHistory(makeNodes('v1'), edges));

        expect(result.current.historyLength).toBe(2);
        expect(result.current.canRedo).toBe(true);
    });

    it('pushing a genuinely new state after undo truncates the redo-future', () => {
        const { result } = renderHook(() => useUndoRedo());
        act(() => result.current.pushHistory(makeNodes('v1'), edges));
        act(() => result.current.pushHistory(makeNodes('v2'), edges));
        act(() => { result.current.undo(); }); // back to v1, v2 is now "future"

        // Consume the undo-guard the same way the real editor does, then push a new branch.
        act(() => result.current.pushHistory(makeNodes('v1'), edges)); // restore no-op
        act(() => result.current.pushHistory(makeNodes('v3'), edges)); // genuinely new edit

        expect(result.current.canRedo).toBe(false);
        expect(result.current.historyLength).toBe(2);
        expect(result.current.historyIndex).toBe(1);
    });

    it('caps history at 50 entries, dropping the oldest, and keeps pointing at the latest', () => {
        const { result } = renderHook(() => useUndoRedo());

        for (let i = 0; i < 55; i++) {
            act(() => result.current.pushHistory(makeNodes(`v${i}`), edges));
        }

        expect(result.current.historyLength).toBe(50);
        expect(result.current.canRedo).toBe(false);
        expect(result.current.canUndo).toBe(true);

        const restored = actAndReturn(() => result.current.undo());
        // The latest push was v54; after eviction the previous entry should be v53.
        expect(restored?.nodes[0].data.label).toBe('v53');
    });

    it('clearHistory resets index and length and disables undo/redo', () => {
        const { result } = renderHook(() => useUndoRedo());
        act(() => result.current.pushHistory(makeNodes('v1'), edges));
        act(() => result.current.pushHistory(makeNodes('v2'), edges));

        act(() => result.current.clearHistory());

        expect(result.current.historyLength).toBe(0);
        expect(result.current.historyIndex).toBe(-1);
        expect(result.current.canUndo).toBe(false);
        expect(result.current.canRedo).toBe(false);
    });
});
