/**
 * Shared-shader / legacy-state boundary check (hosted-product-boot-coverage
 * 1.3; capability `shared-module-legacy-boundary`).
 *
 * A shader module shared by the product SHALL NOT import types or values
 * from the legacy application state module (`src/app/state.ts`). The legacy
 * shell's own renderer files (`src/renderer/BlackHoleRenderer.ts`,
 * `src/renderer/RenderCoordinator.ts`) MAY keep that import, so only the
 * modules under `src/shaders/` are scanned — the legacy renderer files are
 * not part of the shared product path.
 *
 * Failure names the file and line; a missing import never fails the job.
 *
 * Usage: node scripts/check-shared-shader-boundary.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SHADERS = 'src/shaders';
const LEGACY_STATE = 'app/state';

function scan(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) scan(path, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) acc.push(path);
  }
  return acc;
}

const files = statSync(SHADERS).isDirectory() ? scan(SHADERS, []) : [];

const violations = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // import/export-from path that points at the legacy state module
    // (relative or aliased, with or without the .js extension).
    const from = /from\s+['"]([^'"]+)['"]/.exec(line);
    if (from && from[1].includes(`${LEGACY_STATE}.js`)) {
      violations.push(`${relative('.', file)}:${i + 1}: ${line.trim()}`);
      return;
    }
    // Side-effect style `import '../app/state.js'` (no `from`).
    const direct = /^\s*import\s+['"]([^'"]+)['"]/.exec(line);
    if (direct && direct[1].includes(`${LEGACY_STATE}.js`)) {
      violations.push(`${relative('.', file)}:${i + 1}: ${line.trim()}`);
    }
  });
}

console.log(
  `check-shared-shader-boundary: scanned ${files.length} module(s) under ${SHADERS}\\ for '${LEGACY_STATE}' imports`
);

if (violations.length > 0) {
  console.error(
    `check-shared-shader-boundary: FAIL — a shared shader module imports the legacy application state module:\n${violations.join('\n')}`
  );
  process.exit(1);
}
console.log('check-shared-shader-boundary: ok (no shared shader module imports app/state)');
