/**
 * Shared-shader / legacy-state boundary check (hosted-product-boot-coverage
 * 1.3 + review re-check; capability `shared-module-legacy-boundary`).
 *
 * Spec scenario: **a shader module outside the legacy shell that imports the
 * legacy application state module fails the check** — including indirectly
 * through any neutral module a shader imports. The legacy shell's own
 * renderer files (`src/renderer/BlackHoleRenderer.ts`,
 * `src/renderer/RenderCoordinator.ts`) MAY keep that import, so the check
 * must not fail *for those files*.
 *
 * Implementation: a CLOSURE scan. A "shader module" is (a) every module
 * under `src/shaders/` plus (b) every module under `src/` that imports TSL
 * from `three/webgpu` — the semantic marker of GPU shader construction, so a
 * GPU module outside `src/shaders/` (e.g. `phenomena/black-hole/lut/lensingGpu.ts`)
 * is covered too. Each seed's relative-import graph is walked. A violation is
 * ANY import of the legacy application state module (`src/app/state.ts`) made
 * by a non-exempt module reachable from the seed set. Walking stops at the
 * exempt legacy-shell files: their own `app/state` imports are the sanctioned
 * legacy behavior and their graphs stay outside the product shader boundary.
 * A spec string that references `app/state` but does not resolve is also a
 * violation (an unresolved import is broken code, never harmless).
 *
 * Usage: node scripts/check-shared-shader-boundary.mjs [<srcRoot>]
 * (default: `src`; `<srcRoot>` must contain `shaders/`)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, sep } from 'node:path';

const srcRoot = normalize(process.argv[2] === undefined ? 'src' : process.argv[2]);

function listTypeScript(dir, acc) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listTypeScript(path, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) acc.push(normalize(path));
  }
  return acc;
}

const shadersDir = join(srcRoot, 'shaders');
let statTry = null;
try {
  statTry = statSync(shadersDir);
} catch {
  statTry = null;
}
if (statTry === null || !statTry.isDirectory()) {
  console.error(`check-shared-shader-boundary: cannot read shader seed directory ${shadersDir}`);
  process.exit(2);
}

/** Legacy-shell files are exempt: they ARE the sanctioned legacy diagnostic app. */
const EXEMPT = new Set(
  ['renderer/BlackHoleRenderer.ts', 'renderer/RenderCoordinator.ts'].map((p) =>
    normalize(join(srcRoot, p))
  )
);

const seeds = listTypeScript(srcRoot, []).filter((file) => {
  if (EXEMPT.has(file)) return false;
  // (a) the shader directory is always a seed set;
  if (file.startsWith(`${shadersDir}${sep}`)) return true;
  // (b) any module constructing TSL shaders is a shader module regardless of
  // directory, so GPU modules outside src/shaders/ are covered too.
  return /from\s+['"]three\/webgpu['"]/.test(readFileSync(file, 'utf8'));
});

/** The legacy application state module, in every text file form it may take. */
const STATE_FILES = new Set(
  ['state.ts', 'state.tsx', 'state.js'].map((name) => normalize(join(srcRoot, 'app', name)))
);

/** Resolve a relative import specifier to an actual sibling TypeScript file. */
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // bare/external (three/webgpu, vite, ...)
  const base = normalize(join(dirname(fromFile), spec));
  const candidates = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx')];
  if (/\.tsx?$/.test(base)) {
    // explicit extension: base is already a candidate
  } else {
    candidates.push(`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'));
  }
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Does the import (resolved file, or the raw unresolved spec text) point at
 * the legacy state module? Separator-insensitive on the raw-text fallback.
 */
function targetsStateModule(spec, resolved) {
  if (resolved !== null) return STATE_FILES.has(resolved);
  const raw = normalize(spec.replace(/\.js$/, '').replace(/\.[cm]?tsx?$/, '')).replace(/\\/g, '/');
  return /(^|\/)app\/state$/.test(raw);
}

/** Extract import specifiers (import / export-from / side-effect) from a line. */
function importSpecs(line) {
  const specs = [];
  const from = /from\s+['"]([^'"]+)['"]/.exec(line);
  if (from !== null) specs.push(from[1]);
  const sideEffect = /^\s*import\s+['"]([^'"]+)['"]/.exec(line);
  if (sideEffect !== null) specs.push(sideEffect[1]);
  return specs;
}

const violations = [];
const walked = new Set();
const queue = seeds.map((f) => f);
while (queue.length > 0) {
  const file = queue.pop();
  if (walked.has(file)) continue;
  walked.add(file);
  const isExempt = EXEMPT.has(file);
  const lines = readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const spec of importSpecs(lines[i])) {
      const resolved = resolveImport(file, spec);
      if (!isExempt && targetsStateModule(spec, resolved)) {
        violations.push(
          `${relative('.', file)}:${i + 1}: ${lines[i].trim().replace(/\s+/g, ' ').slice(0, 110)}` +
            ` (via ${shadersDir}${seeds.includes(file) ? ' seed' : ' import graph'})`
        );
      }
      if (resolved === null || isExempt || walked.has(resolved)) continue;
      queue.push(resolved);
    }
  }
}

console.log(
  `check-shared-shader-boundary: scanned ${walked.size} module(s) in the shader import closure ` +
    `(${seeds.length} seed(s): ${shadersDir} + three/webgpu importers) ` +
    `for legacy-app/state imports (${EXEMPT.size} legacy-shell file(s) exempt)`
);

if (violations.length > 0) {
  console.error(
    'check-shared-shader-boundary: FAIL — a module in the shared-shader import graph ' +
      'imports the legacy application state module:\n' +
      violations.join('\n')
  );
  process.exit(1);
}
console.log(
  'check-shared-shader-boundary: ok (no module in the shader import graph imports app/state)'
);
