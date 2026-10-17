/**
 * MCP preflight tests (operations-and-deployment-readiness 6.3/6.4/O-08).
 *
 * Black-box: the real `scripts/mcp-preflight.mjs` runs against fixture
 * configs and its findings are asserted —
 *
 * 6.3 — a string value containing a comment-like sequence (`// ...`) must
 *       survive the JSON-with-comments stripper intact (the old blind regex
 *       truncated it and produced a spurious parse error);
 * 6.4 — a tilde VERSION range (`~1.2.3`) must pass the global-path rule,
 *       while a genuine home-directory reference (`~/data`) must fail.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'mcp-preflight.mjs');

let workDir: string;

function runPreflight(configBody: string): { out: string; code: number } {
  const file = join(workDir, 'mcp.json');
  writeFileSync(file, configBody, 'utf8');
  // The findings go to stderr (console.error) — capture BOTH streams.
  try {
    const out = execFileSync(process.execPath, [SCRIPT, '--config', file], {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return { out, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return {
      out: `${e.stdout ?? ''}
${e.stderr ?? ''}`,
      code: e.status ?? 1
    };
  }
}

beforeAll(() => {
  workDir = mkdtempSync(join(tmpdir(), 'mcp-preflight-test-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('mcp-preflight (O-08)', () => {
  it('a comment-like sequence inside a string value survives parsing (6.3)', () => {
    const { out, code } = runPreflight(
      JSON.stringify({
        mcpServers: {
          example: {
            command: ['npx', '-y', 'pkg@1.2.3'],
            env: { NOTE: 'ratio 3 // 4 stays inside the string' }
          }
        }
      })
    );
    // The regression: the old blind comment-stripper truncated the value at
    // `//`, producing a JSON parse error and a spurious FAIL.
    expect(out, 'the comment-like value must not truncate the document').not.toContain(
      'JSON parse error'
    );
    expect(code, 'the document must pass with its strings intact').toBe(0);
  });

  it('a tilde version range passes while a home-directory reference fails (6.4)', () => {
    const passing = runPreflight(
      JSON.stringify({
        mcpServers: {
          ranged: { command: ['npx', 'pkg@~1.2.3'], env: { RANGE: '~1.2.3' } }
        }
      })
    );
    expect(passing.out, 'a tilde VERSION range is not a home path').not.toContain('home directory');
    expect(passing.out).not.toContain('FAIL');

    const failing = runPreflight(
      JSON.stringify({
        mcpServers: {
          homeref: { command: ['npx', 'pkg@1.2.3'], env: { DATA: '~/data' } }
        }
      })
    );
    expect(failing.out, 'a genuine home reference must be flagged').toContain(
      'references home directory'
    );
    expect(failing.code).not.toBe(0);
  });

  it('a bare home reference is flagged too', () => {
    const { out } = runPreflight(
      JSON.stringify({
        mcpServers: { bare: { command: ['npx', 'pkg@1.2.3'], env: { ROOT: '~' } } }
      })
    );
    expect(out).toContain('references home directory');
  });
});
