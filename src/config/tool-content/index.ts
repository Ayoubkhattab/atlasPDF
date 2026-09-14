/**
 * Tool content exports for all languages
 * Requirements: 3.1 - Multi-language support
 */

export { toolContentEn } from './en';
export { toolContentAr } from './ar';

import { toolContentEn } from './en';
import { toolContentAr } from './ar';
import { ToolContent } from '@/types/tool';
import type { Locale } from '@/lib/i18n/config';

export type { Locale } from '@/lib/i18n/config';


/**
 * Get tool content for a specific locale
 * Falls back to English if translation not found
 */
export function getToolContent(locale: Locale, toolId: string): ToolContent | undefined {
  const contentMap: Record<Locale, Record<string, ToolContent>> = {
    en: toolContentEn,
    ar: toolContentAr,
  };

  const localeContent = contentMap[locale];
  if (localeContent && localeContent[toolId]) {
    return localeContent[toolId];
  }

  // Fallback to English
  return toolContentEn[toolId];
}

