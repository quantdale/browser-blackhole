/**
 * Smoke-gate coverage assertion (verification-gate-integrity D6/V-06, task
 * 6.1).
 *
 * A skip is honest reporting; a green badge over a degraded run is not. This
 * script parses the machine-readable Playwright JSON report and FAILS when
 * fewer than the expected number of tests executed or when any test skipped,
 * so the hosted smoke job cannot silently pass after skipping 2 of its 5
 * rows (the pre-fix behavior).
 *
 * Usage: node scripts/check-smoke-coverage.mjs <results.json> <expected-count>
 */

import { readFileSync } from 'node:fs';

const [, , resultsPath, expectedRaw] = process.argv;
if (resultsPath === undefined || expectedRaw === undefined) {
  console.error('usage: node scripts/check-smoke-coverage.mjs <results.json> <expected-count>');
  process.exit(2);
}
const expected = Number.parseInt(expectedRaw, 10);
if (!Number.isInteger(expected) || expected <= 0) {
  console.error(`check-smoke-coverage: bad expected count '${expectedRaw}'`);
  process.exit(2);
}

let report;
try {
  report = JSON.parse(readFileSync(resultsPath, 'utf8'));
} catch (error) {
  console.error(`check-smoke-coverage: cannot read ${resultsPath}: ${String(error)}`);
  process.exit(2);
}

let executed = 0;
let skipped = 0;
const skippedNames = [];
const walk = (suite) => {
  for (const spec of suite.specs ?? []) {
    for (const testCase of spec.tests ?? []) {
      const status = testCase.status ?? testCase.results?.[testCase.results.length - 1]?.status;
      if (status === 'skipped') {
        skipped += 1;
        skippedNames.push(spec.title);
      } else {
        executed += 1;
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child);
};
for (const suite of report.suites ?? []) walk(suite);

console.log(`check-smoke-coverage: executed=${executed} skipped=${skipped} expected=${expected}`);

if (skipped > 0) {
  console.error(
    `check-smoke-coverage: FAIL — ${skipped} test(s) skipped (${skippedNames.join(', ')}); a skip is not a pass`
  );
  process.exit(1);
}
if (executed !== expected) {
  console.error(
    `check-smoke-coverage: FAIL — ${executed} test(s) executed, expected ${expected}; a missing row must not pass silently`
  );
  process.exit(1);
}
console.log('check-smoke-coverage: ok');
