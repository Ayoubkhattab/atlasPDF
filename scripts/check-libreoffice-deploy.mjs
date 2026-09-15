#!/usr/bin/env node
/**
 * Verify that a deployed AtlasPDF instance can actually load the LibreOffice WASM
 * engine (Word / Excel / PowerPoint / RTF to PDF).
 *
 *   node scripts/check-libreoffice-deploy.mjs https://your-domain [--page /en/tools/pptx-to-pdf/]
 *
 * Every LibreOffice outage so far has been a server-side mismatch that the browser only
 * reports as a vague "Failed to fetch" / net::ERR_* deep inside a 100MB+ download:
 *   - COOP/COEP missing            -> no SharedArrayBuffer, engine cannot start
 *   - CSP connect-src without blob: -> worker cannot read its own blob: URLs
 *   - CSP script-src without 'unsafe-eval' -> soffice.js (Embind) throws EvalError
 *   - stale assets / reused ?v=    -> JS glue and WASM from different builds
 * This script checks all of those from the command line in a few seconds, against the
 * files committed in this checkout, so run it after every deploy.
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const base = (args.find((a) => !a.startsWith('--')) || '').replace(/\/+$/, '');
const pageArgIndex = args.indexOf('--page');
const pagePath = pageArgIndex >= 0 ? args[pageArgIndex + 1] : '/en/tools/pptx-to-pdf/';

if (!/^https?:\/\//.test(base)) {
    console.error('Usage: node scripts/check-libreoffice-deploy.mjs https://your-domain [--page /en/tools/pptx-to-pdf/]');
    process.exit(2);
}

let failures = 0;
let warnings = 0;
const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg, fix) => { failures++; console.log(`  ✗ ${msg}${fix ? `\n      fix: ${fix}` : ''}`); };
const warn = (msg, fix) => { warnings++; console.log(`  ! ${msg}${fix ? `\n      note: ${fix}` : ''}`); };
function check(ok, okMsg, failMsg, fix) {
    if (ok) pass(okMsg);
    else fail(failMsg, fix);
}

function readExpectedVersion() {
    const generated = join(ROOT, 'src/lib/libreoffice/asset-version.ts');
    const source = existsSync(generated) ? generated : join(ROOT, 'src/lib/libreoffice/converter.ts');
    const match = readFileSync(source, 'utf8').match(/(?:LIBREOFFICE_ASSET_VERSION|ASSET_VERSION)\s*=\s*'([^']+)'/);
    if (!match) throw new Error(`Could not find the LibreOffice asset version in ${source}`);
    return match[1];
}

function parseCsp(headerValue) {
    // Multiple CSP headers are joined with "," and are ALL enforced - a source is only
    // allowed if every policy allows it.
    return headerValue.split(',').map((policy) => {
        const directives = new Map();
        for (const part of policy.split(';')) {
            const [name, ...sources] = part.trim().split(/\s+/);
            if (name) directives.set(name.toLowerCase(), sources);
        }
        return directives;
    });
}

function cspAllows(policies, directiveChain, source) {
    return policies.every((directives) => {
        const name = directiveChain.find((d) => directives.has(d));
        if (!name) return true; // no applicable directive -> unrestricted
        return directives.get(name).includes(source);
    });
}

async function request(path, init = {}) {
    const url = `${base}${path}`;
    try {
        return await fetch(url, { redirect: 'follow', ...init });
    } catch (err) {
        return { ok: false, status: 0, headers: new Headers(), error: err, url };
    }
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function main() {
    const version = readExpectedVersion();
    console.log(`Checking ${base} (expected LibreOffice asset version: ${version})\n`);

    // ---------------------------------------------------------------- page headers
    console.log(`Page ${pagePath}`);
    const page = await request(pagePath);
    if (!page.ok) {
        fail(`page returned HTTP ${page.status}${page.error ? ` (${page.error.message})` : ''}`);
    } else {
        pass(`HTTP ${page.status}`);
        const coop = page.headers.get('cross-origin-opener-policy');
        const coep = page.headers.get('cross-origin-embedder-policy');
        check(coop === 'same-origin',
            'Cross-Origin-Opener-Policy: same-origin',
            `Cross-Origin-Opener-Policy is "${coop}"`, 'send "Cross-Origin-Opener-Policy: same-origin" on HTML responses');
        check(coep === 'require-corp' || coep === 'credentialless',
            `Cross-Origin-Embedder-Policy: ${coep}`,
            `Cross-Origin-Embedder-Policy is "${coep}"`, 'send "Cross-Origin-Embedder-Policy: require-corp" on HTML responses');

        const cspHeader = page.headers.get('content-security-policy');
        if (!cspHeader) {
            warn('no Content-Security-Policy header (nothing blocked, but network isolation is not enforced)');
        } else {
            const policies = parseCsp(cspHeader);
            const scriptChain = ['script-src', 'default-src'];
            check(cspAllows(policies, scriptChain, "'unsafe-eval'"),
                "CSP script-src allows 'unsafe-eval' (needed by soffice.js / Embind)",
                "CSP script-src is missing 'unsafe-eval'",
                "add 'unsafe-eval' to script-src (security-headers.conf / _headers / netlify.toml / vercel.json), then reload the web server");
            check(cspAllows(policies, scriptChain, "'wasm-unsafe-eval'") || cspAllows(policies, scriptChain, "'unsafe-eval'"),
                'CSP script-src allows WebAssembly compilation',
                "CSP script-src is missing 'wasm-unsafe-eval'", "add 'wasm-unsafe-eval' to script-src");
            check(cspAllows(policies, ['connect-src', 'default-src'], 'blob:'),
                'CSP connect-src allows blob:',
                'CSP connect-src is missing blob:', 'add blob: to connect-src');
            check(cspAllows(policies, ['worker-src', 'child-src', 'script-src', 'default-src'], "'self'"),
                "CSP worker-src allows 'self'",
                "CSP worker-src does not allow 'self'", "add 'self' to worker-src");
        }
    }

    // ---------------------------------------------------------------- JS glue (exact content match)
    console.log('\nLibreOffice JS glue (must be byte-identical to this checkout)');
    for (const file of ['soffice.js', 'soffice.worker.js', 'browser.worker.global.js']) {
        const res = await request(`/libreoffice-wasm/${file}?v=${version}`);
        const localPath = join(ROOT, 'public/libreoffice-wasm', file);
        if (!res.ok) {
            fail(`${file}: HTTP ${res.status}`, 'the file is not being served from /libreoffice-wasm/');
            continue;
        }
        const remote = Buffer.from(await res.arrayBuffer());
        const local = readFileSync(localPath);
        check(sha256(remote) === sha256(local),
            `${file}: matches this checkout (${local.length} bytes)`,
            `${file}: served content differs from this checkout (${remote.length} vs ${local.length} bytes)`,
            'the server is running an older build - pull, rebuild, and recreate the container');
    }

    // ---------------------------------------------------------------- compressed engine
    console.log('\nLibreOffice engine (.gz, decompressed in the browser)');
    for (const file of ['soffice.wasm.bin.gz', 'soffice.data.bin.gz']) {
        const path = `/libreoffice-wasm/${file}?v=${version}`;
        const localSize = statSync(join(ROOT, 'public/libreoffice-wasm', file)).size;
        const head = await request(path, { method: 'HEAD', headers: { 'accept-encoding': 'identity' } });
        if (!head.ok) {
            const manifest = await request(`/libreoffice-wasm/${file}.manifest.json?v=${version}`);
            check(manifest.ok,
                `${file}: served as chunks (manifest found)`,
                `${file}: HTTP ${head.status}, and no chunk manifest`, 'the .gz engine files are missing from the deployment');
            continue;
        }
        const encoding = head.headers.get('content-encoding');
        const length = Number(head.headers.get('content-length') || 0);
        if (encoding && encoding !== 'identity') {
            warn(`${file}: served with Content-Encoding: ${encoding}`,
                'still works (the browser decodes it), but downloads cannot be resumed; serve .gz files without Content-Encoding');
        } else if (length === localSize) {
            pass(`${file}: ${(localSize / 1048576).toFixed(1)} MB, size matches this checkout`);
        } else {
            fail(`${file}: served size ${length} differs from this checkout (${localSize})`, 'stale deployment - pull, rebuild, recreate the container');
        }
        if (head.headers.get('accept-ranges') === 'bytes') pass(`${file}: Range requests supported (resumable download)`);
        else warn(`${file}: no Accept-Ranges: bytes`, 'downloads will restart from zero after a dropped connection');

        const probe = await request(path, { headers: { range: 'bytes=0-1', 'accept-encoding': 'identity' } });
        const magic = probe.ok ? Buffer.from(await probe.arrayBuffer()).subarray(0, 2).toString('hex') : '';
        if (magic === '1f8b') pass(`${file}: gzip header present`);
        else if (encoding) pass(`${file}: body decoded by the server/proxy (acceptable)`);
        else fail(`${file}: first bytes are "${magic}", not gzip`, 'wrong file or a proxy rewriting the body');
    }

    // ---------------------------------------------------------------- font
    console.log('\nFonts');
    const font = await request(`/fonts/NotoSansSC-Regular.ttf?v=${version}`, { method: 'HEAD' });
    check(font.ok, 'NotoSansSC-Regular.ttf reachable', `NotoSansSC-Regular.ttf: HTTP ${font.status}`);

    console.log(`\n${failures === 0 ? 'OK' : 'FAILED'}: ${failures} failure(s), ${warnings} warning(s)`);
    // exitCode rather than process.exit(): exiting while fetch sockets are still closing trips a
    // libuv assertion on Windows and turns every result into exit code 127.
    process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 2;
});
