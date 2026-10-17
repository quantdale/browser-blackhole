/**
 * Command-surface check (documentation-truthfulness-realignment D-09/tasks
 * 4.2-4.3).
 *
 * Extracts every `npm run <name>` reference from the documentation, README
 * and agent-instruction files and fails if any named command is absent from
 * package.json's script surface. A documented command that does not exist is
 * a lie to the next agent.
 *
 * `scripts/command-surface-allowlist.json` lists commands that are
 * intentionally NOT scripts (each with a reason); the allowlist is reviewed
 * data, not a silent escape.
 *
 * Usage: node scripts/check-command-surface.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SCAN_DIRS = ['docs', '.agent', 'openspec'];
const SCAN_FILES = ['README.md', 'AGENTS.md', 'ONBOARDING.md', 'package.json'];

function walkMarkdown(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkMarkdown(p, out);
    else if (entry.name.endsWith('.md')) out.push(p);
  }
  return out;
}

function existingFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// Trust-boundary reads: a malformed package.json/allowlist fails with an
// explicit message, not a bare parse traceback.
function readJson(path, what) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    console.error(`check-command-surface: cannot read ${what} at ${path}: ${String(error)}`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    console.error(`check-command-surface: ${what} is not valid JSON: ${String(error)}`);
    process.exit(2);
  }
}

const packageJson = readJson(join(ROOT, 'package.json'), 'package.json');
const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
const allowlist = new Map(
  Object.entries(
    readJson(
      join(ROOT, 'scripts', 'command-surface-allowlist.json'),
      'the command-surface allowlist'
    )
  )
);

const files = [];
for (const file of SCAN_FILES) {
  if (existingFile(join(ROOT, file))) files.push(join(ROOT, file));
}
for (const dir of SCAN_DIRS) {
  try {
    walkMarkdown(join(ROOT, dir), files);
  } catch {
    // absent directory: nothing to scan
  }
}

const missing = new Map();
const pattern = /npm run ([a-zA-Z0-9:_-]+)/g;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const name = match[1];
    // Wildcard/family references (`npm run bench:*`) and placeholders
    // (`npm run <name>`) are prose, not commands.
    const nextChar = text[pattern.lastIndex];
    if (nextChar === '*' || nextChar === '<' || name.endsWith(':')) continue;
    if (scripts.has(name)) continue;
    if (allowlist.has(name)) continue;
    if (!missing.has(name)) missing.set(name, []);
    missing.get(name).push(file.slice(ROOT.length + 1));
  }
}

if (missing.size > 0) {
  console.error('check-command-surface: FAIL — documented commands with no script:');
  for (const [name, where] of missing) {
    console.error(`  - npm run ${name}  (referenced in ${[...new Set(where)].join(', ')})`);
  }
  process.exit(1);
}
console.log(
  `check-command-surface: ok — ${files.length} files scanned, ${scripts.size} scripts, ` +
    `${allowlist.size} reviewed allowlist entr${allowlist.size === 1 ? 'y' : 'ies'}`
);
