/**
 * Workflow Execution History Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    createExecutionRecord,
    addExecutionRecord,
    loadExecutionHistory,
    updateExecutionRecord,
    completeExecutionRecord,
    deleteExecutionRecord,
    clearExecutionHistory,
    getExecutionStatistics,
} from '@/lib/workflow/history';
import type { WorkflowNode, WorkflowEdge } from '@/types/workflow';

function makeNode(id: string, settings?: Record<string, unknown>): WorkflowNode {
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
            settings,
        },
    };
}

const edges: WorkflowEdge[] = [];

describe('workflow history', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('createExecutionRecord', () => {
        it('builds a running record with correct counts', () => {
            const record = createExecutionRecord([makeNode('n1'), makeNode('n2')], edges, 3, 'My WF', 'wf-1');
            expect(record.status).toBe('running');
            expect(record.totalNodes).toBe(2);
            expect(record.fileCount).toBe(3);
            expect(record.workflowName).toBe('My WF');
            expect(record.workflowId).toBe('wf-1');
            expect(record.successfulNodes).toBe(0);
            expect(record.startTime).toBeInstanceOf(Date);
        });

        it('regression: a File in node settings survives the JSON round-trip as a MissingFileRef placeholder, not {}', () => {
            const certFile = new File(['cert-bytes'], 'cert.pfx', { type: 'application/x-pkcs12' });
            const record = createExecutionRecord([makeNode('n1', { certFile })], edges, 1);
            const persistedSettings = record.nodes[0].data.settings as Record<string, unknown>;

            expect(persistedSettings.certFile).not.toBeInstanceOf(File);
            expect(persistedSettings.certFile).not.toEqual({});
            expect(persistedSettings.certFile).toEqual({
                __fileMissing: true,
                name: 'cert.pfx',
                size: certFile.size,
                type: 'application/x-pkcs12',
            });
        });

        it('strips inputFiles/outputFiles from node snapshots', () => {
            const dirtyNode: WorkflowNode = {
                ...makeNode('n1'),
                data: {
                    ...makeNode('n1').data,
                    inputFiles: [new File(['x'], 'x.pdf')],
                    outputFiles: [new Blob(['y'])],
                },
            };
            const record = createExecutionRecord([dirtyNode], edges, 1);
            expect(record.nodes[0].data.inputFiles).toBeUndefined();
            expect(record.nodes[0].data.outputFiles).toBeUndefined();
        });
    });

    describe('addExecutionRecord / loadExecutionHistory', () => {
        it('round-trips a record and restores Date instances', () => {
            const record = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(record);

            const [loaded] = loadExecutionHistory();
            expect(loaded.id).toBe(record.id);
            expect(loaded.startTime).toBeInstanceOf(Date);
        });

        it('leaves endTime undefined when not yet set', () => {
            const record = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(record);
            const [loaded] = loadExecutionHistory();
            expect(loaded.endTime).toBeUndefined();
        });

        it('keeps only the most recent 50 records', () => {
            for (let i = 0; i < 55; i++) {
                const record = createExecutionRecord([makeNode('n1')], edges, 1, `run-${i}`);
                addExecutionRecord(record);
            }
            const history = loadExecutionHistory();
            expect(history).toHaveLength(50);
            expect(history.some(r => r.workflowName === 'run-0')).toBe(false);
            expect(history.some(r => r.workflowName === 'run-54')).toBe(true);
        });
    });

    describe('updateExecutionRecord / completeExecutionRecord', () => {
        it('merges partial updates into an existing record', () => {
            const record = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(record);

            updateExecutionRecord(record.id, { successfulNodes: 1 });
            const [loaded] = loadExecutionHistory();
            expect(loaded.successfulNodes).toBe(1);
            expect(loaded.status).toBe('running');
        });

        it('does nothing for an unknown id', () => {
            expect(() => updateExecutionRecord('missing', { successfulNodes: 5 })).not.toThrow();
            expect(loadExecutionHistory()).toHaveLength(0);
        });

        it('completes a record with status/duration/errorMessage', () => {
            const record = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(record);

            completeExecutionRecord(record.id, 'failed', 0, 'boom', 'n1');
            const [loaded] = loadExecutionHistory();

            expect(loaded.status).toBe('failed');
            expect(loaded.errorMessage).toBe('boom');
            expect(loaded.failedNodeId).toBe('n1');
            expect(loaded.endTime).toBeInstanceOf(Date);
            expect(typeof loaded.duration).toBe('number');
            expect(loaded.duration).toBeGreaterThanOrEqual(0);
        });
    });

    describe('deleteExecutionRecord / clearExecutionHistory', () => {
        it('removes a single record by id', () => {
            const a = createExecutionRecord([makeNode('n1')], edges, 1);
            const b = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(a);
            addExecutionRecord(b);

            deleteExecutionRecord(a.id);
            const history = loadExecutionHistory();
            expect(history).toHaveLength(1);
            expect(history[0].id).toBe(b.id);
        });

        it('removes all records', () => {
            addExecutionRecord(createExecutionRecord([makeNode('n1')], edges, 1));
            clearExecutionHistory();
            expect(loadExecutionHistory()).toHaveLength(0);
        });
    });

    describe('getExecutionStatistics', () => {
        it('returns all-zero stats for an empty history', () => {
            const stats = getExecutionStatistics();
            expect(stats).toEqual({
                total: 0,
                completed: 0,
                failed: 0,
                cancelled: 0,
                avgDuration: 0,
                successRate: 0,
            });
        });

        it('computes successRate and avgDuration over a mixed history', () => {
            const completed1 = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(completed1);
            completeExecutionRecord(completed1.id, 'completed', 1);

            const completed2 = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(completed2);
            completeExecutionRecord(completed2.id, 'completed', 1);

            const failed = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(failed);
            completeExecutionRecord(failed.id, 'failed', 0, 'err');

            const cancelled = createExecutionRecord([makeNode('n1')], edges, 1);
            addExecutionRecord(cancelled);
            completeExecutionRecord(cancelled.id, 'cancelled', 0);

            const stats = getExecutionStatistics();
            expect(stats.total).toBe(4);
            expect(stats.completed).toBe(2);
            expect(stats.failed).toBe(1);
            expect(stats.cancelled).toBe(1);
            expect(stats.successRate).toBe(50);
            expect(stats.avgDuration).toBeGreaterThanOrEqual(0);
        });
    });
});
