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
 * A change with no status header is REPORTED with the derived status but
 * does not fail: no claim, no contradiction (spec scenario "Planning
 * artifacts exist and no task is complete" is satisfied by the report).
 * The check must not implement, check, reorder or summarize any task body.
 *
 * Usage: node scripts/check-change-status-honesty.mjs [changesRoot]
 * (default: openspec/changes)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_ROOT = 'openspec/changes';
const root = process.argv[2] === undefined ? DEFAULT_ROOT : process.argv[2];

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
 */
function readStatusClaim(changeDir) {
  const candidates = ['proposal.md', 'tasks.md'];
  for (const file of candidates) {
    const full = join(changeDir, file);
    try {
      const head = readFileSync(full, 'utf8').split('\n').slice(0, 40);
      for (const line of head) {
        const match = /implementation\s+status\s*[:=]\s*(.+)$/i.exec(
          line.replace(/^[\s>*-]+/, '')
        );
        if (match !== null) {
          let value = match[1].trim();
          value = value.replace(/\*\*/g, '').replace(/`/g, '').replace(/_/g, ' ');
          value = value.replace(/^[^A-Za-z]+/, '').trim();
          if (/not\s*[-\s]?started/i.test(value)) return { file, claim: 'not-started', line };
          if (/in\s*[-\s]?progress/i.test(value)) return { file, claim: 'in-progress', line };
          if (/complete|done|shipped/i.test(value))
            return { file, claim: 'complete', line };
          return { file, claim: 'unrecognized', line };
        }
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
    rows.push(`${name}  ${completed}/${total}  header=none  derived=${statusWord(completed, total)}  ok`);
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
