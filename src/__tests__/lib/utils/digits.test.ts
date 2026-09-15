import { describe, it, expect } from 'vitest';
import { normalizeDigits } from '@/lib/utils/digits';

describe('normalizeDigits', () => {
    it('converts Arabic-Indic digits to ASCII', () => {
        expect(normalizeDigits('١٢٣')).toBe('123');
        expect(normalizeDigits('٠')).toBe('0');
        expect(normalizeDigits('٩')).toBe('9');
    });

    it('converts Extended Arabic-Indic (Persian/Urdu) digits to ASCII', () => {
        expect(normalizeDigits('۱۲۳')).toBe('123');
    });

    it('converts the Arabic comma and semicolon to an ASCII comma', () => {
        expect(normalizeDigits('1، 3، 5')).toBe('1, 3, 5');
        expect(normalizeDigits('1؛ 3')).toBe('1, 3');
    });

    it('converts en/em dash and minus-sign look-alikes to an ASCII hyphen', () => {
        expect(normalizeDigits('1–5')).toBe('1-5');
        expect(normalizeDigits('1—5')).toBe('1-5');
        expect(normalizeDigits('1−5')).toBe('1-5');
    });

    it('normalizes a realistic Arabic-keyboard page range end to end', () => {
        expect(normalizeDigits('١-٣، ٥')).toBe('1-3, 5');
    });

    it('leaves already-ASCII input unchanged', () => {
        expect(normalizeDigits('1-3,5,7-10')).toBe('1-3,5,7-10');
    });

    it('passes through empty, undefined and null unchanged', () => {
        expect(normalizeDigits('')).toBe('');
        expect(normalizeDigits(undefined)).toBeUndefined();
        expect(normalizeDigits(null)).toBeNull();
    });
});
