/**
 * Sync Tesseract.js worker + core WASM files to public/tesseract directory
 *
 * Tesseract.js defaults to loading its worker script, WASM core, and per-language
 * .traineddata files from cdn.jsdelivr.net when workerPath/corePath are not set
 * explicitly. For network isolation (see docs/PROJECT_STUDY.md §9), AtlasPDF hosts
 * all of these locally instead. The worker and core files ship inside the installed
 * npm packages already, so we just copy them into public/ on install; language
 * .traineddata.gz files are downloaded separately (see public/tesseract/lang-data/).
 *
 * Run this script after installing/updating tesseract.js / tesseract.js-core:
 * - npm run postinstall
 * - or manually: node scripts/sync-tesseract-assets.js
 */

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

const files = [
    {
        src: 'node_modules/tesseract.js/dist/worker.min.js',
        dest: 'public/tesseract/worker.min.js',
        name: 'tesseract.js worker',
    },
    {
        src: 'node_modules/tesseract.js-core/tesseract-core.wasm.js',
        dest: 'public/tesseract/core/tesseract-core.wasm.js',
        name: 'tesseract.js-core (no SIMD)',
    },
    {
        src: 'node_modules/tesseract.js-core/tesseract-core.wasm',
        dest: 'public/tesseract/core/tesseract-core.wasm',
        name: 'tesseract.js-core (no SIMD) wasm binary',
    },
    {
        src: 'node_modules/tesseract.js-core/tesseract-core-simd.wasm.js',
        dest: 'public/tesseract/core/tesseract-core-simd.wasm.js',
        name: 'tesseract.js-core (SIMD)',
    },
    {
        src: 'node_modules/tesseract.js-core/tesseract-core-simd.wasm',
        dest: 'public/tesseract/core/tesseract-core-simd.wasm',
        name: 'tesseract.js-core (SIMD) wasm binary',
    },
    {
        src: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
        dest: 'public/tesseract/core/tesseract-core-lstm.wasm.js',
        name: 'tesseract.js-core (LSTM-only, no SIMD)',
    },
    {
        src: 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm',
        dest: 'public/tesseract/core/tesseract-core-lstm.wasm',
        name: 'tesseract.js-core (LSTM-only, no SIMD) wasm binary',
    },
    {
        src: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
        dest: 'public/tesseract/core/tesseract-core-simd-lstm.wasm.js',
        name: 'tesseract.js-core (LSTM-only, SIMD)',
    },
    {
        src: 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm',
        dest: 'public/tesseract/core/tesseract-core-simd-lstm.wasm',
        name: 'tesseract.js-core (LSTM-only, SIMD) wasm binary',
    },
];

console.log('Syncing Tesseract.js worker + core files...\n');

for (const file of files) {
    const srcPath = join(rootDir, file.src);
    const destPath = join(rootDir, file.dest);
    const destDir = dirname(destPath);

    if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
    }

    if (!existsSync(srcPath)) {
        console.warn(`⚠️  Source not found: ${file.src}`);
        console.warn(`   Skipping ${file.name}\n`);
        continue;
    }

    try {
        copyFileSync(srcPath, destPath);
        console.log(`✓ Copied ${file.name} -> ${file.dest}`);
    } catch (error) {
        console.error(`✗ Failed to copy ${file.name}:`, error.message);
    }
}

console.log('\nTesseract.js asset sync complete!');
console.log('Note: language .traineddata.gz files are NOT synced by this script — they');
console.log('are committed directly under public/tesseract/lang-data/.');
