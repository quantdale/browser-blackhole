import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * U-04 (docs/MASTER_PLAN.md, change `destination-control-truthfulness`): the
 * `__ATLAS_APP__` test hook hands the whole host — including the forced
 * continuous-render entry point and a synchronous framebuffer readback — to
 * any script on the page. A PRODUCTION build must not carry it.
 *
 * This is a build-output property, so it is asserted by inspecting the bundle
 * rather than by a browser probe: a browser cannot observe a surface that
 * must not exist. The e2e bundle legitimately DOES contain the assignment,
 * because `npm run build:e2e` sets `VITE_ATLAS_TEST_HOOKS=1`.
 *
 * Usage: `npm run build && node scripts/check-no-test-hook.mjs`.
 */

const assetsDir = join(process.cwd(), 'dist', 'assets');

let entries;
try {
  entries = readdirSync(assetsDir);
} catch {
  console.error('[check-no-test-hook] dist/assets not found — run `npm run build` first.');
  process.exit(2);
}

const jsFiles = entries.filter((name) => name.endsWith('.js'));
if (jsFiles.length === 0) {
  console.error('[check-no-test-hook] no JS assets in dist/assets — that is not a build.');
  process.exit(2);
}

const violations = [];
for (const file of jsFiles) {
  const body = readFileSync(join(assetsDir, file), 'utf8');
  if (body.includes('__ATLAS_APP__={')) {
    violations.push(`${file}: assigns the __ATLAS_APP__ test hook`);
  }
  if (body.includes('__ATLAS_TEST_HOOKS_OPT_IN__')) {
    violations.push(`${file}: leaks the un-substituted __ATLAS_TEST_HOOKS_OPT_IN__ define`);
  }
}

if (violations.length > 0) {
  console.error('[check-no-test-hook] FAIL — the production bundle exposes test instrumentation:');
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

console.log(
  `[check-no-test-hook] ok — ${jsFiles.length} JS assets, no test hook, no unsubstituted define.`
);
