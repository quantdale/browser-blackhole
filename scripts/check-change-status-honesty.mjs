/**
 * Implementation-status honesty check (spatial-atlas-status-honesty task 2).
 *
 * OpenSpec's change status means "planning artifacts exist" — NOT that the
 * implementation checklist was touched. This script is the repository's
 * implementation-status authority (design D1): it reads every active change
 * (openspec/changes/* except the archive), counts the tasks.md checkboxes,
 * reads each change's own "implementation status" header line, and FAILS
 * when the header's claim contradicts the checklist:
 *
 *   header claims COMPLETE     -> requires completed === total (total > 0)
 *   header claims NOT STARTED  -> requires completed === 0
 *   header claims IN PROGRESS  -> requires 0 < completed < total
 *   unrecognized status value  -> FAIL (the grammar only accepts what it
 *                                  understands; silent no-claims are lies)
 *
 * A change with no status header keeps the old lenient behavior ONLY where no
 * SHALL binds it: header-less IN PROGRESS and COMPLETE changes are reported
 * with the derived status and pass with no claim to contradict. But a
 * header-less ZERO-COMPLETED change FAILS: the spec requires that change's
 * own status header to state that implementation has not started
 * ('Planning-complete SHALL NOT be reported as implementation-complete').
 * The check must not implement, check, reorder or summarize any task body.
 *
 * Usage: node scripts/check-change-status-honesty.mjs [changesRoot]
 * (default: openspec/changes)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ROOT = 'openspec/changes';
const root = process.argv[2] === undefined ? DEFAULT_ROOT : process.argv[2];

let rootStat = null;
try {
  rootStat = statSync(root);
} catch {
  rootStat = null;
}
if (rootStat === null || !rootStat.isDirectory()) {
  console.error(`check-change-status-honesty: changes root '${root}' is not a directory`);
  process.exit(2);
}

/** Checkbox counts from tasks.md, deliberately skipping fenced code blocks. */
function countCheckboxes(tasksPath) {
  let total = 0;
  let completed = 0;
  const lines = readFileSync(tasksPath, 'utf8').split('\n');
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const item = /^\s*[-*]\s+\[([ xX])\]/.exec(line);
    if (item === null) continue;
    total += 1;
    if (item[1] !== ' ') completed += 1;
  }
  return { total, completed };
}

/**
 * The change's own status-claim line. Only lines that explicitly name
 * "implementation status" count as a claim (a stray prose sentence about
 * implementation does not); the FIRST 40 lines define the header block.
 *
 * A banner line is a line whose ONLY role is the banner — an optional
 * blockquote marker and optional bold markers, then literally
 * "implementation status:" … — so a checkbox evidence citation that merely
 * quotes the banner text (`- [x] 1.1 … \`**implementation status: NOT
 * STARTED**\` …`) is not parsed as a claim.
 */
