import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * Flat config, required by ESLint 9.
 *
 * Until this existed the project had no ESLint configuration at all: `npm run
 * lint` aborted with "couldn't find eslint.config.js", and Next 16 dropped the
 * `eslint` key from next.config.js, so builds stopped linting too. Source files
 * still carry `eslint-disable` comments for typescript-eslint rules, so the
 * TypeScript preset is included to keep those directives meaningful.
 *
 * Linting is not wired into `next build` (Next 16 removed that) and CI only
 * runs the build, so the backlog this reports gates nothing yet.
 */
export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    // Defaults from eslint-config-next, which are replaced rather than merged.
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    // Build outputs and vendored bundles that are not ours to lint.
    'dist/**',
    'node_modules/**',
    'src-tauri/target/**',
    'deploy-artifacts/**',
    'public/**',
    'extension/**',
  ]),
]);
