/**
 * Sync LibreOffice WASM converter assets to public/libreoffice-wasm/
 *
 * @matbee/libreoffice-converter's WorkerBrowserConverter class (bundled into the
 * app from node_modules) talks to a worker script over a private message protocol
 * that can change between releases - it MUST come from the exact same package
 * build as the soffice WASM binary/data it drives. Unlike pdfjs-dist and
 * tesseract.js (synced by sync-pdfjs-workers.js / sync-tesseract-assets.js on
 * every install), these assets had no such sync step: public/libreoffice-wasm/
 * was a one-time manual copy, so a routine `npm install` that bumped
 * @matbee/libreoffice-converter within its "^2.5.0" range (package-lock.json can
 * legitimately resolve anywhere in that range) left the committed WASM/worker
 * assets on an older build than the JS talking to them - conversions that reach
 * LibreOffice can fail or hang with no obvious cause.
 *
 * soffice.wasm (~147MB) and soffice.data (~100MB) exceed GitHub's 100MB file
 * size limit, so only their .gz forms are committed (public/libreoffice-wasm/
 * soffice.wasm.bin.gz, soffice.data.bin.gz) - see scripts/decompress-wasm-dev.mjs
 * for how the "predev"/"postinstall" step turns those back into the .bin files
 * the converter actually requests at runtime.
 *
 * Run this after installing/updating @matbee/libreoffice-converter:
 * - npm run postinstall
 * - or manually: node scripts/sync-libreoffice-assets.js
 */

import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const PKG_DIST = 'node_modules/@matbee/libreoffice-converter/dist';
const PKG_WASM = 'node_modules/@matbee/libreoffice-converter/wasm';
const DEST_DIR = 'public/libreoffice-wasm';

const plainCopies = [
    { src: `${PKG_DIST}/browser.worker.global.js`, dest: `${DEST_DIR}/browser.worker.global.js`, name: 'browser.worker.global.js' },
    { src: `${PKG_WASM}/soffice.js`, dest: `${DEST_DIR}/soffice.js`, name: 'soffice.js (Emscripten glue)' },
    { src: `${PKG_WASM}/soffice.worker.js`, dest: `${DEST_DIR}/soffice.worker.js`, name: 'soffice.worker.js' },
];

const gzipCopies = [
    { src: `${PKG_WASM}/soffice.wasm`, dest: `${DEST_DIR}/soffice.wasm.bin.gz`, name: 'soffice.wasm.bin.gz' },
    { src: `${PKG_WASM}/soffice.data`, dest: `${DEST_DIR}/soffice.data.bin.gz`, name: 'soffice.data.bin.gz' },
];

async function gzipFile(srcPath, destPath) {
    const source = createReadStream(srcPath);
    const gzip = createGzip({ level: 6 });
    const destination = createWriteStream(destPath);
    await pipeline(source, gzip, destination);
}

async function main() {
    const pkgDir = join(rootDir, 'node_modules/@matbee/libreoffice-converter');
    if (!existsSync(pkgDir)) {
        console.log('[sync-libreoffice] @matbee/libreoffice-converter not installed, skipping.');
        return;
    }

    const destDir = join(rootDir, DEST_DIR);
    if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
    }

    console.log('Syncing LibreOffice WASM converter assets...\n');

    for (const file of plainCopies) {
        const srcPath = join(rootDir, file.src);
        const destPath = join(rootDir, file.dest);
        if (!existsSync(srcPath)) {
            console.warn(`⚠️  Source not found: ${file.src}`);
            console.warn(`   Skipping ${file.name}\n`);
            continue;
        }
        try {
            copyFileSync(srcPath, destPath);
            console.log(`✓ Copied ${file.name}`);
        } catch (error) {
            console.error(`✗ Failed to copy ${file.name}:`, error.message);
        }
    }

    for (const file of gzipCopies) {
        const srcPath = join(rootDir, file.src);
        const destPath = join(rootDir, file.dest);
        if (!existsSync(srcPath)) {
            console.warn(`⚠️  Source not found: ${file.src}`);
            console.warn(`   Skipping ${file.name}\n`);
            continue;
        }
        try {
            const srcSize = statSync(srcPath).size;
            console.log(`… Compressing ${file.name} (${(srcSize / 1024 / 1024).toFixed(1)}MB source)...`);
            await gzipFile(srcPath, destPath);
            const destSize = statSync(destPath).size;
            console.log(`✓ Wrote ${file.name} (${(destSize / 1024 / 1024).toFixed(1)}MB)`);
        } catch (error) {
            console.error(`✗ Failed to compress ${file.name}:`, error.message);
        }
    }

    console.log('\nLibreOffice WASM asset sync complete!');
    console.log('Run scripts/decompress-wasm-dev.mjs (or `npm run dev`, which does it via "predev") to refresh the local .bin copies.');
}

main().catch((err) => {
    console.error('[sync-libreoffice] Error:', err);
    process.exit(1);
});
