/**
 * Digit / punctuation normalization for user-typed numeric input.
 *
 * Arabic keyboard layouts (the default on Arabic Windows/Android builds)
 * commonly emit Arabic-Indic digits (٠-٩) instead of ASCII ones when a user
 * presses the number row, and the comma key produces the Arabic comma "،"
 * rather than ",". JS's `parseInt`/`Number` do not understand either, so a
 * page-range field like "١، ٣، ٥" silently parses to NaN for every entry -
 * the UI shows nothing wrong, but the resulting page list is empty.
 *
 * `normalizeDigits` maps these (plus the Extended Arabic-Indic/Persian digits
 * used on Persian/Urdu keyboards, and common dash look-alikes some IMEs or
 * autocorrect substitute for "-") back to their ASCII equivalents, so any
 * code that later calls `parseInt`/`Number` on the result behaves the same
 * regardless of which keyboard layout produced the text.
 */

const ARABIC_INDIC_DIGITS = '٠١٢٣٤٥٦٧٨٩'; // U+0660-U+0669
const EXTENDED_ARABIC_INDIC_DIGITS = '۰۱۲۳۴۵۶۷۸۹'; // U+06F0-U+06F9 (Persian/Urdu)

const DIGIT_MAP = new Map<string, string>();
for (let i = 0; i < 10; i++) {
  DIGIT_MAP.set(ARABIC_INDIC_DIGITS[i], String(i));
  DIGIT_MAP.set(EXTENDED_ARABIC_INDIC_DIGITS[i], String(i));
}

// Arabic comma/semicolon -> ASCII comma; common dash look-alikes -> ASCII hyphen-minus
const PUNCTUATION_MAP = new Map<string, string>([
  ['،', ','], // Arabic comma "،"
  ['؛', ','], // Arabic semicolon "؛"
  ['–', '-'], // en dash "–"
  ['—', '-'], // em dash "—"
  ['−', '-'], // minus sign "−"
]);

/**
 * Convert Arabic-Indic / Extended Arabic-Indic digits to ASCII digits, and
 * normalize Arabic list/range punctuation to their ASCII equivalents.
 * Safe to call on already-ASCII input (it's a no-op in that case), and on
 * `undefined`/`null`/empty strings (returned unchanged) so it can wrap an
 * optional `pageRange?: string` argument at a call site without extra checks.
 */
export function normalizeDigits<T extends string | undefined | null>(input: T): T {
  if (!input) return input;
  let result = '';
  for (const char of input as string) {
    result += DIGIT_MAP.get(char) ?? PUNCTUATION_MAP.get(char) ?? char;
  }
  return result as T;
}
