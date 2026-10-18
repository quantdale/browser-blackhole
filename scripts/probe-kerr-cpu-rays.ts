/**
 * CPU-oracle probe for the Kerr magenta band (Phase 4).
 *
 * Phase 3 established that ~99.7% of magenta pixels are pole-passage failures.
 * This probe decides whether that gate is HONEST or OVER-CONSERVATIVE by
 * integrating the exact band rays in binary64:
 *
 *   - does the reference ALSO drive |sin theta| below the production gate?
 *   - how far does its escape direction move between poleFailureSin = 0.04 and
 *     poleFailureSin = 0.0 (i.e. how much would "just lowering the threshold"
 *     actually change the geodesic answer)?
 *   - are the conserved-quantity diagnostics (null residual, Carter drift)
 *     clean or degraded, which separates "gate refuses to guess" from "the
 *     integration is wrong"?
 *
 * Camera state is read with the SAME helper the established parity suite uses
 * (tests/browser/kerr-parity.spec.ts readCameraBasis) and rays are rebuilt with
 * the SAME shared camera-ray math (src/shaders/cameraRayMath.ts), so the CPU
 * rays are the GPU rays.
 *
 * Usage: npx tsx scripts/probe-kerr-cpu-rays.ts [--backend=webgpu] [--tier=high]
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

import {
  DEFAULT_KERR_PHOTON_OPTIONS,
  integrateKerrPhoton,
  type Vec3
} from '../src/phenomena/black-hole/kerr/reference.js';
import { makeCameraRayDirection } from '../src/shaders/cameraRayMath.js';

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const outDir = resolve(arg('out', 'artifacts/visual-fidelity-kerr-band/diagnostics'));
const backend = arg('backend', 'webgpu');
const tier = arg('tier', 'high');
const preset = arg('preset', 'kerr-high-prograde');
const port = Number(arg('port', '4304'));
mkdirSync(outDir, { recursive: true });

const BRAVE_PATH = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';

const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
})();

try {
  execSync('npm run build:e2e', { stdio: 'inherit' });
} catch (error) {
  console.error(`[probe] build failed: ${String(error)}`);
  process.exit(1);
}

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch({ executablePath: BRAVE_PATH, headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

async function waitForArrival(): Promise<void> {
  await page.locator('#scene').waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__ATLAS_APP__ !== undefined, { timeout: 30_000 });
  await page.waitForFunction(
    () => window.__ATLAS_APP__.host.state.atlas.transition.active === false,
    { timeout: 120_000 }
  );
  await page.waitForFunction(
    () => window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() !== null,
    { timeout: 120_000 }
  );
}

interface CameraBasis {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanHalfFovY: number;
  aspect: number;
}

function norm(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

async function readCameraBasis(): Promise<CameraBasis> {
  const raw = await page.evaluate(() => {
    const c = window.__ATLAS_APP__.host.camera;
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    return {
      position: { x: c.position.x, y: c.position.y, z: c.position.z },
      elements: Array.from(e),
      fovDeg: c.fov,
      aspect: c.aspect
    };
  });
  const row = (i: number): Vec3 => {
    const v: Vec3 = [raw.elements[i] ?? 0, raw.elements[i + 1] ?? 0, raw.elements[i + 2] ?? 0];
    const n = norm(v);
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const right = row(0);
  const up = row(4);
  const fwdRaw = row(8);
  return {
    position: [raw.position.x, raw.position.y, raw.position.z],
    right,
    up,
    forward: [-fwdRaw[0], -fwdRaw[1], -fwdRaw[2]],
    tanHalfFovY: Math.tan((raw.fovDeg * Math.PI) / 360),
    aspect: raw.aspect > 0 ? raw.aspect : 1
  };
}

await page.goto(`http://127.0.0.1:${port}/atlas/black-hole?preset=${preset}&backend=${backend}`);
await waitForArrival();
const pinned = await page.evaluate((tierName: string) => {
  const host = window.__ATLAS_APP__.host;
  host.governor.setForcedTier(tierName);
  host.setRenderScaleOverride(1);
  host.time.pause();
  host.time.scrubTo(0.5);
  host.post.setBloom(false, 0);
  host.post.setExposure(1);
  host.post.setToneMapping('linear');
  const rect = document.getElementById('viewport')?.getBoundingClientRect();
  if (rect) host.handleResize(rect.width, rect.height);
  const canvas = document.querySelector('canvas');
  const snap = host.activeDestinationDebugSnapshot();
  const inv = host.debugInventory();
  return {
    internal: canvas ? [canvas.width, canvas.height] : null,
    spin: Number((snap as { destination?: { spin?: number } } | null)?.destination?.spin ?? NaN),
    adapter: (inv as { backend?: { adapterName?: string } } | null)?.backend?.adapterName ?? null,
    effectiveTier: (inv as { governor?: { tier?: string } } | null)?.governor?.tier ?? null
  };
}, tier);
await page.waitForTimeout(9000);

const basis = await readCameraBasis();
const spin = Number.isFinite(pinned.spin) ? pinned.spin : 0.9;

// Escape/capture policy identical to the GPU pass's production settings.
const options = {
  ...DEFAULT_KERR_PHOTON_OPTIONS,
  aStar: spin,
  massRg: 1,
  escapeRadiusRg: 1000,
  captureEpsilon: 0.01
};

/** Sample rays on a grid across the frame, plus the polar-band columns. */
const aspect = basis.aspect;
const samples: Array<{ label: string; ndc: [number, number] }> = [];
// Vertical transects through the band above and below the shadow.
for (const x of [-0.06, -0.03, 0, 0.03, 0.06]) {
  for (const y of [0.42, 0.5, 0.58, 0.66, 0.74, 0.82]) {
    samples.push({ label: `polar-band x=${x} y=${y}`, ndc: [x, y] });
  }
}
// Controls: shadow centre, equatorial flank, far corner.
for (const [label, ndc] of [
  ['control-shadow-centre', [0, 0]],
  ['control-equator-left', [-0.55, 0.0]],
  ['control-corner', [0.85, 0.85]]
] as Array<[string, [number, number]]>) {
  samples.push({ label, ndc });
}

