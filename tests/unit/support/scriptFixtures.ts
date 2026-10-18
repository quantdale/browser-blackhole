/**
 * Shared fixture utilities for the black-box script tests
 * (changeStatusHonesty.test.ts, sharedShaderBoundary.test.ts).
 *
 * Both suites build throwaway directory trees, run a repository script
 * against them with `process.execPath`, and assert on exit code + output.
 * This module owns that duplicated shape once: temp-root tracking (cleaned up
 * by the calling suite's afterAll) and the spawn-with-status helper.
 */

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

export interface ScriptRun {
  readonly out: string;
  readonly code: number;
}

/** Runs a repository script and normalizes non-zero exits into a result. */
export function runScript(scriptPath: string, args: readonly string[]): ScriptRun {
  try {
    const out = execFileSync(process.execPath, [scriptPath, ...args], {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return { out, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ''}\n${e.stderr ?? ''}`, code: e.status ?? 1 };
  }
}

/** Tracks temp roots so the calling suite can sweep them in afterAll. */
export function createTempRootTracker(): {
  track: (root: string) => void;
  cleanup: () => void;
} {
  const roots: string[] = [];
  return {
    track(root: string): void {
      roots.push(root);
    },
    cleanup(): void {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    }
  };
}
