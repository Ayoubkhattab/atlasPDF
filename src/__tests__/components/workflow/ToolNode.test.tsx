import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import ToolNode from '@/components/workflow/ToolNode';
import type { ToolNodeData } from '@/types/workflow';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const CJK_PATTERN = /[一-鿿]/;

function baseData(overrides: Partial<ToolNodeData> = {}): ToolNodeData {
  return {
    toolId: 'merge-pdf',
    label: 'Merge PDF',
    icon: 'file-plus',
    category: 'organize-manage',
    acceptedFormats: ['.pdf'],
    outputFormat: '.pdf',
    status: 'idle',
    progress: 0,
    ...overrides,
  };
}

function renderNode(data: ToolNodeData) {
  return render(
    <ReactFlowProvider>
      <ToolNode id="node-1" data={data} />
    </ReactFlowProvider>
  );
}

// Every toolId branch in getNodeSettingsSummary, with settings that exercise
// its non-empty-settings code path, plus a couple of no-settings defaults.
const SUMMARY_CASES: Array<{ toolId: string; settings?: Record<string, unknown> }> = [
  { toolId: 'rotate-pdf' },
  { toolId: 'rotate-pdf', settings: { angle: 180 } },
  { toolId: 'compress-pdf' },
  { toolId: 'compress-pdf', settings: { quality: 'maximum', algorithm: 'photon' } },
  { toolId: 'split-pdf' },
  { toolId: 'split-pdf', settings: { splitMode: 'every-n-pages', pagesPerSplit: 3 } },
  { toolId: 'split-pdf', settings: { splitMode: 'ranges', pageRanges: '1-3,5' } },
  { toolId: 'download-pdf' },
  { toolId: 'download-pdf', settings: { filename: 'report.pdf' } },
  { toolId: 'download-zip' },
  { toolId: 'download-zip', settings: { filename: 'bundle.zip' } },
  { toolId: 'add-watermark', settings: { watermarkType: 'image', repeat: true } },
  { toolId: 'add-watermark', settings: { watermarkType: 'image' } },
  { toolId: 'add-watermark', settings: { watermarkType: 'text', text: 'SECRET', repeat: true } },
  { toolId: 'add-watermark', settings: { watermarkType: 'text', text: 'SECRET' } },
  { toolId: 'page-numbers', settings: { position: 'top-left', startNumber: 5 } },
  { toolId: 'djvu-to-pdf', settings: { dpi: 300 } },
  { toolId: 'condition-gateway', settings: { conditionType: 'file-size', operator: 'contains', value: 10, sizeUnit: 'MB' } },
  { toolId: 'condition-gateway', settings: { conditionType: 'file-format', operator: 'ends-with', value: 'pdf' } },
  { toolId: 'n-up-pdf', settings: { pagesPerSheet: 2, pageSize: 'Letter' } },
  { toolId: 'extract-pages', settings: { pageRange: '1-5' } },
  { toolId: 'delete-pages', settings: { pageRange: '2' } },
  { toolId: 'ocr-pdf', settings: { language: 'eng' } },
  { toolId: 'encrypt-pdf', settings: { userPassword: 'secret' } },
  { toolId: 'encrypt-pdf', settings: { userPassword: '' } },
  { toolId: 'flatten-pdf', settings: { flattenForms: true } },
  { toolId: 'table-of-contents', settings: { title: 'Contents' } },
  { toolId: 'header-footer', settings: { headerText: 'Confidential', footerText: 'Page' } },
  { toolId: 'header-footer', settings: { unrelated: true } },
  { toolId: 'background-color', settings: { color: '#eeeeee' } },
  { toolId: 'text-color', settings: { color: '#111111' } },
  { toolId: 'some-other-tool', settings: { filename: 'x.pdf' } },
  { toolId: 'some-other-tool', settings: { quality: 'high' } },
  { toolId: 'some-other-tool', settings: { color: '#000' } },
];

describe('ToolNode', () => {
  it.each(SUMMARY_CASES)('renders no CJK characters for $toolId with given settings', ({ toolId, settings }) => {
    const { container } = renderNode(baseData({ toolId, settings }));
    expect(container.textContent).not.toMatch(CJK_PATTERN);
  });

  it('renders no CJK characters in input/output handle tooltips', () => {
    const { container } = renderNode(baseData());
    const titles = Array.from(container.querySelectorAll('[title]')).map((el) => el.getAttribute('title') || '');
    for (const title of titles) {
      expect(title).not.toMatch(CJK_PATTERN);
    }
  });

  it('renders no CJK characters in the generated-files count badge', () => {
    const { container } = renderNode(
      baseData({
        status: 'complete',
        outputFiles: [{ blob: new Blob(['x']) }],
      })
    );
    expect(container.textContent).not.toMatch(CJK_PATTERN);
  });
});
