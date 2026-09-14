/**
 * Workflow Storage Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    getSavedWorkflows,
    saveWorkflow,
    deleteWorkflow,
    toggleWorkflowFavorite,
    duplicateWorkflow,
    getFavoriteWorkflows,
    searchWorkflows,
    importWorkflow,
} from '@/lib/workflow/storage';
import type { WorkflowNode, WorkflowEdge, SavedWorkflow } from '@/types/workflow';

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

describe('workflow storage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    describe('saveWorkflow / getSavedWorkflows', () => {
        it('saves a new workflow and returns it on reload', () => {
            const saved = saveWorkflow('My Workflow', [makeNode('n1')], edges, 'a description');
            expect(saved.id).toBeTruthy();

            const all = getSavedWorkflows();
            expect(all).toHaveLength(1);
            expect(all[0].name).toBe('My Workflow');
            expect(all[0].description).toBe('a description');
        });

        it('updates an existing workflow in place when existingId is passed', () => {
            const saved = saveWorkflow('First Name', [makeNode('n1')], edges);
            const updated = saveWorkflow('Renamed', [makeNode('n1')], edges, undefined, saved.id);

            expect(updated.id).toBe(saved.id);
            const all = getSavedWorkflows();
            expect(all).toHaveLength(1);
            expect(all[0].name).toBe('Renamed');
        });

        it('evicts the oldest workflow once more than 50 are saved', () => {
            for (let i = 0; i < 51; i++) {
                saveWorkflow(`wf-${i}`, [makeNode('n1')], edges);
            }
            const all = getSavedWorkflows();
            expect(all).toHaveLength(50);
            expect(all.some(w => w.name === 'wf-0')).toBe(false);
            expect(all.some(w => w.name === 'wf-50')).toBe(true);
        });

        it('resets runtime node fields (status/progress/error/inputFiles/outputFiles) on save', () => {
            const dirtyNode: WorkflowNode = {
                ...makeNode('n1'),
                data: {
                    ...makeNode('n1').data,
                    status: 'error',
                    progress: 42,
                    error: 'boom',
                    inputFiles: [new File(['x'], 'x.pdf')],
                    outputFiles: [new Blob(['y'])],
                },
            };
            saveWorkflow('Dirty', [dirtyNode], edges);
            const [loaded] = getSavedWorkflows();
            expect(loaded.nodes[0].data.status).toBe('idle');
            expect(loaded.nodes[0].data.progress).toBe(0);
            expect(loaded.nodes[0].data.error).toBeUndefined();
            expect(loaded.nodes[0].data.inputFiles).toBeUndefined();
            expect(loaded.nodes[0].data.outputFiles).toBeUndefined();
        });

        it('regression: a File in node settings survives save/reload as a MissingFileRef placeholder, not {}', () => {
            const certFile = new File(['cert-bytes'], 'cert.pfx', { type: 'application/x-pkcs12' });
            const node = makeNode('sign-1', { certFile });

            saveWorkflow('Signed WF', [node], edges);
            const [loaded] = getSavedWorkflows();
            const persistedSettings = loaded.nodes[0].data.settings as Record<string, unknown>;

            expect(persistedSettings.certFile).not.toBeInstanceOf(File);
            expect(persistedSettings.certFile).not.toEqual({});
            expect(persistedSettings.certFile).toEqual({
                __fileMissing: true,
                name: 'cert.pfx',
                size: certFile.size,
                type: 'application/x-pkcs12',
            });
        });
    });

    describe('deleteWorkflow', () => {
        it('removes the workflow with the given id', () => {
            const saved = saveWorkflow('To Delete', [makeNode('n1')], edges);
            expect(deleteWorkflow(saved.id)).toBe(true);
            expect(getSavedWorkflows()).toHaveLength(0);
        });
    });

    describe('toggleWorkflowFavorite', () => {
        it('toggles favorite status and persists it', () => {
            const saved = saveWorkflow('Fav Test', [makeNode('n1')], edges);
            expect(toggleWorkflowFavorite(saved.id)).toBe(true);
            expect(getSavedWorkflows()[0].isFavorite).toBe(true);
            expect(toggleWorkflowFavorite(saved.id)).toBe(false);
            expect(getSavedWorkflows()[0].isFavorite).toBe(false);
        });

        it('returns false for an unknown id', () => {
            expect(toggleWorkflowFavorite('missing-id')).toBe(false);
        });
    });

    describe('duplicateWorkflow', () => {
        it('creates a copy with "(Copy)" appended to the name', () => {
            const saved = saveWorkflow('Original', [makeNode('n1')], edges, 'desc');
            const copy = duplicateWorkflow(saved.id);
            expect(copy).not.toBeNull();
            expect(copy!.name).toBe('Original (Copy)');
            expect(copy!.id).not.toBe(saved.id);
            expect(getSavedWorkflows()).toHaveLength(2);
        });

        it('returns null for an unknown id', () => {
            expect(duplicateWorkflow('missing-id')).toBeNull();
        });
    });

    describe('getFavoriteWorkflows / searchWorkflows', () => {
        it('filters to only favorited workflows', () => {
            const a = saveWorkflow('Alpha', [makeNode('n1')], edges);
            saveWorkflow('Beta', [makeNode('n1')], edges);
            toggleWorkflowFavorite(a.id);

            const favorites = getFavoriteWorkflows();
            expect(favorites).toHaveLength(1);
            expect(favorites[0].name).toBe('Alpha');
        });

        it('searches by name and description (case-insensitive)', () => {
            saveWorkflow('Invoice Processor', [makeNode('n1')], edges, 'handles invoices');
            saveWorkflow('Photo Album', [makeNode('n1')], edges, 'for pictures');

            expect(searchWorkflows('invoice')).toHaveLength(1);
            expect(searchWorkflows('PICTURES')).toHaveLength(1);
            expect(searchWorkflows('nonexistent')).toHaveLength(0);
        });
    });

    describe('importWorkflow', () => {
        function jsonFile(data: unknown): File {
            const text = typeof data === 'string' ? data : JSON.stringify(data);
            const file = new File([text], 'wf.workflow.json', { type: 'application/json' }) as any;
            file.text = async () => text;
            return file as File;
        }

        function validWorkflowPayload(): SavedWorkflow {
            return {
                id: 'wf-1',
                name: 'Imported',
                nodes: [makeNode('n1')],
                edges: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };
        }

        it('imports a valid workflow and saves it as new', async () => {
            const result = await importWorkflow(jsonFile(validWorkflowPayload()));
            expect(result).not.toBeNull();
            expect(getSavedWorkflows()).toHaveLength(1);
        });

        it('rejects a payload missing name/nodes/edges', async () => {
            const result = await importWorkflow(jsonFile({ nodes: [], edges: [] }));
            expect(result).toBeNull();
            expect(getSavedWorkflows()).toHaveLength(0);
        });

        it('rejects a node missing required fields', async () => {
            const payload = validWorkflowPayload();
            // @ts-expect-error intentionally malformed for the test
            payload.nodes = [{ id: 'bad' }];
            const result = await importWorkflow(jsonFile(payload));
            expect(result).toBeNull();
        });

        it('rejects an edge referencing a non-existent node', async () => {
            const payload = validWorkflowPayload();
            payload.edges = [{ id: 'e1', source: 'n1', target: 'does-not-exist' }];
            const result = await importWorkflow(jsonFile(payload));
            expect(result).toBeNull();
        });

        it('rejects malformed JSON', async () => {
            const badFile = jsonFile('not json');
            const result = await importWorkflow(badFile);
            expect(result).toBeNull();
        });
    });
});
