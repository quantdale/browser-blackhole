import { expect, test, type Page } from '@playwright/test';
import {
  analyticLimbImpactParameter,
  traceSurfaceRay
} from '../../src/phenomena/neutron-star/surfaceRayReference.js';
// Canonical __ATLAS_APP__ window typing (loads the single global augmentation).
import './support/atlasHook.js';
import {
  ARRIVAL_TIMEOUT_MS,
  collectErrors,
  expectPresentedMotion,
  measurePresentedMotion,
  sampleColorsAtNdc,
  type NdcPoint
} from './support/appHarness.js';

/**
 * M12-NS dedicated neutron-star destination suite.
 *
 * Coverage map to openspec/changes/m12-neutron-star-surface-lensing/tasks.md:
 * - §5.2 direct route boot + all production presets reach stable finite state;
 * - §5.3 pause/scrub determinism for the rotating destination;
 * - §5.4 surface-ray debug/probe availability in-browser (?nssurfacedebug=1);
 * - §5.5 preset switching / repeated leave+re-enter without errors;
 * - §5.6 resize + forced quality-tier changes keep sizing/ray state valid;
 * - §5.7 no uncaught page/console errors on representative flows;
 * - §4.2/§4.3/§4.4 CPU/GPU surface-ray parity corpus (WebGPU + WebGL2):
 *   classification agreement plus hit-normal/escape-direction comparison
 *   against the binary64 reference with failure diagnostics on mismatch;
 * - WebGL2 fallback runs the SAME direct path truthfully (§4.5).
 */

/** Canonical 'surface' preset model: 1.4 Msun, R = 12 km, camera at 42 km. */
const PRESET_MASS_SOLAR = 1.4;
const RG_KM_PER_SOLAR_MASS = 1.476625;
const PRESET_RADIUS_KM = 12;

const BENIGN_ERROR = /powerPreference|readback|Failed to load resource|favicon|webgpu.*backend/i;

interface CameraBasis {
  position: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  forward: [number, number, number];
  tanHalfFovY: number;
  aspect: number;
}

type Vec3 = [number, number, number];

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function normalize3(v: Vec3): Vec3 {
  const n = norm(v);
  return [v[0] / n, v[1] / n, v[2] / n];
}

function decodeSrgbChannel(byte: number): number {
  const c = byte / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Structural superset of AtlasHook covering the host members this suite drives. */
interface HostControlSurface {
  governor: { setForcedTier(tier: 'low' | 'medium' | 'high' | 'ultra'): void };
  time: { pause(): void; scrubTo(phase01: number): void };
  post: {
    setBloom(enabled: boolean, strength: number): void;
    setExposure(value: number): void;
    setToneMapping(mode: string): void;
  };
  handleResize(cssWidth: number, cssHeight: number): void;
}

async function waitForArrival(page: Page, destId: string, presetId?: string): Promise<void> {
  await expect(
    page.locator('#scene'),
    'served page has no #scene — foreign server on the e2e port?'
  ).toBeAttached({ timeout: 10_000 });
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const app = window.__ATLAS_APP__;
          if (!app) return 'no-app';
          if (app.host.state.atlas.transition.active) return 'transitioning';
          return app.host.state.atlas.activeDestination === undefined ? 'waiting' : 'arrived';
        }),
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [250] }
    )
    .toBe('arrived');
  await expect
    .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activeDestination))
    .toBe(destId);
  if (presetId !== undefined) {
    await expect
      .poll(() =>
        page.evaluate(() => window.__ATLAS_APP__!.host.state.atlas.activePreset || 'default')
      )
      .toBe(presetId);
  }
}

async function readDebugSnapshot(page: Page): Promise<Record<string, unknown>> {
  const raw: unknown = await page.evaluate(() =>
    window.__ATLAS_APP__!.host.activeDestinationDebugSnapshot()
  );
  expect(raw, 'active destination debug snapshot must exist').toBeTruthy();
  return raw as Record<string, unknown>;
}

async function waitForCameraSettled(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const a = await page.evaluate(() => ({
          ...window.__ATLAS_APP__!.host.camera.position
        }));
        await page.waitForTimeout(250);
        const b = await page.evaluate(() => ({
          ...window.__ATLAS_APP__!.host.camera.position
        }));
        return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      },
      { timeout: ARRIVAL_TIMEOUT_MS, intervals: [500] }
    )
    .toBeLessThan(1e-4);
}