function readStatusClaim(changeDir) {
  const candidates = ['proposal.md', 'tasks.md'];
  for (const file of candidates) {
    const full = join(changeDir, file);
    try {
      const head = readFileSync(full, 'utf8').split('\n').slice(0, 40);
      for (const line of head) {
        const stripped = line
          .trim()
          .replace(/^>\s*/, '') // blockquote banner
          .replace(/^\*{2}/, '') // opening bold
          .trim();
        const match = /^implementation[\s-]+status\s*[:=]\s*(.+)$/i.exec(stripped);
        if (match === null) continue;
        let value = match[1]
          .trim()
          .replace(/\*{2}\s*$/, '') // closing bold
          .replace(/`/g, '')
          .replace(/[.;,]+$/, '')
          .trim();
        if (/^not[\s-]+started|\bnever\b/i.test(value)) return { file, claim: 'not-started', line };
        if (/^in[\s-]?progress/i.test(value)) return { file, claim: 'in-progress', line };
        if (/^complete|^done|^shipped/i.test(value)) return { file, claim: 'complete', line };
        return { file, claim: 'unrecognized', line };
      }
    } catch {
      continue; // file missing (a change may legitimately lack proposal.md)
    }
  }
  return null;
}

const active = [];
for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (entry.name === 'archive') continue;
  const dir = join(root, entry.name);
  let hasTasks = false;
  try {
    hasTasks = statSync(join(dir, 'tasks.md')).isFile();
  } catch {
    hasTasks = false;
  }
  if (hasTasks) active.push({ name: entry.name, dir });
}

const failures = [];
const rows = [];
for (const { name, dir } of active) {
  const tasksPath = join(dir, 'tasks.md');
  let calculated;
  try {
    calculated = countCheckboxes(tasksPath);
  } catch {
    failures.push(`${name}: tasks.md is unreadable`);
    continue;
  }
  const { total, completed } = calculated;
  const claim = readStatusClaim(dir);
  if (claim === null) {
    const word = statusWord(completed, total);
    if (total > 0 && completed === 0) {
      failures.push(
        `${name}: zero completed tasks (${completed}/${total}) but the change carries NO ` +
          'implementation-status header — the spec requires that change\u2019s own status ' +
          'header to state that implementation has not started ' +
          '(e.g. a line reading exactly **implementation status: NOT STARTED**)'
      );
      rows.push(`${name}  ${completed}/${total}  header=none  derived=not-started  FAIL`);
      continue;
    }
    rows.push(`${name}  ${completed}/${total}  header=none  derived=${word}  ok`);
    continue;
  }
  const claimed = `${claim.file}: ${claim.claim} (${claim.line.trim()})`;
  if (claim.claim === 'unrecognized') {
    failures.push(`${name}: unrecognized implementation-status value in ${claimed}`);
    rows.push(`${name}  ${completed}/${total}  header=unrecognized  FAIL`);
    continue;
  }
  if (claim.claim === 'complete' && !(total > 0 && completed === total)) {
    failures.push(
      `${name}: header claims implementation is COMPLETE in ${claimed} but the ` +
        `checklist shows ${completed}/${total} — OpenSpec planning-complete is not ` +
        'implementation-complete; uncheck the claim or do the work'
    );
    rows.push(`${name}  ${completed}/${total}  header=complete  FAIL`);
    continue;
  }
  if (claim.claim === 'not-started' && completed > 0) {
    failures.push(
      `${name}: header claims implementation is NOT STARTED in ${claimed} but ` +
        `${completed}/${total} tasks are checked — correct the header to IN PROGRESS`
    );
    rows.push(`${name}  ${completed}/${total}  header=not-started  FAIL`);
    continue;
  }
  if (claim.claim === 'in-progress' && !(total > 0 && completed < total && completed > 0)) {
    failures.push(
      `${name}: header claims implementation is IN PROGRESS in ${claimed} but the ` +
        `checklist shows ${completed}/${total} — a zero-completed checklist is NOT ` +
        'STARTED, not in progress'
    );
    rows.push(`${name}  ${completed}/${total}  header=in-progress  FAIL`);
    continue;
  }
  rows.push(
    `${name}  ${completed}/${total}  header=${claim.claim}  derived=${statusWord(completed, total)}  ok`
  );
}

console.log(`check-change-status-honesty: root=${root}`);
for (const row of rows) console.log(`  ${row}`);

if (failures.length > 0) {
  console.error('check-change-status-honesty: FAIL — status header contradicts the checklist:');
  for (const failure of failures) console.error(`  - ${failure}`);
  console.error(
    'check-change-status-honesty: a status header must agree with the tasks.md ' +
      'checkbox counts (planning-complete is not implementation-complete).'
  );
  process.exit(1);
}
console.log(`check-change-status-honesty: ok (${rows.length} active change(s) inspected)`);

/** Derived word for the report; never drives the verdict. */
function statusWord(completed, total) {
  if (total === 0) return 'no-tasks';
  if (completed === 0) return 'not-started';
  if (completed >= total) return 'complete';
  return 'in-progress';
}
