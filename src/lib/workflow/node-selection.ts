/**
 * Workflow Node Selection Helpers
 *
 * The settings panel derives its displayed node by id from the live `nodes`
 * array rather than holding a frozen node-object snapshot, so it can never
 * show a deleted node and always reflects live status/progress updates.
 */

import type { WorkflowNode } from '@/types/workflow';

/**
 * Look up the currently-selected node by id from the live nodes array.
 * Returns null when no node is selected or the selected node no longer exists
 * (e.g. it was just deleted).
 */
export function deriveSelectedNode(
    nodes: WorkflowNode[],
    selectedNodeId: string | null
): WorkflowNode | null {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
}

/**
 * Whether the currently-selected node id is among a batch of deleted node ids.
 */
export function isNodeAmongDeleted(
    deletedNodeIds: string[],
    selectedNodeId: string | null
): boolean {
    return selectedNodeId !== null && deletedNodeIds.includes(selectedNodeId);
}
