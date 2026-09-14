import { describe, expect, it } from 'vitest';
import { getAllTools } from '@/config/tools';
import { getToolContent } from '@/config/tool-content';

describe('tool content integrity', () => {
  it('provides fallback content for every configured tool to avoid 404 pages', () => {
    const missingToolsEn = getAllTools()
      .map((tool) => tool.id)
      .filter((toolId) => !getToolContent('en', toolId));
    const missingToolsAr = getAllTools()
      .map((tool) => tool.id)
      .filter((toolId) => !getToolContent('ar', toolId));

    expect(missingToolsEn).toEqual([]);
    expect(missingToolsAr).toEqual([]);
  });
});
