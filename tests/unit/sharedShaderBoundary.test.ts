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

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createTempRootTracker, runScript } from './support/scriptFixtures.js';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCRIPT = join(REPO_ROOT, 'scripts', 'check-shared-shader-boundary.mjs');

interface TreeSpec {
  readonly shaders: Record<string, string>;
  readonly renderer?: Record<string, string>;
  readonly app?: Record<string, string>;
}

const tempRoots = createTempRootTracker();
afterAll(() => tempRoots.cleanup());

function buildTree(spec: TreeSpec): string {
  const root = mkdtempSync(join(tmpdir(), 'shader-boundary-'));
  tempRoots.track(root);
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
  return join(src);
}

function run(srcRoot: string): { out: string; code: number } {
  return runScript(SCRIPT, [srcRoot]);
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

  it('FAILS for a GPU module OUTSIDE src/shaders that imports legacy state (review re-check)', () => {
    const src = buildTree({
      shaders: {
        'pass.ts': 'export const x = 1;\n'
      },
      renderer: {
        'shared/lensingGpu.ts':
          "import { ShaderNode } from 'three/webgpu';\n" +
          "import type { DebugViewMode } from '../../app/state.js';\n" +
          'export type L = DebugViewMode | ShaderNode;\n'
      },
      app: { 'state.ts': "export type DebugViewMode = 'off';\n" }
    });
    const { out, code } = run(src);
    expect(code, out).toBe(1);
    expect(out).toMatch(/lensingGpu\.ts:2/);
    expect(out).toMatch(/legacy application state module/);
  });

  it('passes on the real repository tree with a non-vacuous seed floor', () => {
    const { out, code } = run(join(REPO_ROOT, 'src'));
    expect(code, out).toBe(0);
    const scanned = /scanned (\d+) module\(s\)/.exec(out);
    const seeds = /\((\d+) seed\(s\)/.exec(out);
    expect(scanned, out).not.toBeNull();
    expect(seeds, out).not.toBeNull();
    // Non-vacuity: the suite must keep covering the 5 shader-dir modules plus
    // the three/webgpu (TSL) modules outside it; an emptied seed set must fail.
    expect(Number(seeds![1]), out).toBeGreaterThanOrEqual(5);
    expect(Number(scanned![1]), out).toBeGreaterThanOrEqual(Number(seeds![1]));
    expect(out).toMatch(/2 legacy-shell file\(s\) exempt/);
  });
});
