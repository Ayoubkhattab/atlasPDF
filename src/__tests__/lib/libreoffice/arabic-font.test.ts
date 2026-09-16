import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
    ARABIC_FONT_FAMILY,
    forceArabicFont,
    rewritePresentationXml,
    rewriteWordXml,
} from '@/lib/libreoffice/arabic-font';

const FONT = ARABIC_FONT_FAMILY;

describe('rewriteWordXml', () => {
    it('points an existing complex-script font at the bundled family', () => {
        const out = rewriteWordXml('<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>');
        expect(out).toContain(`w:cs="${FONT}"`);
        expect(out).not.toContain('w:cs="Arial"');
        // The Latin side is the author's business, not ours.
        expect(out).toContain('w:ascii="Arial"');
    });

    it('drops the theme reference, which would otherwise outrank the explicit font', () => {
        const out = rewriteWordXml('<w:rFonts w:cstheme="minorBidi" w:cs="Arial"/>');
        expect(out).not.toContain('w:cstheme');
        expect(out).toContain(`w:cs="${FONT}"`);
    });

    it('adds the attribute to a run that names fonts but no complex-script one', () => {
        expect(rewriteWordXml('<w:rFonts w:ascii="Calibri"/>')).toBe(
            `<w:rFonts w:ascii="Calibri" w:cs="${FONT}"/>`,
        );
        expect(rewriteWordXml('<w:rFonts w:ascii="Calibri"></w:rFonts>')).toContain(
            `<w:rFonts w:ascii="Calibri" w:cs="${FONT}">`,
        );
    });

    it('gives docDefaults the font, so runs with no rFonts at all inherit it', () => {
        const out = rewriteWordXml('<w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>');
        expect(out).toContain(`<w:rPr><w:rFonts w:cs="${FONT}"/>`);
    });

    it('leaves docDefaults that already declare fonts to the attribute rules above', () => {
        const out = rewriteWordXml('<w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri"/></w:rPr></w:rPrDefault>');
        expect(out.match(/<w:rFonts/g)).toHaveLength(1);
        expect(out).toContain(`w:cs="${FONT}"`);
    });
});

describe('rewritePresentationXml', () => {
    it('rewrites an explicit complex-script typeface', () => {
        expect(rewritePresentationXml('<a:cs typeface="Traditional Arabic"/>')).toBe(
            `<a:cs typeface="${FONT}"/>`,
        );
    });

    it('fills in the theme slot that runs inherit from', () => {
        const theme = '<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>';
        expect(rewritePresentationXml(theme)).toContain(`<a:cs typeface="${FONT}"/>`);
        expect(rewritePresentationXml(theme)).toContain('<a:latin typeface="Calibri"/>');
    });

    it('adds the slot after a Latin font when it is missing', () => {
        expect(rewritePresentationXml('<a:rPr><a:latin typeface="Arial"/></a:rPr>')).toBe(
            `<a:rPr><a:latin typeface="Arial"/><a:cs typeface="${FONT}"/></a:rPr>`,
        );
    });

    it('does not add a second slot when one already follows', () => {
        const out = rewritePresentationXml('<a:latin typeface="Arial"/><a:ea typeface="X"/><a:cs typeface="Y"/>');
        expect(out.match(/<a:cs/g)).toHaveLength(1);
        expect(out).toContain(`<a:cs typeface="${FONT}"/>`);
    });
});

describe('forceArabicFont', () => {
    const wordPackage = async (documentXml: string) => {
        const zip = new JSZip();
        zip.file('[Content_Types].xml', '<Types/>');
        zip.folder('word')!.file('document.xml', documentXml);
        return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
    };

    it('rewrites the parts of a Word package that name fonts', async () => {
        const input = await wordPackage('<w:rFonts w:ascii="Arial" w:cs="Arial"/>');
        const output = await forceArabicFont(input, 'docx');
        expect(output).not.toBeNull();

        const document = await (await JSZip.loadAsync(output!)).file('word/document.xml')!.async('string');
        expect(document).toContain(`w:cs="${FONT}"`);
    });

    it('leaves formats it does not understand alone', async () => {
        const input = await wordPackage('<w:rFonts w:cs="Arial"/>');
        expect(await forceArabicFont(input, 'rtf')).toBeNull();
        expect(await forceArabicFont(input, 'pdf')).toBeNull();
    });

    it('reports nothing to do when no part mentions a font', async () => {
        expect(await forceArabicFont(await wordPackage('<w:p><w:r><w:t>plain</w:t></w:r></w:p>'), 'docx')).toBeNull();
    });

    it('returns null rather than throwing when the bytes are not a package', async () => {
        expect(await forceArabicFont(new Uint8Array([1, 2, 3, 4]), 'docx')).toBeNull();
    });
});
