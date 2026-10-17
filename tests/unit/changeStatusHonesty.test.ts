/**
 * Implementation-status honesty check (spatial-atlas-status-honesty task 2).
 *
 * Black-box: the real `scripts/check-change-status-honesty.mjs` runs against
 * fixture change roots and its exit code / findings are asserted —
 *
 *  - a header claiming implementation is COMPLETE over a zero-completed
 *    checklist FAILS (spec scenario "A header claims implementation is
 *    complete"); the change name and the checkbox count appear in the output;
 *  - a header saying NOT STARTED over 0/X passes, including the real spatial
 *    atlas 0/123 shape;
 *  - a COMPLETE header over a fully-checked checklist passes;
 *  - a NOT STARTED header over checked tasks FAILS (claim must match the
 *    checklist in both directions);
 *  - an IN PROGRESS header over 0 completed tasks FAILS, and passes over a
 *    genuinely partial checklist;
 *  - an unrecognized status word FAILS (the grammar accepts only what it
 *    understands);
 *  - checkboxes inside fenced code blocks are not counted.
 *
 * Each assertion gets its own fixture root so scenarios never share state.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-change-status-honesty.mjs');

interface FixtureOptions {
  readonly banner?: string;
  readonly tasks: string;
}

/** One self-contained scenario: a tmp root holding exactly one change. */
function scenario(
  changeName: string,
  opts: FixtureOptions
): { run: () => { out: string; code: number } } {
  const root = mkdtempSync(join(tmpdir(), 'change-status-honesty-'));
  const dir = join(root, changeName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'proposal.md'),
    (opts.banner === undefined ? '' : `${opts.banner}\n\n`) + '# Proposal\n\n## Why\n\nBody.\n'
  );
  writeFileSync(join(dir, 'tasks.md'), `# Tasks\n\n${opts.tasks}\n`);
  const run = (): { out: string; code: number } => {
    try {
      const out = execFileSync(process.execPath, [SCRIPT, root], {
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return { out, code: 0 };
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; status?: number };
      return {
        out: `${e.stdout ?? ''}\n${e.stderr ?? ''}`,
        code: e.status ?? 1
      };
    }
  };
  const tracked = root;
  rmAfterAll(tracked);
  return { run };
}

/** Collect roots so vitest's afterAll (hoisted at module level) can sweep. */
const pending: string[] = [];
function rmAfterAll(root: string): void {
  pending.push(root);
}
afterAll(() => {
  for (const root of pending) rmSync(root, { recursive: true, force: true });
});

describe('check-change-status-honesty (task 2)', () => {
  it('FAILS when a zero-completed change claims implementation is complete (2.2)', () => {
    const s = scenario('claimed-complete-zero', {
      banner: '## Status\n\n**implementation status: COMPLETE** (all 9 sections landed).',
      tasks: '## Work\n\n- [ ] one\n- [ ] two\n- [ ] three\n'
    });
    const { out, code } = s.run();
    expect(code, out).toBe(1);
    expect(out).toContain('claimed-complete-zero');
    expect(out).toMatch(/0\/3/);
    expect(out).toMatch(/COMPLETE/);
  });

  it('passes the spatial-atlas shape: NOT STARTED header over 0/123 (after 1.1)', () => {
    const s = scenario('spatial-atlas-like', {
      banner:
        '> **implementation status: NOT STARTED**\n> OpenSpec planning-complete is not\n> implementation-complete. 0 completed tasks means not started.',
      tasks: Array.from({ length: 123 }, (_, i) => `- [ ] T${i + 1}`).join('\n')
    });
    const { out, code } = s.run();
    expect(code, out).toBe(0);
    expect(out).toContain('spatial-atlas-like  0/123');
    expect(out).toContain('derived=not-started');
  });

  it('passes a COMPLETE header over a fully-checked checklist', () => {
    const s = scenario('claimed-complete-done', {
      banner: '**implementation status: COMPLETE** (every section landed with evidence).',
      tasks: '## Work\n\n- [x] one\n- [x] two\n'
    });
    const { out, code } = s.run();
    expect(code, out).toBe(0);
    expect(out).toContain('claimed-complete-done  2/2  header=complete');
  });

  it('FAILS when a NOT STARTED header sits over checked tasks (2.2 reverse direction)', () => {
    const s = scenario('claimed-not-started', {
      banner: 'implementation status: NOT STARTED',
      tasks: '## Work\n\n- [x] one\n- [ ] two\n'
    });
    const { out, code } = s.run();
    expect(code, out).toBe(1);
    expect(out).toMatch(/NOT STARTED in[^]*1\/2 tasks are checked/);
  });

  it('FAILS an IN PROGRESS header over zero-completed tasks, passes over partial work', () => {
    const zero = scenario('claimed-inprogress-zero', {
      banner: 'implementation status: IN PROGRESS',
      tasks: '## Work\n\n- [ ] one\n- [ ] two\n'
    });
    expect(zero.run().code).toBe(1);
    const partial = scenario('claimed-inprogress-partial', {
      banner: 'implementation status: IN PROGRESS',
      tasks: '## Work\n\n- [x] one\n- [ ] two\n'
    });
    expect(partial.run().code).toBe(0);
  });

  it('FAILS an unrecognized status value instead of staying silent', () => {
    const s = scenario('unrecognized-status', {
      banner: 'implementation status: maybe-ish',
      tasks: '## Work\n\n- [ ] one\n'
    });
    const { out, code } = s.run();
    expect(code, out).toBe(1);
    expect(out).toMatch(/unrecognized implementation-status value/);
  });

  it('FAILS a header-less ZERO-COMPLETED change — the spec requires the header (review re-check)', () => {
    const s = scenario('zero-completed-no-banner', {
      tasks: '## Work\n\n- [ ] one\n- [ ] two\n- [ ] three\n'
    });
    const { out, code } = s.run();
    expect(code, out).toBe(1);
    expect(out).toMatch(/NO implementation-status header/);
    expect(out).toMatch(/0\/3/);
  });

  it('passes header-less IN PROGRESS and COMPLETE changes', () => {
    const partial = scenario('headerless-partial', {
      tasks: '## Work\n\n- [x] one\n- [ ] two\n'
    });
    const { out, code } = partial.run();
    expect(code, out).toBe(0);
    expect(out).toContain('headerless-partial  1/2  header=none  derived=in-progress  ok');
    const done = scenario('headerless-complete', {
      tasks: '## Work\n\n- [x] one\n- [x] two\n'
    });
    const doneOut = done.run();
    expect(doneOut.code, doneOut.out).toBe(0);
    expect(doneOut.out).toContain('headerless-complete  2/2  header=none  derived=complete  ok');
  });

  it('checks fenced code blocks out of the checkbox count', () => {
    const s = scenario('fenced-template', {
      banner: 'implementation status: NOT STARTED',
      tasks: '## Work\n\n- [ ] real one\n\n```\n- [x] not a task (template example)\n```\n'
    });
    const { out, code } = s.run();
    expect(code, out).toBe(0);
    expect(out).toContain('fenced-template  0/1');
  });
});
