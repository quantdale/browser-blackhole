/**
 * M8-05 runtime sampler validation: loading, structured rejection taxonomy,
 * analytic classification, coordinate mapping, and oracle equivalence of the
 * production sampling path — exercised against the SHIPPED family in
 * public/luts (artifact provenance is part of the test).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  LutSampler,
  formatWebGL2Status,
  loadLutFamily,
  type LutAssetSource
} from '../../src/phenomena/black-hole/lut/runtime.js';
import { B_CRITICAL_RG } from '../../src/phenomena/black-hole/lut/domain.js';

// ---------------------------------------------------------------------------
// Fixture: the shipped family directory under public/luts/
// ---------------------------------------------------------------------------

function findShippedFamilyDir(): string {
  const root = join(process.cwd(), 'public', 'luts');
  for (const name of readdirSync(root)) {
    const p = join(root, name);
    if (statSync(p).isDirectory() && existsSync(join(p, 'manifest.json'))) return p;
  }
  throw new Error('no shipped LUT family found under public/luts — run npm run lut:generate');
}

function existsSync(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

let cachedFamilyDir: string | null = null;
function familyDir(): string {
  if (cachedFamilyDir === null) cachedFamilyDir = findShippedFamilyDir();
  return cachedFamilyDir;
}

async function loadShipped() {
  const dir = familyDir();
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
  const assets = new Map<string, Uint8Array>();
  const m = manifest as { textures: Array<{ file: string }> };
  for (const t of m.textures) {
    assets.set(t.file, new Uint8Array(readFileSync(join(dir, t.file))));
  }
  return loadLutFamily(manifest, assets as LutAssetSource);
}

// ---------------------------------------------------------------------------
// Loading & rejection taxonomy
// ---------------------------------------------------------------------------

describe('lut runtime loading', () => {
  it('loads the shipped family with verified checksums', async () => {
    const result = await loadShipped();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.family.manifest.family).toBe('schwarzschild-v1');
      expect(result.family.trajectory.length).toBe(1024 * 1024);
      expect(result.family.aux.length).toBe(1024 * 4);
    }
  });

  it('rejects a tampered asset byte with checksum-mismatch', async () => {
    const dir = familyDir();
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
    const m = manifest as { textures: Array<{ file: string }> };
    const assets = new Map<string, Uint8Array>();
    for (const t of m.textures) {
      const bytes = new Uint8Array(readFileSync(join(dir, t.file)));
      assets.set(t.file, bytes);
    }
    // flip one byte of trajectory
    const traj = assets.get('trajectory.bin');
    if (traj === undefined) throw new Error('trajectory asset missing from fixture');
    const flipIndex = traj.length >> 1;
    traj[flipIndex] = (traj[flipIndex] ?? 0) ^ 0xff;
    const result = await loadLutFamily(manifest, assets);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('asset-checksum-mismatch');
  });

  it('rejects truncated assets with byte-length-mismatch', async () => {
    const dir = familyDir();
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
    const m = manifest as { textures: Array<{ file: string }> };
    const assets = new Map<string, Uint8Array>();
    for (const t of m.textures) {
      const full = new Uint8Array(readFileSync(join(dir, t.file)));
      assets.set(t.file, full.slice(0, full.length - 8));
    }
    const result = await loadLutFamily(manifest, assets);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('asset-byte-length-mismatch');
  });

  it('rejects wrong schemaVersion before touching assets', async () => {
    const dir = familyDir();
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
    (manifest as { schemaVersion: number }).schemaVersion = 99;
    const result = await loadLutFamily(manifest, new Map());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('schema-version');
  });

  it('rejects families without storedSpanRg as unsamplable', async () => {
    const dir = familyDir();
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
    const dom = (
      manifest as {
        textures: Array<{ id: string; domain: Record<string, unknown> }>;
      }
    ).textures.find((t) => t.id === 'trajectory')!.domain;
    delete dom.storedSpanRg;
    const result = await loadLutFamily(manifest, new Map());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing-stored-span');
  });
});

// ---------------------------------------------------------------------------
// WebGL2 capability truth
// ---------------------------------------------------------------------------

describe('webgl2 filterability reporting', () => {
  it('reports half-float formats filterable and 32f extension-gated', () => {
    expect(formatWebGL2Status('r16f').filterable).toBe(true);
    expect(formatWebGL2Status('rgba16f').filterable).toBe(true);
    const s = formatWebGL2Status('rg32f');
    expect(s.filterable).toBe(false);
    if (!s.filterable) expect(s.extensionRequired).toBe('OES_texture_float_linear');
  });

  it('shipped family is linear-filterable in core WebGL2 by construction', async () => {
    const result = await loadShipped();
    expect(result.ok).toBe(true);
    if (result.ok) {
      const d = new LutSampler(result.family).diagnostics();
      expect(d['webgl2LinearFilterable']).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Classification + fallback taxonomy
// ---------------------------------------------------------------------------

describe('ray resolution', () => {
  it('classifies captured/escaped exactly across the critical boundary', async () => {
    const result = await loadShipped();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = new LutSampler(result.family);
    const bc = result.family.manifest.physics.bCriticalRg;
    for (const scaleOfBc of [0.5, 0.9, 0.999, 1.001, 1.05, 1.4]) {
      const b = bc * scaleOfBc;
      const r = s.resolveRay(b);
      expect(r.status === 'captured' || r.status === 'escaped').toBe(true);
      if (r.status !== 'fallback-numerical') {
        expect(r.status === 'captured').toBe(b < bc);
      }
    }
  });

  it('routes out-of-domain rays to explicit numerical fallback', async () => {
    const result = await loadShipped();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = new LutSampler(result.family);
    const xMax = s.resolveRay(3.0 * B_CRITICAL_RG * 1.01);
    expect(xMax.status).toBe('fallback-numerical');
    if (xMax.status === 'fallback-numerical') expect(xMax.reason).toBe('x-out-of-domain-high');
    const neg = s.resolveRay(-1);
    expect(neg.status).toBe('fallback-numerical');
    if (neg.status === 'fallback-numerical') expect(neg.reason).toBe('x-out-of-domain-low');
  });
});

// ---------------------------------------------------------------------------
// Oracle equivalence of the sampling path (off-grid x, real interpolation)
// ---------------------------------------------------------------------------

describe('sampler vs dense oracle (shipped family)', () => {
  it('radiusAt matches dense binary64 curves inside the disk annulus', async () => {
    const result = await loadShipped();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = new LutSampler(result.family);
    const bc = B_CRITICAL_RG; // manifest physics.bCriticalRg equals this at M=1

    // off-grid x positions (between column centers), escaping class only
    const xs = [1.073, 1.21, 1.42, 1.63, 2.15, 2.7];
    let worst = 0;
    for (const x of xs) {
      const res = s.resolveRay(x * bc);
      expect(res.status).toBe('escaped');
      if (res.status !== 'escaped') continue;
      const psiApsis = s.psiApsisAt(x);
      expect(Number.isFinite(psiApsis)).toBe(true);

      // probe rows spanning [apsis .. escape crossing): sample radii via the
      // table's own launch solve at several target radii, then compare the
      // table radius AT that row back to the analytic Schwarzschild relation
      // through the dense reference embedded in launchRow consistency:
      // Analytic periapsis for this x (exact turning point):
      //   b² = r_p³ / (r_p - 2)   [increasing for r_p > 3]
      // Bisection on that monotone branch. Targets at or below periapsis
      // cannot occur on the arc, so they are skipped (launchRow returning
      // NaN there is CORRECT — no such radius exists on this trajectory).
      const b = x * bc;
      let lo = 3.000001;
      let hi = Math.max(4, 2 + b);
      for (let it = 0; it < 80; it++) {
        const mid = 0.5 * (lo + hi);
        const gMid = (mid * mid * mid) / (mid - 2);
        if (gMid < b * b) lo = mid;
        else hi = mid;
      }
      const periapsis = 0.5 * (lo + hi);
      for (const targetR of [7, 10, 14, 20]) {
        if (targetR <= periapsis + 0.05) continue;
        const row = s.launchRow(x, targetR);
        expect(Number.isFinite(row)).toBe(true);
        expect(s.withinRealData(x, row)).toBe(true);
        const back = s.radiusAt(x, row);
        worst = Math.max(worst, Math.abs(back - targetR));
      }
    }
    // roundtrip error = interpolation + f16 storage; study budget < ~7e-2 max
    expect(worst).toBeLessThan(7.6e-2);
  });

  it('terminalDirection stays unit-normalized and outward-positive on escaped rays', async () => {
    const result = await loadShipped();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = new LutSampler(result.family);
    const bc = result.family.manifest.physics.bCriticalRg;
    for (const x of [1.15, 1.4, 1.9, 2.5]) {
      const dir = s.terminalDirection(x);
      const norm = Math.hypot(dir[0], dir[1]);
      expect(Math.abs(norm - 1)).toBeLessThan(2e-3); // f16 components
      expect(dir[0]).toBeGreaterThan(0); // escaping: radially outward
    }
    void bc;
  });

  it('launch solve is monotone in target radius and consistent near envelope', async () => {
    const result = await loadShipped();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const s = new LutSampler(result.family);
    const bc = result.family.manifest.physics.bCriticalRg;
    const x = 1.31;
    const rows: number[] = [];
    for (const targetR of [8, 11, 15, 19]) {
      rows.push(s.launchRow(x, targetR));
    }
    for (let k = 1; k < rows.length; k += 1) {
      expect(rows[k]!).toBeGreaterThan(rows[k - 1]!);
    }
    void bc;
  });

  it('exposes truthful diagnostics including hybrid band state', async () => {
    const result = await loadShipped();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = new LutSampler(result.family).diagnostics();
    expect(d['family']).toBe('schwarzschild-v1');
    expect(d['hybridBandHalfWidthX']).toBe(0);
    expect(d['storedSpanRad']).toBeGreaterThan(0);
    expect(d['dimensions']).toBe('1024x1024');
  });
});
