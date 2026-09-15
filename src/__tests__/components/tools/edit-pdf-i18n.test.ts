/**
 * The Direct Content Editor is a vendored app under public/, outside the
 * Next.js bundle, so its Arabic wiring cannot be covered by rendering a
 * component. These tests load the shipped index.html and i18n.js and run them
 * the way the browser does.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const EDITOR_DIR = path.join(process.cwd(), 'public', 'direct-pdf-editor');
const html = fs.readFileSync(path.join(EDITOR_DIR, 'index.html'), 'utf8');
const i18nSource = fs.readFileSync(path.join(EDITOR_DIR, 'i18n.js'), 'utf8');

const ARABIC = /[\u0600-\u06FF]/;

/** Strip the head/script tags jsdom would try to fetch, keep the body markup. */
function bodyMarkup(): string {
    const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
    return (match ? match[1] : html).replace(/<script[\s\S]*?<\/script>/g, '');
}

/**
 * Each call stands in for one iframe load. The body is replaced outright rather
 * than emptied so that the MutationObserver installed by a previous load stays
 * bound to the discarded element instead of translating the next one.
 */
function loadEditor(lang: string) {
    window.history.replaceState({}, '', `/direct-pdf-editor/index.html?lang=${lang}`);
    document.documentElement.setAttribute('lang', 'en');

    const body = document.createElement('body');
    body.innerHTML = bodyMarkup();
    document.documentElement.replaceChild(body, document.body);

    // eslint-disable-next-line no-eval
    window.eval(i18nSource);
}

describe('direct editor Arabic localisation', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        window.history.replaceState({}, '', '/');
    });

    it('ships a translation for every key the markup references', () => {
        const used = new Set<string>();
        for (const m of html.matchAll(/data-i18n(?:-title|-placeholder)?="([^"]+)"/g)) {
            used.add(m[1]);
        }
        const translated = new Set(
            [...i18nSource.matchAll(/^ {4}'([^']+)':/gm)].map(m => m[1])
        );

        expect(used.size).toBeGreaterThan(100);
        expect([...used].filter(k => !translated.has(k))).toEqual([]);
        expect([...translated].filter(k => !used.has(k))).toEqual([]);
    });

    it('translates text, tooltips and placeholders when lang=ar', () => {
        loadEditor('ar');

        const texts = [...document.querySelectorAll('[data-i18n]')];
        const titles = [...document.querySelectorAll('[data-i18n-title]')];
        const placeholders = [...document.querySelectorAll('[data-i18n-placeholder]')];

        expect(texts.length).toBeGreaterThan(0);
        expect(texts.every(el => ARABIC.test(el.textContent || ''))).toBe(true);
        expect(titles.every(el => ARABIC.test(el.getAttribute('title') || ''))).toBe(true);
        expect(placeholders.every(el => ARABIC.test(el.getAttribute('placeholder') || ''))).toBe(true);

        expect(document.documentElement.getAttribute('lang')).toBe('ar');
    });

    it('marks translated nodes dir="auto" rather than flipping the document', () => {
        loadEditor('ar');

        const texts = [...document.querySelectorAll('[data-i18n]')];
        expect(texts.every(el => el.getAttribute('dir') === 'auto')).toBe(true);
        // styles.css is physical-direction only, so the shell must stay LTR.
        expect(document.documentElement.getAttribute('dir')).toBeNull();
    });

    it('accepts a regional tag such as ar-SA', () => {
        loadEditor('ar-SA');

        const exportLabel = document.querySelector('[data-i18n="tools:editPdfText.export"]');
        expect(exportLabel?.textContent).toBe('تصدير');
        expect(document.documentElement.getAttribute('lang')).toBe('ar');
    });

    it('leaves the markup untouched for other locales', () => {
        for (const lang of ['en', 'fr', '']) {
            loadEditor(lang);

            // Checked against known strings rather than "no Arabic anywhere":
            // the spell-check picker legitimately lists العربية as an option.
            expect(
                document.querySelector('[data-i18n="tools:editPdfText.export"]')?.textContent
            ).toBe('Export');
            expect(
                document
                    .querySelector('[data-i18n-title="tools:editPdfText.tipBold"]')
                    ?.getAttribute('title')
            ).toBe('Bold');
            expect(document.querySelectorAll('[data-i18n][dir]')).toHaveLength(0);
            expect(document.documentElement.getAttribute('lang')).toBe('en');
        }
    });

    it('translates panels the editor injects after load', () => {
        loadEditor('ar');

        const injected = document.createElement('div');
        injected.innerHTML =
            '<button data-i18n="tools:editPdfText.replaceAll"></button>' +
            '<i data-i18n-title="tools:editPdfText.tipZoomIn"></i>';
        document.body.appendChild(injected);

        return new Promise<void>(resolve => {
            // MutationObserver callbacks run as a microtask.
            queueMicrotask(() => {
                expect(injected.querySelector('button')?.textContent).toBe('استبدال الكل');
                expect(injected.querySelector('i')?.getAttribute('title')).toBe('تكبير');
                resolve();
            });
        });
    });
});
