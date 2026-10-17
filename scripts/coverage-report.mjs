/**
 * Unit-test import-coverage report (verification-gate-integrity D8/V-10,
 * tasks 7.1-7.3). Report ONLY — it never fails the build and sets no
 * threshold (a global threshold would fight the deliberate design that
 * `src/shaders/*` and the DOM shells are covered by browser tests).
 *
 * Scope honesty: this is STATIC IMPORT coverage — it answers exactly the
 * question the design names ("which module has no unit coverage at all"),
 * not statement coverage. The vitest coverage provider (@vitest/coverage-v8)
 * is the preferred tooling; its installation is currently blocked by a
 * deterministic npm/arborist failure on the development machine
 * (`Cannot read properties of null (reading 'edgesOut')` — even after
 * `npm ci` and with `--package-lock-only`), so this report substitutes the
 * visibility goal until the toolchain is repaired (recorded in
 * openspec/changes/verification-gate-integrity/tasks.md §7).
 *
 * Usage: node scripts/coverage-report.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const SRC_ROOT = join(REPO_ROOT, 'src');
const UNIT_ROOT = join(REPO_ROOT, 'tests', 'unit');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Static `from '...'`/`import('...')` specifiers in a TS source. */
function importSpecifiers(source) {
  const specifiers = [];
  const fromRe = /from\s+['"]([^'"]+)['"]/g;
  const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const re of [fromRe, dynRe]) {
    let m;
    while ((m = re.exec(source)) !== null) specifiers.push(m[1]);
  }
  return specifiers;
}

function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null; // package import: not src
  const base = join(fromFile, '..', specifier.replace(/\.js$/, '.ts'));
  try {
    if (statSync(base).isFile()) return base;
  } catch {
    return null;
  }
  return null;
}

const srcFiles = walk(SRC_ROOT).filter((p) => !p.endsWith('.d.ts'));
const unitFiles = walk(UNIT_ROOT);

const covered = new Set();
for (const testFile of unitFiles) {
  const source = readFileSync(testFile, 'utf8');
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveSpecifier(testFile, specifier);
    if (resolved !== null) covered.add(resolved);
  }
}

const uncovered = srcFiles.filter((p) => !covered.has(p)).map((p) => relative(REPO_ROOT, p));
const coveredCount = srcFiles.length - uncovered.length;

console.log('unit-test import coverage (static, report-only):');
console.log(`  src modules: ${srcFiles.length}`);
console.log(`  imported by at least one unit test: ${coveredCount}`);
console.log(`  with NO unit-test importer: ${uncovered.length}`);

// The deliberate browser-only families are listed first so the report reads
// as intentional, not accidental (task 7.2).
const browserOnlyPrefixes = ['src/shaders/', 'src/ui/', 'src/app/', 'src/main.ts'];
const deliberate = [];
const suspicious = [];
for (const file of uncovered) {
  if (browserOnlyPrefixes.some((prefix) => file.startsWith(prefix))) deliberate.push(file);
  else suspicious.push(file);
}
if (deliberate.length > 0) {
  console.log('\nDELIBERATE browser-only coverage (see docs/TESTING.md §2):');
  for (const file of deliberate) console.log(`  ${file}`);
}
if (suspicious.length > 0) {
  console.log('\nNo unit-test importer (candidates for future unit coverage):');
  for (const file of suspicious) console.log(`  ${file}`);
}
console.log('\n(coverage:report is report-only — no threshold, never a build failure)');