async function readCameraBasis(page: Page): Promise<CameraBasis> {
  const raw = await page.evaluate(() => {
    const c = window.__ATLAS_APP__!.host.camera;
    c.updateMatrixWorld();
    const e = c.matrixWorld.elements;
    return {
      position: { x: c.position.x, y: c.position.y, z: c.position.z },
      elements: Array.from(e),
      fovDeg: c.fov,
      aspect: c.aspect
    };
  });
  // Identical construction to the module's render() mapping: basis rows of
  // matrixWorld; forward = negated third row.
  const normalizeRow = (i: number): Vec3 => {
    const v: Vec3 = [raw.elements[i] ?? 0, raw.elements[i + 1] ?? 0, raw.elements[i + 2] ?? 0];
    const n = norm(v);
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const right = normalizeRow(0);
  const up = normalizeRow(4);
  const fwdRaw = normalizeRow(8);
  const forward: Vec3 = [-fwdRaw[0], -fwdRaw[1], -fwdRaw[2]];
  return {
    position: [raw.position.x, raw.position.y, raw.position.z],
    right,
    up,
    forward,
    tanHalfFovY: Math.tan((raw.fovDeg * Math.PI) / 360),
    aspect: raw.aspect > 0 ? raw.aspect : 1
  };
}

function assertFiniteSnapshotFields(snap: Record<string, unknown>, label: string): void {
  expect(snap['surfaceRayBackend'], `${label}: direct backend recorded`).toBe(
    'direct-schwarzschild-material-surface'
  );
  expect(snap['surfaceLensingWired'], `${label}: pass wired`).toBe(true);
  const radiusRg = snap['surfaceRadiusRg'] as number;
  expect(radiusRg, `${label}: surface outside horizon`).toBeGreaterThan(2.001);
  const redshift = snap['surfaceRedshiftFactor'] as number;
  expect(redshift, `${label}: redshift in (0, 1)`).toBeGreaterThan(0);
  expect(redshift).toBeLessThan(1);
  const pulse = snap['pulseVisibilitySlot0'] as number;
  expect(Number.isFinite(pulse), `${label}: pulse visibility finite`).toBe(true);
  const spinPhaseRad = snap['spinPhaseRad'] as number;
  expect(Number.isFinite(spinPhaseRad), `${label}: spin phase finite`).toBe(true);
}

test.describe('neutron-star destination behavior', () => {
  test('direct route boots every production preset into stable finite state', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    for (const preset of ['surface', 'pulsar', 'magnetar']) {
      await page.goto(`/atlas/neutron-star?preset=${preset}`);
      await waitForArrival(page, 'neutron-star', preset);
      const snap = await readDebugSnapshot(page);
      assertFiniteSnapshotFields(snap, preset);
      expect(snap['hotSpotCount'], `${preset}: hot spots normalized`).toBeGreaterThan(0);
    }
    const realErrors = [...consoleErrors.filter((t) => !BENIGN_ERROR.test(t)), ...pageErrors];
    expect(realErrors).toEqual([]);
  });

  test('pause freezes rotation deterministically; scrub reseeds phase 0 entry', async ({
    page
  }) => {
    await page.goto('/atlas/neutron-star?preset=pulsar');
    await waitForArrival(page, 'neutron-star', 'pulsar');
    await page.evaluate(() => window.__ATLAS_APP__!.host.time.pause());
    const a = (await readDebugSnapshot(page))['spinPhaseRad'];
    await page.waitForTimeout(600);
    const b = (await readDebugSnapshot(page))['spinPhaseRad'];
    expect(b, 'paused rotation must not advance').toBe(a);

    // Deterministic frozen entry: boot paused via the golden-harness ordering
    // (pause BEFORE navigation), the destination must enter at phase 0.
    await page.goto('/atlas/black-hole');
    await waitForArrival(page, 'black-hole');
    await page.evaluate(() => {
      const host = window.__ATLAS_APP__!.host as unknown as HostControlSurface;
      host.time.pause();
      host.time.scrubTo(0);
    });
    await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star', 'pulsar'));
    await waitForArrival(page, 'neutron-star', 'pulsar');
    const frozenPhase = (await readDebugSnapshot(page))['spinPhaseRad'] as number;
    expect(frozenPhase, 'paused navigation enters at seeded phase 0').toBeCloseTo(0, 6);
  });

  test('surface-ray debug view reports valid hit and escape probes', async ({ page }) => {
    await page.goto('/atlas/neutron-star?preset=surface&nssurfacedebug=1');
    await waitForArrival(page, 'neutron-star');
    const snap = await readDebugSnapshot(page);
    expect(snap['surfaceDebugViewActive'], 'debug override honored').toBe(true);
    await page.evaluate(() => {
      const post = (window.__ATLAS_APP__!.host as unknown as HostControlSurface).post;
      post.setBloom(false, 0);
      post.setExposure(1);
      post.setToneMapping('linear');
    });
    await waitForCameraSettled(page);
    // Center pixel = radial hit -> decodes to a unit vector (the surface
    // normal); a far corner = escape -> also unit (terminal direction) but a
    // DIFFERENT one. Failures would decode near zero or present magenta.
    const samples = await sampleColorsAtNdc(page, [
      { x: 0, y: 0 },
      { x: -0.9, y: 0.9 }
    ]);
    const decodedAt = (s: { r: number; g: number; b: number }): Vec3 => [
      decodeSrgbChannel(s.r) * 2 - 1,
      decodeSrgbChannel(s.g) * 2 - 1,
      decodeSrgbChannel(s.b) * 2 - 1
    ];
    const center = decodedAt(samples[0]!);
    expect(norm(center), 'center probe decodes to a unit hit normal').toBeGreaterThan(0.85);
    const corner = decodedAt(samples[1]!);
    expect(norm(corner), 'corner probe decodes to a unit escape direction').toBeGreaterThan(0.85);
    const magentaish = samples.filter((s) => {
      // Exact failure-color detector: NUMERICAL_FAILURE_RGB = (0.08,0,0.08)
      // linear -> ~sRGB(80,0,80). Legitimate probe encodings cannot match.
      return s.r > 60 && s.g <= 16 && Math.abs(s.b - s.r) <= 12;
    }).length;
    expect(magentaish, 'no failure-colored probes expected').toBe(0);
  });

  test('preset switching and repeated leave/re-enter cycles stay error-free', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/atlas/neutron-star?preset=surface');
    await waitForArrival(page, 'neutron-star', 'surface');
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const preset of ['pulsar', 'magnetar', 'surface'] as const) {
        await page.evaluate((p) => window.__ATLAS_APP__!.navigate('neutron-star', p), preset);
        await waitForArrival(page, 'neutron-star', preset);
        const snap = await readDebugSnapshot(page);
        assertFiniteSnapshotFields(snap, `cycle${cycle}/${preset}`);
      }
      // Leave to another destination and re-enter (shared kernel handoff).
      await page.evaluate(() => window.__ATLAS_APP__!.navigate('black-hole'));
      await waitForArrival(page, 'black-hole');
      await page.evaluate(() => window.__ATLAS_APP__!.navigate('neutron-star'));
      await waitForArrival(page, 'neutron-star', 'surface');
    }
    const realErrors = [...consoleErrors.filter((t) => !BENIGN_ERROR.test(t)), ...pageErrors];
    expect(realErrors).toEqual([]);
  });

  test('resize and forced quality-tier changes keep sizing and ray state valid', async ({
    page
  }) => {
    await page.goto('/atlas/neutron-star?preset=surface');
    await waitForArrival(page, 'neutron-star');
    for (const tier of ['low', 'ultra', 'medium'] as const) {
      await page.evaluate((t) => {
        const host = window.__ATLAS_APP__!.host as unknown as HostControlSurface;
        host.governor.setForcedTier(t);
        const box = document.querySelector('#viewport')?.getBoundingClientRect();
        if (box && box.width > 0) host.handleResize(box.width, box.height);
      }, tier);
      await page.waitForTimeout(400);
      const snap = await readDebugSnapshot(page);
      assertFiniteSnapshotFields(snap, `tier ${tier}`);
    }
    // Portrait-ish resize while active.
    await page.setViewportSize({ width: 480, height: 900 });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      const box = document.querySelector('#viewport')?.getBoundingClientRect();
      if (box && box.width > 0) {
        (window.__ATLAS_APP__!.host as unknown as HostControlSurface).handleResize(
          box.width,
          box.height
        );
      }
    });
    await page.waitForTimeout(400);
    assertFiniteSnapshotFields(await readDebugSnapshot(page), 'portrait resize');
  });

  test('forced WebGL2 backend runs the same truthful direct path', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/atlas/neutron-star?preset=surface&backend=webgl2');
    await waitForArrival(page, 'neutron-star', 'surface');
    const snap = await readDebugSnapshot(page);
    assertFiniteSnapshotFields(snap, 'webgl2');
    const realErrors = [...consoleErrors.filter((t) => !BENIGN_ERROR.test(t)), ...pageErrors];
    expect(realErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// CPU/GPU surface-ray parity corpus (tasks 4.2-4.5)
// ---------------------------------------------------------------------------

/** GPU-side settings driven by the module (must match the CPU oracle run). */
const GPU_BASE_STEP = 0.3;
const GPU_MIN_STEP = 0.001;
const GPU_MAX_STEP = 100;
const GPU_ESCAPE_RADIUS_RG = 128;
const GPU_BISECTION_ITERATIONS = 24;

/** Linear-space tolerances: f32 trajectory drift + half-float storage + 8-bit output. */
const HIT_NORMAL_TOLERANCE = 0.05;
const ESCAPE_DIRECTION_TOLERANCE = 0.06;

/** NDC point of a world direction (pixel-center exact inverse mapping). */
function ndcForDir(basis: CameraBasis, d: Vec3): NdcPoint {
  const df = dot(d, basis.forward);
  return {
    x: dot(d, basis.right) / df / (basis.tanHalfFovY * basis.aspect),
    y: dot(d, basis.up) / df / basis.tanHalfFovY
  };
}

/** Bisection: screen-plane angle a so that ray pos->dir(a) has flat impact bTarget (km). */
function angleForImpactKm(posKm: Vec3, forward: Vec3, axis: Vec3, bTargetKm: number): number {
  let lo = 1e-6;
  let hi = 1.35;
  const bOf = (a: number): number => {
    const d = add(scale(forward, Math.cos(a)), scale(axis, Math.sin(a)));
    const n = norm(d);
    const dn: Vec3 = [d[0] / n, d[1] / n, d[2] / n];
    // |pos x dir|
    const cx = posKm[1] * dn[2] - posKm[2] * dn[1];
    const cy = posKm[2] * dn[0] - posKm[0] * dn[2];
    const cz = posKm[0] * dn[1] - posKm[1] * dn[0];
    return Math.hypot(cx, cy, cz);
  };
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (bOf(mid) < bTargetKm) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

async function runParityCorpus(page: Page, backend: string): Promise<void> {
  const errors = collectErrors(page);
  await page.goto(`/atlas/neutron-star?preset=surface&backend=${backend}&nssurfacedebug=1`);
  await waitForArrival(page, 'neutron-star', 'surface');

  // Pin tier for headroom/determinism and force a monotonic display chain so
  // presented pixels decode numerically (mirrors integrator-parity).
  await page.evaluate(() => {
    const host = window.__ATLAS_APP__!.host as unknown as HostControlSurface;
    host.governor.setForcedTier('high');
    const post = host.post;
    post.setBloom(false, 0);
    post.setExposure(1);
    post.setToneMapping('linear');
    const box = document.querySelector('#viewport')?.getBoundingClientRect();
    if (box && box.width > 0) host.handleResize(box.width, box.height);
  });
  await waitForCameraSettled(page);
  const basis = await readCameraBasis(page);

  const rgKm = PRESET_MASS_SOLAR * RG_KM_PER_SOLAR_MASS;
  const surfaceRadiusRg = PRESET_RADIUS_KM / rgKm;
  const bLimbRg = analyticLimbImpactParameter(surfaceRadiusRg);
  expect(bLimbRg, 'canonical model sits in the validated R > 3 r_g regime').toBeGreaterThan(0);
  const bLimbKm = bLimbRg * rgKm;
  const posRg: Vec3 = [
    basis.position[0] / rgKm,
    basis.position[1] / rgKm,
    basis.position[2] / rgKm
  ];
  // Conserved-invariant conversion (NM §2): the launcher bisects on the FLAT
  // chord |pos x dir|, but the geodesic conserved b = flat/sqrt(f0). Target
  // ratios of b_limb must be scaled by sqrt(f0) or near-limb probes flip class.
  const r0Rg = norm(basis.position) / rgKm;
  const sqrtF0 = Math.sqrt(1 - 2 / r0Rg);

  interface CorpusRay {
    label: string;
    ndc: NdcPoint;
    cpuClass: 'surface-hit' | 'escaped';
    cpuUnit: Vec3; // hit normal for hits, terminal direction for escapes
  }
  const rays: CorpusRay[] = [];
  const pushProbe = (axisName: string, axis: Vec3, ratio: number): void => {
    const alpha = angleForImpactKm(basis.position, basis.forward, axis, ratio * bLimbKm * sqrtF0);
    const d = add(scale(basis.forward, Math.cos(alpha)), scale(axis, Math.sin(alpha)));
    const dir = normalize3(d);
    const ndc = ndcForDir(basis, dir);
    if (Math.abs(ndc.x) > 0.9 || Math.abs(ndc.y) > 0.9) return; // off-viewport
    const cpu = traceSurfaceRay(posRg, dir, {
      surfaceRadiusRg,
      stepSize: GPU_BASE_STEP,
      minStep: GPU_MIN_STEP,
      maxStep: GPU_MAX_STEP,
      escapeRadius: GPU_ESCAPE_RADIUS_RG,
      maxSteps: 1024,
      bisectionIterations: GPU_BISECTION_ITERATIONS
    });
    if (
      cpu.classification === 'numerical-failure' ||
      cpu.classification === 'invalid-initial-state'
    )
      return; // never assert budget artifacts
    const expectedClass = ratio < 1 ? 'surface-hit' : 'escaped';
    expect(
      cpu.classification,
      `${axisName} b/b_limb=${ratio}: CPU class must match analytic expectation`
    ).toBe(expectedClass);
    rays.push({
      label: `${axisName}-b${ratio}`,
      ndc,
      cpuClass: expectedClass,
      cpuUnit:
        expectedClass === 'surface-hit' ? normalize3(cpu.hitPositionRg!) : cpu.escapeDirection!
    });
  };

  // Radial center ray (head-on surface hit). Repo camera convention: forward
  // IS the look direction (negated third matrix row), so +forward aims at
  // the star-centered origin.
  const centerDir = basis.forward;
  const centerNdc = ndcForDir(basis, centerDir);
  const centerCpu = traceSurfaceRay(posRg, centerDir, {
    surfaceRadiusRg,
    stepSize: GPU_BASE_STEP,
    minStep: GPU_MIN_STEP,
    maxStep: GPU_MAX_STEP,
    escapeRadius: GPU_ESCAPE_RADIUS_RG,
    maxSteps: 1024,
    bisectionIterations: GPU_BISECTION_ITERATIONS
  });
  if (Math.abs(centerNdc.x) < 0.9 && Math.abs(centerNdc.y) < 0.9) {
    expect(centerCpu.classification, 'radial center must terminate on the surface').toBe(
      'surface-hit'
    );
    rays.push({
      label: 'radial-center',
      ndc: centerNdc,
      cpuClass: 'surface-hit',
      cpuUnit: normalize3(centerCpu.hitPositionRg!)
    });
  }

  const axes: Array<{ axis: Vec3; name: string }> = [
    { axis: basis.right, name: 'screen-x' },
    { axis: basis.up, name: 'screen-y' }
  ];
  for (const { axis, name } of axes) {
    for (const ratio of [0.35, 0.7, 0.98]) pushProbe(name, axis, ratio);
    for (const ratio of [1.25, 1.6]) pushProbe(name, axis, ratio);
  }

  expect(rays.length, 'corpus must retain enough in-viewport rays').toBeGreaterThanOrEqual(6);
  expect(rays.some((r) => r.cpuClass === 'surface-hit')).toBe(true);
  expect(rays.some((r) => r.cpuClass === 'escaped')).toBe(true);

  const samples = await sampleColorsAtNdc(
    page,
    rays.map((r) => r.ndc)
  );
  expect(samples.length).toBe(rays.length);

  let magentaish = 0;
  rays.forEach((ray, i) => {
    const px = samples[i]!;
    // Exact failure-color detector (~sRGB(80,0,80)); see behavior test above.
    if (px.r > 60 && px.g <= 16 && Math.abs(px.b - px.r) <= 12) magentaish += 1;
    const recovered: Vec3 = [
      decodeSrgbChannel(px.r) * 2 - 1,
      decodeSrgbChannel(px.g) * 2 - 1,
      decodeSrgbChannel(px.b) * 2 - 1
    ];
    const tolerance =
      ray.cpuClass === 'surface-hit' ? HIT_NORMAL_TOLERANCE : ESCAPE_DIRECTION_TOLERANCE;
    for (let c = 0; c < 3; c += 1) {
      const delta = Math.abs(recovered[c]! - ray.cpuUnit[c]!);
      expect(
        delta,
        `${ray.label} (${backend}): ${ray.cpuClass === 'surface-hit' ? 'hitNormal' : 'escapeDir'}[${'xyz'[c]}] gpu=${recovered[c]!.toFixed(4)} cpu=${ray.cpuUnit[c]!.toFixed(4)}`
      ).toBeLessThan(tolerance);
    }
  });
  expect(magentaish, 'no failure-colored pixels expected in the corpus').toBe(0);

  const realErrors = [
    ...errors.consoleErrors.filter((t) => !BENIGN_ERROR.test(t)),
    ...errors.pageErrors
  ];
  expect(realErrors, `${backend}: console/page errors must stay clean`).toEqual([]);
}

test.describe('neutron-star surface-ray CPU/GPU parity corpus', () => {
  for (const backend of ['webgpu', 'webgl2'] as const) {
    test(`selected rays agree with the binary64 reference (${backend})`, async ({ page }) => {
      test.setTimeout(process.env.CI ? 600_000 : 120_000);
      await runParityCorpus(page, backend);
    });
  }
});

/**
 * Phenomena-animation campaign. The star's spin is integrated from active frame
 * time, so it always rotated — but its timeline mapping declared neither pacing
 * nor looping, so the scrub coordinate saturated at 1.0 after
 * TIMELINE_ROTATIONS and held there, which stops the TIME_ADVANCED invalidation
 * signal from firing again and leaves the readout stuck. The mapping is now
 * paced at the star's ACTUAL spin rate and loops.
 */
test.describe('Neutron Star timeline is paced and endless (phenomena-animation)', () => {
  test('timeline is paced at the spin rate and loops', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/atlas/neutron-star');
    await waitForArrival(page, 'neutron-star');

    const snap = await page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot());
    expect(snap.loop).toBe(true);
    expect(snap.paused).toBe(false);
    // 50 rotations at the preset's 0.5 Hz spin => 1 rotation per 2 s, i.e. a
    // base rate of ~0.5 internal units (rotations) per second.
    expect(snap.basePlaybackRate).toBeGreaterThan(0.2);
    expect(snap.basePlaybackRate).toBeLessThan(1.5);

    const before = snap.physicalTime ?? 0;
    await expect
      .poll(
        () => page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot().physicalTime ?? 0),
        {
          timeout: 15_000,
          intervals: [200]
        }
      )
      .toBeGreaterThan(before + 0.5);
    expect(consoleErrors.concat(pageErrors)).toEqual([]);
  });

  test('the rotating star visibly evolves', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/atlas/neutron-star');
    await waitForArrival(page, 'neutron-star');

    const motion = await measurePresentedMotion(page, { captures: 4, framesBetween: 30 });
    expectPresentedMotion(motion, { label: 'neutron-star' });
    expect(consoleErrors.concat(pageErrors)).toEqual([]);
  });

  test('the scrub coordinate wraps instead of pinning at the end', async ({ page }) => {
    const { consoleErrors, pageErrors } = collectErrors(page);
    await page.goto('/atlas/neutron-star');
    await waitForArrival(page, 'neutron-star');

    await page.evaluate(() => {
      const h = window.__ATLAS_APP__!.host;
      h.time.scrubTo(0.995);
      h.time.play();
    });
    await expect
      .poll(() => page.evaluate(() => window.__ATLAS_APP__!.host.time.snapshot().simulationPhase), {
        timeout: 25_000,
        intervals: [250]
      })
      .toBeLessThan(0.9);
    expect(consoleErrors.concat(pageErrors)).toEqual([]);
  });
});
