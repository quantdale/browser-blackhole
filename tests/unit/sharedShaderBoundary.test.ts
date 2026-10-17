/**
 * Shared-shader / legacy-state boundary check (hosted-product-boot-coverage
 * 1.3 + review re-check).
 *
 * Black-box: the real `scripts/check-shared-shader-boundary.mjs` runs against
 * fixture `src` trees and its exit code / findings are asserted —
 *
 *  - a shader that imports the legacy state module DIRECTLY fails (and the
 *    failure names the shader file);
 *  - a shader whose NEUTRAL MODULE re-imports the legacy state module also
 *    fails (the spec's violation is transitive through the shader import
 *    graph, not a directory-name scan);
 *  - the LEGACY SHELL's own renderer file may import the state module — the
 *    check passes even when a seed reaches that file's graph;
 *  - the real repository tree is clean (5 shader seeds, no app/state import).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-shared-shader-boundary.mjs');

interface TreeSpec {
  readonly shaders: Record<string, string>;
  readonly renderer?: Record<string, string>;
  readonly app?: Record<string, string>;
}

function buildTree(spec: TreeSpec): string {
  const root = mkdtempSync(join(tmpdir(), 'shader-boundary-'));
  const src = join(root, 'src');
  for (const [rel, body] of Object.entries(spec.shaders)) {
    mkdirSync(join(src, 'shaders', rel, '..'), { recursive: true });
    writeFileSync(join(src, 'shaders', rel), body);
  }
  for (const [rel, body] of Object.entries(spec.renderer ?? {})) {
    mkdirSync(join(src, 'renderer', rel, '..'), { recursive: true });
    writeFileSync(join(src, 'renderer', rel), body);
  }
  for (const [rel, body] of Object.entries(spec.app ?? {})) {
    mkdirSync(join(src, 'app', rel, '..'), { recursive: true });
    writeFileSync(join(src, 'app', rel), body);
  }
  const pending = root;
  rmAfterAll(pending);
  return join(src);
}

const pending: string[] = [];
function rmAfterAll(root: string): void {
  pending.push(root);
}
afterAll(() => {
  for (const root of pending) rmSync(root, { recursive: true, force: true });
});

function run(srcRoot: string): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, srcRoot], {
      encoding: 'utf8',
      stdio: 'pipe'
    });
    return { out, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ''}\n${e.stderr ?? ''}`, code: e.status ?? 1 };
  }
}

describe('check-shared-shader-boundary (task 1.3 + review re-check)', () => {
  it('FAILS when a shader imports the legacy state module directly', () => {
    const src = buildTree({
      shaders: {
        'pass.ts': "import type { DebugViewMode } from '../app/state.js';\nexport const x = 1;\n"
      },
      app: { 'state.ts': "export type DebugViewMode = 'off';\n" }
    });
    const { out, code } = run(src);
    expect(code, out).toBe(1);
    expect(out).toMatch(/pass\.ts:1/);
    expect(out).toMatch(/legacy application state module/);
  });

  it('FAILS transitively through a neutral module the shader imports', () => {
    const src = buildTree({
      shaders: {
        'pass.ts':
          "import type { DebugViewMode } from '../renderer/shared/viewModeProp.js';\nexport const x = 1;\n"
      },
      renderer: {
        'shared/viewModeProp.ts':
          "import type { DebugViewMode } from '../../app/state.js';\nexport type P = DebugViewMode;\n"
      },
      app: { 'state.ts': "export type DebugViewMode = 'off';\n" }
    });
    const { out, code } = run(src);
    expect(code, out).toBe(1);
    expect(out).toMatch(/viewModeProp\.ts:1/);
    expect(out).toMatch(/import graph/);
  });

  it('does not fail for the legacy shell even when the graph reaches its file', () => {
    const src = buildTree({
      shaders: {
        'pass.ts':
          "import type { Coord } from '../renderer/RenderCoordinator.js';\nexport const x = 1;\n"
      },
      renderer: {
        'RenderCoordinator.ts':
          "import type { DebugViewMode } from '../app/state.js';\nexport type Coord = 1;\n"
      },
      app: { 'state.ts': "export type DebugViewMode = 'off';\n" }
    });
    const { out, code } = run(src);
    expect(code, out).toBe(0);
    expect(out).toMatch(/scanned \d+ module/);
    expect(out).toMatch(/ok \(no module in the shader import graph imports app\/state\)/);
  });

  it('passes on the real repository tree', () => {
    const { out, code } = run(join(REPO_ROOT, 'src'));
    expect(code, out).toBe(0);
    expect(out).toMatch(/scanned \d+ module\(s\)/);
    expect(out).toMatch(/2 legacy-shell file\(s\) exempt/);
  });
});