interface RayRow {
  label: string;
  ndc: [number, number];
  dir: Vec3;
  gate040: {
    classification: string;
    reason: string | null;
    steps: number;
    minSinTheta: number;
    nullResidualMax: number;
    carterDrift: number;
    turnsAngular: number;
    finalDir: Vec3 | null;
  };
  gate000: {
    classification: string;
    steps: number;
    minSinTheta: number;
    nullResidualMax: number;
    carterDrift: number;
    finalDir: Vec3 | null;
  };
  directionShiftDeg: number | null;
}

function terminalDir(row: { finalDirection: Vec3 | null }): Vec3 | null {
  return row.finalDirection;
}

function angleBetweenDeg(a: Vec3 | null, b: Vec3 | null): number | null {
  if (a === null || b === null) return null;
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return null;
  const dot = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (na * nb);
  return +((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI).toFixed(3);
}

const rows: RayRow[] = [];
for (const sample of samples) {
  const dir = makeCameraRayDirection(sample.ndc[0], sample.ndc[1], basis).direction;
  // integrateKerrPhoton takes (worldPosition, worldDirection, options) and builds
  // its own initial data — it does NOT accept a KerrRayInit. (Passing init here
  // was the harness bug that produced "non-finite input component 0" on every
  // row, including controls; the parity suite calls it the same way we now do.)
  // Production gate.
  const atProd = integrateKerrPhoton(basis.position, dir, { ...options, poleFailureSin: 0.04 });
  // Diagnostic-only: gate disabled, to measure what the gate is suppressing.
  const atZero = integrateKerrPhoton(basis.position, dir, { ...options, poleFailureSin: 0 });
  rows.push({
    label: sample.label,
    ndc: sample.ndc,
    dir,
    gate040: {
      classification: atProd.classification,
      reason:
        atProd.outcome.kind === 'escaped' ? null : (atProd.outcome.detail ?? atProd.outcome.kind),
      steps: atProd.steps,
      minSinTheta: +atProd.minSinTheta.toExponential(4),
      nullResidualMax: +atProd.conserved.nullResidualMax.toExponential(3),
      carterDrift: +atProd.conserved.carterDrift.toExponential(3),
      turnsAngular: atProd.turnCounts.angular,
      finalDir: terminalDir(atProd)
    },
    gate000: {
      classification: atZero.classification,
      steps: atZero.steps,
      minSinTheta: +atZero.minSinTheta.toExponential(4),
      nullResidualMax: +atZero.conserved.nullResidualMax.toExponential(3),
      carterDrift: +atZero.conserved.carterDrift.toExponential(3),
      finalDir: terminalDir(atZero)
    },
    directionShiftDeg: angleBetweenDeg(terminalDir(atProd), terminalDir(atZero))
  });
}

const summary = {
  commit,
  backend,
  tier: pinned.effectiveTier,
  adapter: pinned.adapter,
  internal: pinned.internal,
  preset,
  spin,
  aspect,
  escapeRadiusRg: options.escapeRadiusRg,
  cameraPosition: basis.position,
  rows
};

writeFileSync(join(outDir, 'cpu-probe-rays.json'), JSON.stringify(summary, null, 2));
console.log('[probe] rows:');
for (const r of rows) {
  console.log(
    `  ${r.label.padEnd(26)} prod=${r.gate040.classification.padEnd(18)} ` +
      `min|sin|=${r.gate040.minSinTheta} steps=${r.gate040.steps} ` +
      `null=${r.gate040.nullResidualMax} carter=${r.gate040.carterDrift} ` +
      `dDir=${r.directionShiftDeg}`
  );
}

await browser.close();
server.httpServer.close();
process.exit(0);
