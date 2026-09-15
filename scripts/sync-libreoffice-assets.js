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
 * soffice.wasm.bin.gz, soffice.data.bin.gz). The browser downloads those .gz
 * files as plain bytes and decompresses them itself (see
 * src/lib/libreoffice/gzip.ts), so no server-side gzip configuration is needed.
 *
 * Files that are already up to date are left untouched (a .gz counts as up to date
 * when it decompresses to exactly the installed binary), so running this on every
 * install never rewrites the committed ~76MB of .gz data just because a different
 * zlib build would compress it to different bytes.
 *
 * Finally it regenerates src/lib/libreoffice/asset-version.ts, the content-derived
 * `?v=` cache key - see scripts/libreoffice-asset-version.mjs.
 *
 * Run this after installing/updating @matbee/libreoffice-converter:
 * - npm run postinstall
 * - or manually: node scripts/sync-libreoffice-assets.js
 */

import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { createHash } from 'crypto';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createGunzip, createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { writeLibreOfficeAssetVersionModule, ASSET_VERSION_MODULE } from './libreoffice-asset-version.mjs';

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

async function sha256OfStream(stream) {
    const hash = createHash('sha256');
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest('hex');
}

async function gzipIsUpToDate(srcPath, gzPath) {
    if (!existsSync(gzPath)) return false;
    try {
        const [srcHash, gzHash] = await Promise.all([
            sha256OfStream(createReadStream(srcPath)),
            sha256OfStream(createReadStream(gzPath).pipe(createGunzip())),
        ]);
        return srcHash === gzHash;
    } catch {
        return false; // corrupt or truncated .gz - regenerate it
    }
}

function sameText(a, b) {
    // Compare modulo CRLF so a Windows checkout of an identical file isn't rewritten.
    return a.toString('latin1').replace(/\r\n/g, '\n') === b.toString('latin1').replace(/\r\n/g, '\n');
}

async function gzipFile(srcPath, destPath) {
    await pipeline(createReadStream(srcPath), createGzip({ level: 6 }), createWriteStream(destPath));
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

    console.log('Syncing LibreOffice WASM converter assets...');

    for (const file of plainCopies) {
        const srcPath = join(rootDir, file.src);
        const destPath = join(rootDir, file.dest);
        if (!existsSync(srcPath)) {
            console.warn(`⚠️  Source not found: ${file.src} - skipping ${file.name}`);
            continue;
        }
        try {
            if (existsSync(destPath) && sameText(readFileSync(srcPath), readFileSync(destPath))) {
                console.log(`✓ ${file.name} already up to date`);
                continue;
            }
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
            console.warn(`⚠️  Source not found: ${file.src} - skipping ${file.name}`);
            continue;
        }
        try {
            if (await gzipIsUpToDate(srcPath, destPath)) {
                console.log(`✓ ${file.name} already up to date`);
                continue;
            }
            console.log(`… Compressing ${file.name} (${(statSync(srcPath).size / 1024 / 1024).toFixed(1)}MB source)...`);
            await gzipFile(srcPath, destPath);
            console.log(`✓ Wrote ${file.name} (${(statSync(destPath).size / 1024 / 1024).toFixed(1)}MB)`);
        } catch (error) {
            console.error(`✗ Failed to compress ${file.name}:`, error.message);
        }
    }

    const { assetVersion, changed } = writeLibreOfficeAssetVersionModule(rootDir);
    console.log(`${changed ? '✓ Wrote' : '✓'} ${ASSET_VERSION_MODULE}: ${assetVersion}`);
    console.log('LibreOffice WASM asset sync complete.');
}

main().catch((err) => {
    console.error('[sync-libreoffice] Error:', err);
    process.exit(1);
});
