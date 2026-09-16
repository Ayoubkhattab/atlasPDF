/**
 * Forces Arabic text onto the project's own font before a document reaches LibreOffice.
 *
 * Measured rather than assumed. Converting the same Word document five ways and reading the fonts
 * the resulting PDF embeds:
 *
 *   ascii=Arial, cs=Arial          → DejaVuSans + LiberationSans
 *   ascii=Arial, cs=Qomra, rtl     → itfQomraArabic
 *   ascii=Arial, cs=Qomra, no rtl  → itfQomraArabic
 *   ascii=Qomra, no cs             → DejaVuSans
 *
 * Two things follow. Arabic glyphs come from the complex-script font slot and nothing else — a
 * document asking for Arial gets Liberation Sans, which has no Arabic at all, so the glyphs fall
 * through to DejaVu Sans and look nothing like the original. And the <w:rtl/> marker is
 * irrelevant: the cs attribute alone decides. PowerPoint behaves the same way through <a:cs>.
 *
 * So this rewrites exactly that attribute inside the OOXML package and nothing else — Latin text,
 * layout, sizes and every other property are left as the author wrote them.
 */

import JSZip from 'jszip';

/** The family name inside the shipped TTFs; Regular and Bold are one family, the other weights are not. */
export const ARABIC_FONT_FAMILY = 'itf Qomra Arabic';

/** word/document.xml, styles.xml, header*.xml, footnotes.xml … but never word/_rels/*. */
const WORD_PARTS = /^word\/[^/]+\.xml$/;
/** Slides, layouts, masters, notes and themes: every part that can name a font. */
const PRESENTATION_PARTS = /^ppt\/(slides|slideLayouts|slideMasters|notesSlides|notesMasters|theme)\/[^/]+\.xml$/;

const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function rewriteWordXml(xml: string, family = ARABIC_FONT_FAMILY): string {
    const font = attr(family);
    let out = xml
        // A theme reference outranks the explicit font, so it has to go or it wins again.
        .replace(/\s+w:cstheme="[^"]*"/g, '')
        .replace(/w:cs="[^"]*"/g, `w:cs="${font}"`)
        // A run that names fonts but no complex-script one falls back to the document default.
        .replace(/<w:rFonts\b([^>]*?)(\/?)>/g, (match, attrs: string, selfClosing: string) =>
            attrs.includes('w:cs=') ? match : `<w:rFonts${attrs} w:cs="${font}"${selfClosing}>`);

    // A run with no <w:rFonts> at all inherits from docDefaults, so that needs the font too.
    out = out.replace(/<w:rPrDefault>[\s\S]*?<\/w:rPrDefault>/g, (block) =>
        block.includes('<w:rFonts')
            ? block
            : block.replace('<w:rPr>', `<w:rPr><w:rFonts w:cs="${font}"/>`));

    return out;
}

export function rewritePresentationXml(xml: string, family = ARABIC_FONT_FAMILY): string {
    const font = attr(family);
    return xml
        // Includes the theme's <a:cs typeface=""/>, which is what runs without an explicit
        // complex-script font inherit from.
        .replace(/<a:cs\b[^>]*\/>/g, `<a:cs typeface="${font}"/>`)
        // A run property that names a Latin (and maybe East Asian) font but no complex-script one.
        // The trailing slot is matched rather than ruled out with a lookahead: the optional
        // East Asian group backtracks out of the way, and a lookahead then wrongly reports the
        // slot missing and inserts a second one.
        .replace(
            /(<a:latin\b[^>]*\/>)(\s*<a:ea\b[^>]*\/>)?(\s*<a:cs\b[^>]*\/>)?/g,
            (match, latin: string, eastAsian?: string, complexScript?: string) =>
                complexScript ? match : `${latin}${eastAsian ?? ''}<a:cs typeface="${font}"/>`,
        );
}

/**
 * Returns the document with its complex-script font forced to `family`, or null when there is
 * nothing to do — a format this does not apply to, or a package that cannot be read. Callers keep
 * their original bytes on null: a font preference must never cost someone their conversion.
 */
export async function forceArabicFont(
    data: Uint8Array,
    extension: string,
    family = ARABIC_FONT_FAMILY,
): Promise<Uint8Array<ArrayBuffer> | null> {
    const ext = extension.toLowerCase();
    const parts = ext === 'docx' ? WORD_PARTS : ext === 'pptx' ? PRESENTATION_PARTS : null;
    if (!parts) return null;
    const rewrite = ext === 'docx' ? rewriteWordXml : rewritePresentationXml;

    try {
        const zip = await JSZip.loadAsync(data);
        const targets = Object.keys(zip.files).filter((path) => parts.test(path) && !zip.files[path].dir);
        if (targets.length === 0) return null;

        let changed = false;
        for (const path of targets) {
            const original = await zip.files[path].async('string');
            const rewritten = rewrite(original, family);
            if (rewritten !== original) {
                zip.file(path, rewritten);
                changed = true;
            }
        }
        if (!changed) return null;

        // DEFLATE keeps the package roughly the size it arrived as; LibreOffice reads either.
        const repacked = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
        // Copied so the result is backed by a plain ArrayBuffer, which is what the worker's
        // transfer path expects — JSZip's own typing leaves that open.
        return new Uint8Array(repacked);
    } catch (e) {
        console.warn(`[LibreOffice] Could not set the Arabic font on this ${ext}; converting it unchanged:`, e);
        return null;
    }
}
