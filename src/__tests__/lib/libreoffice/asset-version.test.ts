// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIBREOFFICE_ASSET_VERSION, LIBREOFFICE_PACKAGE_VERSION } from '@/lib/libreoffice/asset-version';

describe('LibreOffice asset version', () => {
    it('matches the committed engine files and the installed @matbee/libreoffice-converter', async () => {
        // The ?v= cache key is served with Cache-Control: immutable - if the engine files change
        // without it changing, returning visitors keep an old soffice.js against a new engine.
        const root = process.cwd();
        const { computeLibreOfficeAssetVersion } = await import(
            pathToFileURL(join(root, 'scripts/libreoffice-asset-version.mjs')).href
        );
        const { packageVersion, assetVersion } = computeLibreOfficeAssetVersion(root);

        expect(LIBREOFFICE_PACKAGE_VERSION, 'assets are from another package version - run: node scripts/sync-libreoffice-assets.js').toBe(packageVersion);
        expect(LIBREOFFICE_ASSET_VERSION, 'engine files changed - run: node scripts/libreoffice-asset-version.mjs --write').toBe(assetVersion);
    });
});
