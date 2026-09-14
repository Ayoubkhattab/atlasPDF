import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import ConditionalNode from '@/components/workflow/ConditionalNode';
import type { ToolNodeData } from '@/types/workflow';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const CJK_PATTERN = /[一-鿿]/;

function baseData(overrides: Partial<ToolNodeData> = {}): ToolNodeData {
  return {
    toolId: 'condition-gateway',
    label: 'Condition Gateway',
    icon: 'git-fork',
    category: 'flow-control',
    acceptedFormats: ['*'],
    outputFormat: '*',
    status: 'idle',
    progress: 0,
    ...overrides,
  };
}

function renderNode(data: ToolNodeData) {
  return render(
    <ReactFlowProvider>
      <ConditionalNode id="cond-1" data={data} />
    </ReactFlowProvider>
  );
}

describe('ConditionalNode', () => {
  it('renders no CJK characters with no settings configured', () => {
    const { container } = renderNode(baseData());
    expect(container.textContent).not.toMatch(CJK_PATTERN);
  });

  it('renders no CJK characters for a contains-operator condition', () => {
    const { container } = renderNode(
      baseData({
        settings: { conditionType: 'file-format', operator: 'contains', value: 'pdf' },
      })
    );
    expect(container.textContent).not.toMatch(CJK_PATTERN);
  });

  it('renders no CJK characters when a branch has executed or been skipped', () => {
    const { container: completeContainer } = renderNode(
      baseData({ status: 'complete', activeBranch: 'true' })
    );
    expect(completeContainer.textContent).not.toMatch(CJK_PATTERN);

    const { container: skippedContainer } = renderNode(baseData({ status: 'skipped' }));
    expect(skippedContainer.textContent).not.toMatch(CJK_PATTERN);
  });

  it('does not use the old hardcoded Chinese delete-button title', () => {
    const { container } = renderNode(baseData());
    // The delete button only renders on hover
    fireEvent.mouseEnter(container.firstElementChild as Element);
    const deleteButtonTitle = container.querySelector('button[title]')?.getAttribute('title');
    expect(deleteButtonTitle).toBeTruthy();
    expect(deleteButtonTitle).not.toBe('删除节点');
  });
});
