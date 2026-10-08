/**
 * Builds the Playwright e2e bundle.
 *
 * The only difference from `npm run build` is `VITE_ATLAS_TEST_HOOKS=1`, which
 * `vite.config.ts` reads and bakes into the bundle as
 * `__ATLAS_TEST_HOOKS_OPT_IN__`. That is what lets the `__ATLAS_APP__` test
 * hook exist for the browser suite while `npm run build` — the artifact CI
 * validates and any deployment serves — ships with no such surface at all
 * (U-04, `docs/MASTER_PLAN.md`).
 *
 * A Node shim rather than a shell one-liner so the same command works on
 * Windows (where `VAR=1 cmd` is meaningless) and on POSIX CI runners. The
 * variable is passed through the child environment only; nothing is written to
 * disk and no dependency is added.
 */

import { spawnSync } from 'node:child_process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(npmCmd, ['run', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_ATLAS_TEST_HOOKS: '1' },
  shell: process.platform === 'win32'
});

if (result.error) {
  console.error(`[build:e2e] failed to spawn "${npmCmd} run build":`, result.error);
  process.exit(1);
}
process.exit(result.status ?? 1);
