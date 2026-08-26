/**
 * GPU null-geodesic integrator material — KERR backwards ray tracing
 * (M9-03..M9-05 / BH-202) on a single full-screen triangle.
 *
 * Spec sources (implemented here; do not drift without updating docs):
 * - docs/KERR_BACKEND_ADR.md (LOCKED conventions):
 *     §1.4  Boyer-Lindquist <-> world frame (+Y symmetry axis; phi is the
 *           world azimuth measured from +X toward +Z)
 *     §1.8  static-observer tetrad initialization:
 *           E = sqrt(f_s), L_z = n_ph sin(theta) sqrt(Delta/f_s)
 *               + g_tphi/sqrt(f_s),
 *           p_r = sqrt(Sigma/Delta) n_r, p_theta = sqrt(Sigma) n_theta
 *     §1.10 first-order BL Hamiltonian over (r, theta, phi, p_r, p_theta)
 *           with fixed parameters E and L_z; classical fixed-step RK4
 *     §1.12 capture policy: r <= r+ + captureEpsilon*M, or infalling
 *           coordinate stall Delta/(r^2+a^2) < 1e-3
 *     §1.13 failure taxonomy; numerical failure NEVER renders as shadow/black
 *     §1.14 curved-trajectory equatorial crossing refinement (bisection over
 *           linearly interpolated planar state, re-embedded per probe)
 *     §1.16 spin-dependent emitter model:
 *           u^t = (r^(3/2)+a*)/sqrt(r^3-3r^2+2a*r^(3/2)),
 *           Omega = 1/(r^(3/2)+a*), g = 1/(u^t (1 - Omega b_z))
 * - docs/NUMERICAL_METHODS.md §9/§10/§17 (step policy shape, event policy,
 *   raw-g handoff to the g^3 Liouville transform inside makeDiskEmissionNode)
 * - docs/SHADER_CONTRACTS.md §2/§5/§6/§11/§13/§14 (uniform groups,
 *   geometry-only steps, stable codes imported verbatim from
 *   src/physics/schwarzschild.js, linear HDR output, compile-bounded loop
 *   with live uMaxSteps uniform, bounded-magnitude NaN proxies)
 * - docs/WORLD_FRAME.md §1 (right-handed Y-up world; disk normal +Y)
 *
 * Architecture mirrors schwarzschildIntegrator.ts (the validated M2/M8
 * production path). The math mirrors
 * src/phenomena/black-hole/kerr/reference.ts formulation-for-formulation;
 * the CPU module stays the binary64 validation oracle (NM §18).
 *
 * Honest approximations / disclosures:
 * - Fixed-step RK4 with the QUALITY heuristic of the validated Schwarzschild
 *   policy (far-field r^1.5 growth beyond 10M, horizon-shrink floor towards
 *   r+(a*)); NOT error-controlled, never labeled as a tolerance.
 * - Per-step null-constraint/Carter monitoring lives in the CPU oracle only
 *   (same split as the validated Schwarzschild pipeline); the GPU path
 *   classifies NON_FINITE/MAX_STEPS explicitly and renders them dim magenta.
 * - Disk-crossing refinement bisects the segment parameter against LINEARLY
 *   interpolated (r, theta, phi), re-embedded per probe (NM §10.2 option);
 *   fixed 24 iterations like the Schwarzschild pass.
 * - Non-finite detection uses the bounded-magnitude proxy (|x| >= 1e30 or
 *   NaN fails strict <) per SHADER_CONTRACTS §14.
 * - sin^2(theta) is floored inside pole-dividing RHS terms; rays with
 *   L_z != 0 cannot physically reach the axis (angular barrier), so the
 *   guard only defends degenerate numerics (ADR §1.19).
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  NodeMaterial,
  Vector3,
  Vector4
} from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  acos,
  atan,
  attribute,
  clamp,
  cos,
  float,
  int,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  select,
  sin,
  sqrt,
  uniform,
  varying,
  vec3,
  vec4
} from 'three/tsl';
import type { LensingPassParams, QualityTier } from '../../../atlas/types.js';
import {
  RAY_ACTIVE,
  RAY_CAPTURED,
  RAY_ESCAPED,
  RAY_INVALID_INITIAL_STATE,
  RAY_MAX_STEPS,
  RAY_NON_FINITE
} from '../../../physics/schwarzschild.js';
import { createEnvironmentSamplerNode } from '../../../shaders/starfieldGpu.js';
import { makeStarfieldParams } from '../../../shaders/starfield.js';
import {
  makeDiskEmissionNode,
  validateDiskModelParams,
  type DiskModelParams
} from '../accretionDisk.js';

// ---------------------------------------------------------------------------
// Local node aliases (boundary casts; mirrors accretionDisk.ts style)
// ---------------------------------------------------------------------------

type FloatNode = Node<'float'>;
type Vec3Node = Node<'vec3'>;
type Vec4Node = Node<'vec4'>;

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/** Magnitude bound of the non-finite proxy (SHADER_CONTRACTS §14 idiom). */
const FINITE_MAGNITUDE_BOUND = 1e30;

/** Floor applied to denominators so divisions never see zero/negative input */
/** (SHADER_CONTRACTS §14); capture fires first in well-conditioned traces. */
const DENOM_FLOOR = 1e-6;

/** sin^2(theta) floor defending pole-dividing terms (ADR §1.19). */
const SIN2_FLOOR = 1e-12;

/** Fixed bisection count for disk-crossing refinement (ADR §1.14). */
const DISK_BISECTION_ITERATIONS = 24;

/**
 * Explicit NUMERICAL_FAILURE debug color — dim magenta, never black
 * (numerical failure must not masquerade as the capture shadow).
 */
const NUMERICAL_FAILURE_RGB: readonly [number, number, number] = [0.08, 0.0, 0.08];

/**
 * Step budgets per quality tier; the compile-time loop bound is the MAXIMUM
 * tier budget and the live per-frame budget rides uMaxSteps (no recompile on
 * tier change — the documented M8 lesson, SHADER_CONTRACTS §13).
 */
const QUALITY_TIER_STEP_BUDGETS: Record<QualityTier, number> = {
  low: 256,
  medium: 512,
  high: 1024,
  ultra: 2048
};

/**
 * Compile-time hard ceiling of the integration loop. M11: decoupled from the
 * ultra TIER budget — moving-observer Kerr rays traverse deeper potentials at
 * E < 1 with theta-motion and need up to ~3x the static-camera affine path
 * (measured census for the kerr-circular-observer reference: median ~215,
 * p95 ~1260, max ~2600 policy steps). The bound covers the scaled budgets the
 * destination pushes for active moving observers; tier budgets themselves are
 * unchanged so static-camera scenes keep their validated cost profile.
 */
const MAX_COMPILE_LOOP_BOUND = QUALITY_TIER_STEP_BUDGETS.ultra * 3;

/** Production spin clamp (mirrors canonical STATE_RANGES.absSpin). */
const SPIN_CLAMP = 0.998;

// ---------------------------------------------------------------------------
// Public uniform-block documentation
// ---------------------------------------------------------------------------

/**
 * Full uniform block of the Kerr lensing material (docs/SHADER_CONTRACTS.md
 * §2 groups consumed by this pass). Scalar entries are the live uniform NODE
 * objects; vector entries own a THREE.Vector3 referenced by identity, so
 * `.value.set(...)` mutates what the shader sees.
 *
 * Units: positions/bases are r_g-native world vectors; steps and
 * captureEpsilon are in units of M (matching kerr/reference.ts options);
 * escapeRadiusRg and disk radii are absolute r_g lengths; spinDimensionless
 * is the SIGNED a* in [-0.998, +0.998].
 */
export interface KerrIntegratorUniforms {
  // --- CameraGpuParams ---
  cameraPositionRg: { value: Vector3 };
  cameraRight: { value: Vector3 };
  cameraUp: { value: Vector3 };
  cameraForward: { value: Vector3 };
  tanHalfFovY: { value: number };
  aspect: { value: number };

  // --- BlackHoleGpuParams ---
  /** Mass in geometric units r_g (> 0). */
  massRg: { value: number };
  /** Black-hole center in world r_g coordinates (default origin). */
  centerRg: { value: Vector3 };
  /** SIGNED dimensionless spin a* = Jc/(GM^2) in [-0.998, +0.998]. */
  spinDimensionless: { value: number };

  // --- DiskGpuParams (normal FIXED to world +Y = spin axis, WORLD_FRAME §1) ---
  diskEnabled: { value: number };
  diskInnerRg: { value: number };
  diskOuterRg: { value: number };

  // --- IntegratorGpuParams (steps in units of M) ---
  maxSteps: { value: number };
  baseStep: { value: number };
  minStep: { value: number };
  maxStep: { value: number };
  escapeRadiusRg: { value: number };
  /** Capture band half-width ABOVE r+, in units of M (ADR §1.12). */
  captureEpsilon: { value: number };

  // --- VisualGpuParams ---
  backgroundIntensity: { value: number };
  /**
   * Debug view selector (>= 0.5 = parity view): ESCAPED rays output the
   * terminal tetrad-projected direction encoded dir*0.5+0.5 (LINEAR);
   * CAPTURED pure black; failures failure-magenta. Debug tooling only.
   */
  debugMode: { value: number };
}

/** Return shape of {@link createKerrLensingMaterial}. */
export interface KerrLensingMaterial {
  material: NodeMaterial;
  uniforms: KerrIntegratorUniforms;
  /** Applies whitelisted state keys; unknown keys ignored silently. */
  setUniformsFromState(state: Record<string, unknown>): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Defensive state coercion helpers (mirror schwarzschildIntegrator.ts)
// ---------------------------------------------------------------------------

function readFiniteNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string' && typeof raw !== 'boolean') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function readVec4Components(raw: unknown): [number, number, number, number] | null {
  if (Array.isArray(raw)) {
    if (raw.length !== 4) return null;
    const c = [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
    return c.every(Number.isFinite) ? (c as [number, number, number, number]) : null;
  }
  return null;
}

function readVec3Components(raw: unknown): [number, number, number] | null {
  if (Array.isArray(raw)) {
    if (raw.length !== 3) {
      return null;
    }
    const c = [Number(raw[0]), Number(raw[1]), Number(raw[2])];
    return c.every(Number.isFinite) ? (c as [number, number, number]) : null;
  }
  if (raw !== null && typeof raw === 'object') {
    const o = raw as { x?: unknown; y?: unknown; z?: unknown };
    const c = [Number(o.x), Number(o.y), Number(o.z)];
    return c.every(Number.isFinite) ? (c as [number, number, number]) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Material factory
// ---------------------------------------------------------------------------

/**
 * Builds the full-screen Kerr lensing NodeMaterial. Conventions and equations
 * follow docs/KERR_BACKEND_ADR.md exactly; see the module header for the
 * disclosed approximations.
 */
export function createKerrLensingMaterial(
  params: LensingPassParams & { spinDimensionless: number }
): KerrLensingMaterial {
  const stepBudget = QUALITY_TIER_STEP_BUDGETS[params.qualityTier] ?? 512;
  const safeMassRg = Number.isFinite(params.massRg) && params.massRg > 0 ? params.massRg : 1;
  const safeSpin = Number.isFinite(params.spinDimensionless)
    ? Math.min(SPIN_CLAMP, Math.max(-SPIN_CLAMP, params.spinDimensionless))
    : 0;
  // The Kerr inner edge may legitimately sit below 2.25 r_g (high prograde
  // ISCO ~ 1.237M). The emission graph itself only requires rIn > 0, while
  // shared validation carries the Schwarzschild-era floor; validate with the
  // floor, run with the true inner edge (docs/KERR_BACKEND_ADR.md §1.16).
  const innerForGraph = Number.isFinite(params.diskInnerRg) ? params.diskInnerRg : 6;
  const outerForValidate = Math.max(
    Number.isFinite(params.diskOuterRg) ? params.diskOuterRg : 20,
    2.25
  );

  // --- Scalar uniform nodes (live writes reach the shader) ---
  const uTanHalfFovY = uniform(1);
  const uAspect = uniform(1);
  const uMassRg = uniform(safeMassRg);
  const uSpin = uniform(safeSpin);
  const uDiskEnabled = uniform(params.diskEnabled ? 1 : 0);
  const uDiskInnerRg = uniform(innerForGraph);
  const uDiskOuterRg = uniform(outerForValidate);
  const uMaxSteps = uniform(stepBudget);
  const uBaseStep = uniform(0.3);
  const uMinStep = uniform(0.001);
  const uMaxStep = uniform(100);
  const uEscapeRadiusRg = uniform(1000);
  const uCaptureEpsilon = uniform(0.01);
  const uBackgroundIntensity = uniform(1);
  const uDebugMode = uniform(0);
  // --- M10 observer-frame block (OBSERVER_FRAME_ADR §5) ---
  const uObserverF = uniform(0);
  const observerLegU = { value: new Vector4() };
  const observerLegA1 = { value: new Vector4() };
  const observerLegA2 = { value: new Vector4() };
  const observerLegA3 = { value: new Vector4() };

  const uniforms: KerrIntegratorUniforms = {
    cameraPositionRg: { value: new Vector3() },
    cameraRight: { value: new Vector3() },
    cameraUp: { value: new Vector3() },
    cameraForward: { value: new Vector3() },
    tanHalfFovY: uTanHalfFovY,
    aspect: uAspect,
    massRg: uMassRg,
    centerRg: { value: new Vector3() },
    spinDimensionless: uSpin,
    diskEnabled: uDiskEnabled,
    diskInnerRg: uDiskInnerRg,
    diskOuterRg: uDiskOuterRg,
    maxSteps: uMaxSteps,
    baseStep: uBaseStep,
    minStep: uMinStep,
    maxStep: uMaxStep,
    escapeRadiusRg: uEscapeRadiusRg,
    captureEpsilon: uCaptureEpsilon,
    backgroundIntensity: uBackgroundIntensity,
    debugMode: uDebugMode
  };

  // Vector uniforms reference the SAME Vector3 instances (pass-by-reference).
  const uCamPos = uniform(uniforms.cameraPositionRg.value);
  // M10 observer-frame graph nodes (pass-by-reference to block entries).
  const uLegU = uniform(observerLegU.value);
  const uLegA1 = uniform(observerLegA1.value);
  const uLegA2 = uniform(observerLegA2.value);
  const uLegA3 = uniform(observerLegA3.value);
  const uRight = uniform(uniforms.cameraRight.value);
  const uUp = uniform(uniforms.cameraUp.value);
  const uForward = uniform(uniforms.cameraForward.value);
  const uCenter = uniform(uniforms.centerRg.value);

  // Pinned collaborators (contracts owned by concurrent modules).
  const sampleEnvironment = createEnvironmentSamplerNode(makeStarfieldParams());
  const diskModel: DiskModelParams = {
    innerRadiusRg: Math.max(innerForGraph, 2.25),
    outerRadiusRg: outerForValidate,
    emissivityIndex: 1.5,
    temperatureScale: 1,
    densityScale: 1,
    turbulence: 0.35,
    seed: 0x9e3779b9
  };
  validateDiskModelParams(diskModel);
  // Bind the emission graph's inner edge to the LIVE uniform holder so both
  // the annulus gate and the Shakura-Sunyaev profile follow ISCO(spin)
  // every frame without recompiles (docs/KERR_BACKEND_ADR.md §1.16).
  const diskEmission = makeDiskEmissionNode(diskModel, {
    innerRadiusRgLive: uniforms.diskInnerRg
  });

  // --- Fullscreen-triangle vertex stage ---
  const positionAttr = attribute<'vec3'>('position', 'vec3');
  const vX = varying(positionAttr.x);
  const vY = varying(positionAttr.y);

  // --- World-ray reconstruction (NDC convention of shaders/cameraRayMath.ts):
  // --- dir = normalize(forward + right*x*tanHalfFovY*aspect + up*y*tanHalfFovY)
  const legacyRayDir = normalize(
    uForward.add(uRight.mul(vX.mul(uTanHalfFovY).mul(uAspect))).add(uUp.mul(vY.mul(uTanHalfFovY)))
  );

  // --- M10 observer-frame local components (OBSERVER_FRAME_ADR §5) ---
  const obsNx = vX.mul(uTanHalfFovY).mul(uAspect);
  const obsNy = vY.mul(uTanHalfFovY);
  const obsNz = float(1);
  const obsLen = sqrt(obsNx.mul(obsNx).add(obsNy.mul(obsNy)).add(obsNz.mul(obsNz)));
  const nxObs = obsNx.div(obsLen);
  const nyObs = obsNy.div(obsLen);
  const nzObs = obsNz.div(obsLen);

  // ---------------------------------------------------------------------------
  // Shared node helpers
  // ---------------------------------------------------------------------------

  const denomFloor = float(DENOM_FLOOR);

  /** World embedding of BL (r, theta, phi_w) relative to center (ADR §1.4). */
  const embedWorldFn = Fn(([rIn, thIn, phIn]: [unknown, unknown, unknown]): Vec3Node => {
    const r = max(float(rIn as FloatNode), float(0));
    const th = float(thIn as FloatNode);
    const ph = float(phIn as FloatNode);
    const st = sin(th);
    const worldOffset = vec3(r.mul(st).mul(cos(ph)), r.mul(cos(th)), r.mul(st).mul(sin(ph)));
    return uCenter.add(worldOffset) as Vec3Node;
  });

  // ---------------------------------------------------------------------------
  // Initial data (ADR §1.8 tetrad) — mirrors kerr/reference.initKerrRay
  // ---------------------------------------------------------------------------

  const relPos = uCamPos.sub(uCenter);
  const r0 = length(relPos);
  const e0 = relPos.div(max(r0, denomFloor));
  const rho0 = sqrt(relPos.x.mul(relPos.x).add(relPos.z.mul(relPos.z)));
  const sinTheta0 = clamp(rho0.div(max(r0, denomFloor)), float(0), float(1));
  const cosTheta0 = clamp(relPos.y.div(max(r0, denomFloor)), float(-1), float(1));
  const theta0 = acos(clamp(cosTheta0, float(-1), float(1)));
  // Azimuth from guarded atan + flat-gate quadrant shifts (atan2 equivalent):
  // u = z/|x| (NOT z/rho -- the |x| denominator carries the quadrant info),
  // base = sign(x)*atan(u), shifted by +-pi when x < 0.
  const azQ = relPos.z
    .div(max(relPos.x.abs(), denomFloor))
    .mul(select(relPos.x.greaterThanEqual(0), float(1), float(-1)));
  const azAtan = atan(azQ);
  const phiW0 = azAtan.add(
    select(
      relPos.x.greaterThanEqual(0),
      float(0),
      select(relPos.z.greaterThanEqual(0), Math.PI, -Math.PI)
    )
  );

  // Local static-frame direction components (world spherical axes at camera).
  const dirLen = length(legacyRayDir);
  const nx = legacyRayDir.x.div(dirLen);
  const ny = legacyRayDir.y.div(dirLen);
  const nz = legacyRayDir.z.div(dirLen);
  const nRadial = nx.mul(e0.x).add(ny.mul(e0.y)).add(nz.mul(e0.z));
  const s0Safe = max(sinTheta0, float(SIN2_FLOOR));
  const nTh = cosTheta0
    .div(s0Safe)
    .mul(nx.mul(e0.x).add(nz.mul(e0.z)))
    .sub(ny.mul(sinTheta0));
  const nPh = nz.mul(e0.x).sub(nx.mul(e0.z)).div(s0Safe);

  const sig0 = max(r0.mul(r0).add(uSpin.mul(uSpin).mul(cosTheta0.mul(cosTheta0))), denomFloor);
  const del0Raw = r0.mul(r0).sub(uMassRg.mul(2).mul(r0)).add(uSpin.mul(uSpin));
  const del0 = max(del0Raw, denomFloor);
  const s20 = max(sinTheta0.mul(sinTheta0), float(SIN2_FLOOR));
  const fS0 = sig0.sub(uMassRg.mul(2).mul(r0)).div(sig0);
  const gTphi0 = uMassRg.mul(-2).mul(uSpin).mul(r0).mul(s20).div(sig0);
  const bigA0 = r0.add(uSpin).mul(r0.add(uSpin)).sub(uSpin.mul(uSpin).mul(del0).mul(s20));

  // --- M10 observer-frame extraction (OBSERVER_FRAME_ADR §5): when active,
  // pixel-local components map through the tetrad legs directly — valid
  // INSIDE the ergosphere (no static frame required). Legacy path keeps the
  // validated ADR §1.8 static decomposition bit-for-bit.
  const obsKT = uLegU.x.add(nxObs.mul(uLegA1.x)).add(nyObs.mul(uLegA2.x)).add(nzObs.mul(uLegA3.x));
  const obsKR = uLegU.y.add(nxObs.mul(uLegA1.y)).add(nyObs.mul(uLegA2.y)).add(nzObs.mul(uLegA3.y));
  const obsKTH = uLegU.z.add(nxObs.mul(uLegA1.z)).add(nyObs.mul(uLegA2.z)).add(nzObs.mul(uLegA3.z));
  const obsKPH = uLegU.w.add(nxObs.mul(uLegA1.w)).add(nyObs.mul(uLegA2.w)).add(nzObs.mul(uLegA3.w));
  // Covariant components at the event (metric folded once per pixel):
  //   k_t = -f_s k^t + g_tphi k^phi;  k_phi = g_tphi k^t + g_phiphi k^phi;
  //   k_r = (Sigma/Delta) k^r;        k_theta = Sigma k^theta.
  const energyMoving = fS0.mul(obsKT).sub(gTphi0.mul(obsKPH));
  const lZMoving = gTphi0.mul(obsKT).add(bigA0.mul(s20).div(sig0).mul(obsKPH));
  const prMoving = sig0.div(del0).mul(obsKR);
  const pthMoving = sig0.mul(obsKTH);

  const energyStatic = sqrt(max(fS0, denomFloor));
  const lZStatic = nPh
    .mul(sinTheta0)
    .mul(sqrt(del0.div(max(fS0, denomFloor))))
    .add(gTphi0.div(max(fS0, denomFloor)));
  const prStatic = sqrt(sig0.div(del0)).mul(nRadial);
  const pthStatic = sqrt(sig0).mul(nTh);

  const activeSel = uObserverF.greaterThan(0.5);
  const energy = select(activeSel, energyMoving, energyStatic) as FloatNode;
  const lZ = select(activeSel, lZMoving, lZStatic) as FloatNode;
  const prInitial = select(activeSel, prMoving, prStatic) as FloatNode;
  const pthInitial = select(activeSel, pthMoving, pthStatic) as FloatNode;

  // Outer horizon r+ = M(1 + sqrt(1 - a*^2)); capture band above it.
  const rPlus = uMassRg.add(uMassRg.mul(sqrt(max(float(1).sub(uSpin.mul(uSpin)), float(0)))));
  const captureRadius = rPlus.add(uCaptureEpsilon.mul(uMassRg));

  // Degenerate cameras: below horizon band, inside ergosphere (f_s <= 0),
  // on-axis (static tetrad singular), or non-finite radius — LEGACY path.
  // M10 active observers relax the ergosphere/on-axis gates (their tetrad
  // needs no static frame) and keep only the horizon band + finiteness.
  const legacyGates = select(r0.greaterThan(captureRadius), float(1), float(0))
    .mul(select(fS0.greaterThan(float(DENOM_FLOOR)), float(1), float(0)))
    .mul(select(sinTheta0.greaterThan(1e-4), float(1), float(0)))
    .mul(select(r0.lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)));
  const movingGates = select(r0.greaterThan(captureRadius), float(1), float(0))
    .mul(select(r0.lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
    .mul(select(energyMoving.abs().greaterThan(float(DENOM_FLOOR)), float(1), float(0)));
  const initValid = select(uObserverF.greaterThan(0.5), movingGates, legacyGates).greaterThan(0.5);

  // ---------------------------------------------------------------------------
  // Hamiltonian sub-graphs (geometry only — SHADER_CONTRACTS §5)
  // ---------------------------------------------------------------------------

  /**
   * Loop-invariant scalar pieces of the Hamiltonian: E and L_z are fixed per
   * pixel for the whole integration, so their products are common nodes.
   * Prefix factoring ONLY — each consumer's original left-to-right operation
   * order is preserved exactly, so values are bit-identical to the previous
   * per-stage re-evaluation (SHADER_CONTRACTS §5).
   */
  const energySqInv = energy.mul(energy);
  const mass4SpinInv = uMassRg.mul(4).mul(uSpin);

  /**
   * Core RHS (ADR §1.10) for (dr, dtheta, dpr, dptheta) given (r, theta,
   * p_r, p_theta). Mirrors kerr/reference.kerrRhs exactly; denominator floors
   * are §14 guards (capture fires before they bind on valid rays).
   */
  /**
   * Core RHS (ADR §1.10) for (dr, dtheta, dpr, dptheta) given (r, theta,
   * p_r, p_theta) and the SHARED stage metric block vec4(Sigma, Delta,
   * sin^2(theta), sin(theta)) from {@link stageMetricFn}. Mirrors
   * kerr/reference.kerrRhs exactly; denominator floors are §14 guards
   * (capture fires before they bind on valid rays).
   */
  const coreDerivsFn = Fn(
    ([rIn, thIn, prIn, pthIn, metric]: [unknown, unknown, unknown, unknown, unknown]): Vec4Node => {
      const r = max(float(rIn as FloatNode), denomFloor);
      const th = float(thIn as FloatNode);
      const pr = float(prIn as FloatNode);
      const pth = float(pthIn as FloatNode);
      const metricV = metric as Vec4Node;
      const sigma = metricV.x;
      const delta = metricV.y;
      const s2 = metricV.z;
      const st = metricV.w;
      const ct = cos(th);
      const aSq = uSpin.mul(uSpin);
      const r2 = r.mul(r);
      const bigA = r2.add(aSq).pow(2).sub(aSq.mul(delta).mul(s2));

      const w = bigA
        .mul(energySqInv.mul(-1))
        .add(mass4SpinInv.mul(r).mul(energy).mul(lZ))
        .add(delta.sub(aSq.mul(s2)).mul(lZ).mul(lZ).div(s2));

      const sigmaDelta = sigma.mul(delta);
      const kinetic = delta.mul(pr).mul(pr).add(pth.mul(pth));

      const dr = delta.mul(pr).div(sigma);
      const dth = pth.div(sigma);

      // dH/dr pieces.
      const sigmaR = r.mul(2);
      const deltaR = r.sub(uMassRg).mul(2);
      const bigAR = r.mul(4).mul(r2.add(aSq)).sub(aSq.mul(deltaR).mul(s2));
      const wR = bigAR
        .mul(energySqInv.mul(-1))
        .add(mass4SpinInv.mul(energy).mul(lZ))
        .add(deltaR.mul(lZ).mul(lZ).div(s2));
      const dhdr = float(0.5)
        .mul(
          wR
            .div(sigmaDelta)
            .sub(w.mul(sigmaR.mul(delta).add(sigma.mul(deltaR))).div(sigmaDelta.mul(sigmaDelta)))
        )
        .add(
          float(0.5).mul(
            deltaR
              .mul(pr)
              .mul(pr)
              .div(sigma)
              .sub(kinetic.mul(sigmaR).div(sigma.mul(sigma)))
          )
        );

      // dH/dtheta pieces.
      const sinTwo = st.mul(ct).mul(2);
      const sigmaTh = aSq.mul(sinTwo).mul(-1);
      const bigATh = aSq.mul(delta).mul(sinTwo).mul(-1);
      const sin3 = max(st.mul(s2), float(SIN2_FLOOR));
      const wTh = bigATh
        .mul(energySqInv.mul(-1))
        .sub(uMassRg.mul(2).mul(delta).mul(lZ).mul(lZ).mul(ct).div(sin3));
      const dhdtheta = float(0.5)
        .mul(wTh.div(sigmaDelta).sub(w.mul(sigmaTh).mul(delta).div(sigmaDelta.mul(sigmaDelta))))
        .sub(float(0.5).mul(kinetic.mul(sigmaTh).div(sigma.mul(sigma))));

      return vec4(dr, dth, dhdr.mul(-1), dhdtheta.mul(-1));
    }
  );

  /** Azimuthal rate dphi/dlambda — depends on (r, theta) only (+params);
   * consumes the SHARED stage metric block (no duplicate trig/metric work).
   * The stage point's theta enters only through the metric block. */
  const phiRateFn = Fn(([rIn, metric]: [unknown, unknown]): FloatNode => {
    const r = max(float(rIn as FloatNode), denomFloor);
    const metricV = metric as Vec4Node;
    const mSigma = metricV.x;
    const mDelta = metricV.y;
    const s2 = metricV.z;
    const aSq = uSpin.mul(uSpin);
    return uMassRg
      .mul(2)
      .mul(uSpin)
      .mul(r)
      .mul(energy)
      .add(mDelta.sub(aSq.mul(s2)).mul(lZ).div(s2))
      .div(mSigma.mul(mDelta)) as FloatNode;
  });

  /**
   * Shared per-stage metric block: vec4(Sigma, Delta, sin^2(theta), sin(theta))
   * at ONE stage point. Each RK4 stage evaluates this once and both consumers
   * ({@link coreDerivsFn}, {@link phiRateFn}) read it — previously the azimuthal
   * rate re-evaluated the identical trig/metric chain a second time per stage.
   * Operation order matches the original expressions term-for-term, so emitted
   * values are bit-identical (SHADER_CONTRACTS §5 geometry-only).
   */
  const stageMetricFn = Fn(([rIn, thIn]: [unknown, unknown]): Vec4Node => {
    const r = max(float(rIn as FloatNode), denomFloor);
    const th = float(thIn as FloatNode);
    const st = sin(th);
    const s2 = max(st.mul(st), float(SIN2_FLOOR));
    const sigma = max(r.mul(r).add(uSpin.mul(uSpin).mul(cos(th).mul(cos(th)))), denomFloor);
    const delta = max(r.mul(r).sub(uMassRg.mul(2).mul(r)).add(uSpin.mul(uSpin)), denomFloor);
    return vec4(sigma, delta, s2, st);
  });

  // ---------------------------------------------------------------------------
  // Fragment graph
  // ---------------------------------------------------------------------------
  //
  // NOTE ON STRUCTURE: the RK4 stages are written INLINE inside the bounded
  // Loop body rather than wrapped in an Fn — the five-component state cannot
  // round-trip through a single-node Fn return, and phi evolves decoupled
  // from the momenta so its four stage rates reuse the same intermediate
  // states. Everything stays geometry-only (SHADER_CONTRACTS §5).

  const statusStart = int(RAY_INVALID_INITIAL_STATE);

  const fragmentGraph = Fn((): Vec4Node => {
    // Status starts INVALID so a skipped integration can never look like a
    // valid black pixel (SHADER_CONTRACTS §6 codes).
    const status = statusStart.toVar();
    const radiance = vec3(0).toVar();
    const escapedDirection = vec3(0).toVar();
    // Minimum |sin(theta)| along the trace: pole-grazing rays are f32-
    // limited and get reclassified to explicit failure below (ADR §1.19).
    const minSinTheta = float(1).toVar();
    // M11 debug-only sub-reason flags for the ?kerrstatus view (never part
    // of the stable RAY_* contract): theta-wrap vs pole-passage vs other
    // non-finite.
    const dbgWrap = float(0).toVar();
    const dbgPole = float(0).toVar();

    If(initValid, () => {
      status.assign(int(RAY_ACTIVE));

      const rVar = r0.toVar();
      const thVar = theta0.toVar();
      const phVar = phiW0.toVar();
      const prVar = prInitial.toVar();
      const pthVar = pthInitial.toVar();
      const prevR = float(0).toVar();
      const prevTh = float(0).toVar();
      const prevPh = float(0).toVar();
      /** World-Y height (relative to center) of the segment START point;
       * carried across iterations — identical to re-embedding (prevR, prevTh,
       * prevPh), which hold exactly last iteration's endpoint.
       */
      const prevHeight = float(0).toVar();

      // First segment's start height comes from the initial world point.
      prevHeight.assign(embedWorldFn(r0, theta0, phiW0).y.sub(uCenter.y));

      Loop(MAX_COMPILE_LOOP_BOUND, ({ i }) => {
        If(float(i).greaterThanEqual(uMaxSteps), () => {
          status.assign(int(RAY_MAX_STEPS));
          Break();
        });

        // --- Step-size policy (NM §9 QUALITY heuristic; ADR §1.19):
        // far field grows like r^1.5 beyond 10M, shrink towards r+(a*) with
        // a 0.02 floor, AND shrink with sin(theta) near the coordinate pole
        // (dH/dtheta ~ L_z^2/sin^3 stiffness), clamped to [minStep, maxStep].
        const farScale = pow(max(rVar.div(uMassRg.mul(10)), float(1)), float(1.5));
        const nearScale = min(float(1), max(rVar.sub(rPlus).div(uMassRg), float(0.02)));
        const poleFactor = clamp(sin(thVar).abs(), float(0.02), float(1));
        const hStep = clamp(
          uBaseStep.mul(uMassRg).mul(farScale).mul(nearScale).mul(poleFactor),
          uMinStep.mul(uMassRg),
          uMaxStep.mul(uMassRg)
        );

        prevR.assign(rVar);
        prevTh.assign(thVar);
        prevPh.assign(phVar);
        minSinTheta.assign(min(minSinTheta, sin(thVar).abs()));

        // --- Inline classical RK4 (NM §8.1) over the five-var state. Each
        // stage evaluates the shared metric block once (see stageMetricFn).
        const m1 = stageMetricFn(rVar, thVar);
        const d1 = coreDerivsFn(rVar, thVar, prVar, pthVar, m1);
        const k1phi = phiRateFn(rVar, m1);
        const halfH = hStep.mul(0.5);
        const r1 = rVar.add(halfH.mul(d1.x));
        const th1 = thVar.add(halfH.mul(d1.y));
        const pr1 = prVar.add(halfH.mul(d1.z));
        const pth1 = pthVar.add(halfH.mul(d1.w));

        const m2 = stageMetricFn(r1, th1);
        const d2 = coreDerivsFn(r1, th1, pr1, pth1, m2);
        const k2phi = phiRateFn(r1, m2);
        const r2s = rVar.add(halfH.mul(d2.x));
        const th2s = thVar.add(halfH.mul(d2.y));
        const pr2s = prVar.add(halfH.mul(d2.z));
        const pth2s = pthVar.add(halfH.mul(d2.w));

        const m3 = stageMetricFn(r2s, th2s);
        const d3 = coreDerivsFn(r2s, th2s, pr2s, pth2s, m3);
        const k3phi = phiRateFn(r2s, m3);
        const r3 = rVar.add(hStep.mul(d3.x));
        const th3 = thVar.add(hStep.mul(d3.y));
        const pr3 = prVar.add(hStep.mul(d3.z));
        const pth3 = pthVar.add(hStep.mul(d3.w));

        const m4 = stageMetricFn(r3, th3);
        const d4 = coreDerivsFn(r3, th3, pr3, pth3, m4);
        const k4phi = phiRateFn(r3, m4);

        const sixthH = hStep.mul(1 / 6);
        rVar.addAssign(sixthH.mul(d1.x.add(d2.x.mul(2)).add(d3.x.mul(2)).add(d4.x)));
        thVar.addAssign(sixthH.mul(d1.y.add(d2.y.mul(2)).add(d3.y.mul(2)).add(d4.y)));
        phVar.addAssign(sixthH.mul(k1phi.add(k2phi.mul(2)).add(k3phi.mul(2)).add(k4phi)));
        prVar.addAssign(sixthH.mul(d1.z.add(d2.z.mul(2)).add(d3.z.mul(2)).add(d4.z)));
        pthVar.addAssign(sixthH.mul(d1.w.add(d2.w.mul(2)).add(d3.w.mul(2)).add(d4.w)));

        // --- Non-finite proxy (§14): |x| >= 1e30 OR NaN (fails strict <).
        If(
          select(rVar.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0))
            .mul(select(thVar.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .mul(select(phVar.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .mul(select(prVar.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .mul(select(pthVar.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .lessThan(0.5),
          () => {
            status.assign(int(RAY_NON_FINITE));
            Break();
          }
        );

        // --- Theta-domain guard: resolved trajectories never leave [0, pi];
        // numerical wrap-through past the pole is an explicit NON_FINITE
        // failure (never a silently mirrored path) — mirrors the reference.
        If(
          select(thVar.lessThan(0), float(1), float(0))
            .add(select(thVar.greaterThan(Math.PI), float(1), float(0)))
            .greaterThan(0.5),
          () => {
            status.assign(int(RAY_NON_FINITE));
            dbgWrap.assign(1);
            Break();
          }
        );

        // --- Thin-disk crossing (disk normal = world +Y, WORLD_FRAME §1):
        // signed world-y sign change between consecutive segment endpoints,
        // evaluated on the CURVED trajectory via re-embedding — never a flat
        // Euclidean camera-ray test (NM §10.2 / ADR §1.14). Runs before
        // capture/escape so a terminal-segment crossing still contributes.
        If(uDiskEnabled.greaterThan(0.5), () => {
          // Segment-start height carried from the previous iteration's
          // endpoint embed (identical inputs → bit-identical value): one full
          // world embedding saved per integration step.
          const hStart = prevHeight;
          const segEnd = embedWorldFn(rVar, thVar, phVar);
          const hEnd = segEnd.y.sub(uCenter.y);

          If(hStart.mul(hEnd).lessThan(0), () => {
            const lo = float(0).toVar();
            const hi = float(1).toVar();
            Loop(DISK_BISECTION_ITERATIONS, () => {
              const mid = lo.add(hi).mul(0.5);
              const probe = embedWorldFn(
                mix(prevR, rVar, mid),
                mix(prevTh, thVar, mid),
                mix(prevPh, phVar, mid)
              );
              const hProbe = probe.y.sub(uCenter.y);
              If(hStart.mul(hProbe).greaterThan(0), () => {
                lo.assign(mid);
              }).Else(() => {
                hi.assign(mid);
              });
            });

            const sCross = lo.add(hi).mul(0.5);
            const rHit = mix(prevR, rVar, sCross);
            const phHit = mix(prevPh, phVar, sCross);

            If(
              select(rHit.greaterThanEqual(uDiskInnerRg), float(1), float(0))
                .mul(select(rHit.lessThanEqual(uDiskOuterRg), float(1), float(0)))
                .greaterThan(0.5),
              () => {
                // Spin-dependent emitter frequency ratio (ADR §1.16):
                //   u^t = (r^(3/2)+a*)/sqrt(r^3-3r^2+2a*r^(3/2))
                //   Omega = 1/(r^(3/2)+a*),  g = 1/(u^t(1-Omega*b_z))
                // Guards mirror the CPU fn: no orbit below the existence
                // boundary; denominator must stay positive or the emitter
                // state is unreachable/invisible (gated to 0, never faked).
                const rSafe = max(rHit, denomFloor);
                const r32 = pow(rSafe, 1.5);
                const orbitDenom = rSafe.mul(rSafe).mul(rSafe.sub(3)).add(uSpin.mul(2).mul(r32));
                const ut = select(
                  orbitDenom.greaterThan(0),
                  r32.add(uSpin).div(sqrt(max(orbitDenom, denomFloor))),
                  float(0)
                );
                const omega = select(
                  orbitDenom.greaterThan(0),
                  float(1).div(r32.add(uSpin)),
                  float(0)
                );
                const bzImpact = lZ.div(max(energy, denomFloor));
                const dopplerDenom = float(1).sub(omega.mul(bzImpact));
                // Flat gate product keeps BOTH select arms finite (a raw mix would
                // smear NaN from the dead arm into radiance).
                const gValid = select(orbitDenom.greaterThan(0), float(1), float(0)).mul(
                  select(dopplerDenom.greaterThan(0), float(1), float(0))
                );
                const dopplerSafe = max(dopplerDenom.mul(gValid), denomFloor);
                // M10 comoving-observer convention (ADR §6): the legacy factor
                // assumed numerator E; the comoving measurement is nu_obs = 1
                // so scale by 1/E. Exactly 1 for legacy camera/static paths.
                const gFactor = select(
                  gValid.greaterThan(0.5),
                  float(1).div(max(ut, denomFloor).mul(dopplerSafe)),
                  float(0)
                ).div(max(energy.abs(), denomFloor));
                // emit() applies the g^3 Liouville transform INTERNALLY (its
                // contract) — pass RAW g, never re-multiply (NM §17).
                const emitted = diskEmission.emit({
                  r: rHit,
                  gFactor,
                  phi: phHit
                }) as Vec3Node;
                radiance.addAssign(emitted);
              }
            );
          });

          // Carry this segment's end height into the next iteration. Every
          // completed iteration reaches here: capture/escape Breaks below
          // terminate the loop only AFTER this block has run.
          prevHeight.assign(hEnd);
        });

        // --- Horizon capture (ADR §1.12), priority over escape:
        // 1. explicit band above r+, or
        // 2. infalling coordinate stall Delta/(r^2+a^2) < 1e-3 (the BL analog
        //    of the validated Schwarzschild f < 1e-3 stall resolution).
        If(rVar.lessThanEqual(captureRadius), () => {
          status.assign(int(RAY_CAPTURED));
          Break();
        });
        const deltaHere = max(
          rVar.mul(rVar).sub(uMassRg.mul(2).mul(rVar)).add(uSpin.mul(uSpin)),
          denomFloor
        );
        If(
          select(prVar.lessThan(0), float(1), float(0))
            .mul(
              select(
                deltaHere.div(rVar.mul(rVar).add(uSpin.mul(uSpin))).lessThan(1e-3),
                float(1),
                float(0)
              )
            )
            .greaterThan(0.5),
          () => {
            status.assign(int(RAY_CAPTURED));
            Break();
          }
        );

        // --- Conservative escape (NM §10.3): beyond the radius AND outward;
        // flat gate product for WebGL2 safety.
        If(
          select(rVar.greaterThan(uEscapeRadiusRg), float(1), float(0))
            .mul(select(prVar.greaterThan(0), float(1), float(0)))
            .greaterThan(0.5),
          () => {
            status.assign(int(RAY_ESCAPED));
            Break();
          }
        );
      });

      // Budget reached the compile-time bound without an event: exhausted.
      If(status.equal(int(RAY_ACTIVE)), () => {
        status.assign(int(RAY_MAX_STEPS));
      });

      // Pole-passage honesty gate (ADR §1.19): an ESCAPED ray that grazed
      // the symmetry axis closer than sin(theta)=0.04 cannot meet the f32
      // accuracy budget; classify it as an explicit numerical failure
      // instead of presenting a possibly wrong direction. Captured rays
      // keep capture (monotone infall is robust). Mirrored by the CPU oracle.
      If(
        select(status.equal(int(RAY_ESCAPED)), float(1), float(0))
          .mul(select(minSinTheta.lessThan(0.04), float(1), float(0)))
          .greaterThan(0.5),
        () => {
          status.assign(int(RAY_NON_FINITE));
          dbgPole.assign(1);
        }
      );

      // --- Terminal tetrad-projected direction (inverse static tetrad,
      // mirroring reference.terminalLocalDirection; defined for every valid
      // terminal state so both environment sampling and the parity encoding
      // consume it branch-free):
      //   kappa^-1 = sqrt(f_s)/E
      //   n_r  = kappa^-1 p_r sqrt(Delta/Sigma)
      //   n_th = kappa^-1 p_theta/sqrt(Sigma)
      //   n_ph = [(L_z/E)sqrt(f_s) - g_tphi/sqrt(f_s)] sqrt(f_s/Delta)/sin(theta)
      const sigT = max(
        rVar.mul(rVar).add(uSpin.mul(uSpin).mul(cos(thVar).mul(cos(thVar)))),
        denomFloor
      );
      const delTRaw = rVar.mul(rVar).sub(uMassRg.mul(2).mul(rVar)).add(uSpin.mul(uSpin));
      const delT = max(delTRaw, denomFloor);
      const stT = max(sin(thVar), float(SIN2_FLOOR));
      const fST = sigT.sub(uMassRg.mul(2).mul(rVar)).div(sigT);
      const gTphiT = uMassRg.mul(-2).mul(uSpin).mul(rVar).mul(stT.mul(stT)).div(sigT);
      const kappaInv = sqrt(max(fST, denomFloor)).div(max(energy, denomFloor));
      const nRTerm = prVar.mul(sqrt(delT.div(sigT))).mul(kappaInv);
      const nThTerm = pthVar.div(sqrt(sigT)).mul(kappaInv);
      const nPhTerm = lZ
        .div(max(energy, denomFloor))
        .mul(sqrt(max(fST, denomFloor)))
        .sub(gTphiT.div(sqrt(max(fST, denomFloor))))
        .mul(sqrt(max(fST, denomFloor).div(delT)))
        .div(stT);
      const normTerm = sqrt(
        max(nRTerm.mul(nRTerm).add(nThTerm.mul(nThTerm)).add(nPhTerm.mul(nPhTerm)), float(1e-12))
      );
      const cph = cos(phVar);
      const sph = sin(phVar);
      const stW = sin(thVar);
      const ctW = cos(thVar);
      escapedDirection.assign(
        normalize(
          vec3(
            nRTerm
              .mul(stW.mul(cph))
              .add(nThTerm.mul(ctW.mul(cph)))
              .add(nPhTerm.mul(sph.mul(-1))),
            nRTerm.mul(ctW).add(nThTerm.mul(stW.mul(-1))),
            nRTerm
              .mul(stW.mul(sph))
              .add(nThTerm.mul(ctW.mul(sph)))
              .add(nPhTerm.mul(cph))
          ).div(normTerm)
        )
      );

      // Escape shading: sample the procedural environment along the terminal
      // tetrad-projected direction, scaled by the visual intensity (§9/§11).
      If(status.equal(int(RAY_ESCAPED)), () => {
        const skyRadiance = sampleEnvironment(escapedDirection) as Vec3Node;
        radiance.addAssign(skyRadiance.mul(uBackgroundIntensity));
      });
    });

    // Debug parity encoding (uDebugMode >= 0.5): ESCAPED rays output the
    // terminal tetrad-projected direction mapped to [0,1]^3 instead of
    // environment radiance. Flat gate mix (WebGL2 safety).
    const debugMix = select(uDebugMode.greaterThanEqual(0.5), float(1), float(0));
    const escapedOutput = mix(radiance, escapedDirection.mul(0.5).add(0.5), debugMix) as Vec3Node;

    // Output assembly (linear HDR, §11): captured -> photon-capture BLACK
    // (the shadow); escaped -> accumulated disk light + environment (or the
    // parity encoding when uDebugMode is set); every other terminal code
    // -> explicit NUMERICAL_FAILURE magenta, never black.
    const physicalRgb = select(
      status.equal(int(RAY_CAPTURED)),
      vec3(0, 0, 0),
      select(status.equal(int(RAY_ESCAPED)), escapedOutput, vec3(...NUMERICAL_FAILURE_RGB))
    ) as Vec3Node;
    // M11 classification view (Gate D: debug views expose per-ray terminal
    // classes; mirrors the LUT pass's lutDebugStatus). Active when uDebugMode
    // >= 2 (destination ?kerrstatus): escaped cyan, captured black,
    // max-steps orange, non-finite split by reason — theta-wrap red,
    // pole-passage yellow, other/NaN bright magenta; invalid-initial-state
    // dim magenta.
    const statusViewMix = select(uDebugMode.greaterThan(1.5), float(1), float(0));
    const nonFiniteColor = select(
      dbgWrap.greaterThan(0.5),
      vec3(1.0, 0.05, 0.05),
      select(dbgPole.greaterThan(0.5), vec3(1.0, 0.9, 0.2), vec3(1.0, 0.2, 1.0))
    ) as Vec3Node;
    const statusColor = select(
      status.equal(int(RAY_ESCAPED)),
      vec3(0.0, 0.7, 1.0),
      select(
        status.equal(int(RAY_CAPTURED)),
        vec3(0.0, 0.0, 0.0),
        select(
          status.equal(int(RAY_MAX_STEPS)),
          vec3(1.0, 0.45, 0.0),
          select(status.equal(int(RAY_NON_FINITE)), nonFiniteColor, vec3(0.35, 0.0, 0.35))
        )
      )
    ) as Vec3Node;
    return vec4(mix(physicalRgb, statusColor, statusViewMix), float(1));
  });

  const material = new NodeMaterial();
  material.vertexNode = vec4(positionAttr.xy, float(0), float(1));
  material.fragmentNode = fragmentGraph();

  // Local fullscreen-triangle geometry (consumers build their own mesh; this
  // copy keeps the pass self-contained and is released in dispose()).
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
  );

  let disposed = false;

  return {
    material,
    uniforms,
    /**
     * Applies the accepted state keys (cameraPositionRg, cameraRight,
     * cameraUp, cameraForward, tanHalfFovY, aspect, massRg, centerRg,
     * spinDimensionless, diskEnabled, diskInnerRg, diskOuterRg, maxSteps,
     * baseStep, minStep, maxStep, escapeRadiusRg, captureEpsilon,
     * backgroundIntensity, debugMode). Unknown keys are ignored silently;
     * wrong-typed values fail the finite coercion and are ignored.
     */
    setUniformsFromState(state: Record<string, unknown>): void {
      const camPos = readVec3Components(state['cameraPositionRg']);
      if (camPos) uniforms.cameraPositionRg.value.set(camPos[0], camPos[1], camPos[2]);
      const camRight = readVec3Components(state['cameraRight']);
      if (camRight) uniforms.cameraRight.value.set(camRight[0], camRight[1], camRight[2]);
      const camUp = readVec3Components(state['cameraUp']);
      if (camUp) uniforms.cameraUp.value.set(camUp[0], camUp[1], camUp[2]);
      const camForward = readVec3Components(state['cameraForward']);
      if (camForward) uniforms.cameraForward.value.set(camForward[0], camForward[1], camForward[2]);
      const center = readVec3Components(state['centerRg']);
      if (center) uniforms.centerRg.value.set(center[0], center[1], center[2]);

      const tanHalf = readFiniteNumber(state['tanHalfFovY']);
      if (tanHalf !== null && tanHalf > 0) uTanHalfFovY.value = tanHalf;
      const aspectValue = readFiniteNumber(state['aspect']);
      if (aspectValue !== null && aspectValue > 0) uAspect.value = aspectValue;
      const mass = readFiniteNumber(state['massRg']);
      if (mass !== null && mass > 0) uMassRg.value = mass;
      const spin = readFiniteNumber(state['spinDimensionless']);
      if (spin !== null) {
        uSpin.value = Math.min(SPIN_CLAMP, Math.max(-SPIN_CLAMP, spin));
      }

      const diskOnRaw = state['diskEnabled'];
      if (typeof diskOnRaw === 'boolean') {
        uDiskEnabled.value = diskOnRaw ? 1 : 0;
      } else {
        const diskOn = readFiniteNumber(diskOnRaw);
        if (diskOn !== null) uDiskEnabled.value = diskOn !== 0 ? 1 : 0;
      }
      const inner = readFiniteNumber(state['diskInnerRg']);
      if (inner !== null && inner > 0) uDiskInnerRg.value = inner;
      const outer = readFiniteNumber(state['diskOuterRg']);
      if (outer !== null && outer > innerForGraph) uDiskOuterRg.value = outer;

      const steps = readFiniteNumber(state['maxSteps']);
      // Hard-clamped to the compile-time tier bound (SHADER_CONTRACTS §13).
      if (steps !== null) {
        uMaxSteps.value = Math.min(MAX_COMPILE_LOOP_BOUND, Math.max(1, Math.round(steps)));
      }
      const base = readFiniteNumber(state['baseStep']);
      if (base !== null && base > 0) uBaseStep.value = base;
      const minS = readFiniteNumber(state['minStep']);
      if (minS !== null && minS > 0) uMinStep.value = minS;
      const maxS = readFiniteNumber(state['maxStep']);
      if (maxS !== null && maxS > 0) uMaxStep.value = maxS;
      const escape = readFiniteNumber(state['escapeRadiusRg']);
      if (escape !== null && escape > 0) uEscapeRadiusRg.value = escape;
      const eps = readFiniteNumber(state['captureEpsilon']);
      if (eps !== null && eps >= 0) uCaptureEpsilon.value = eps;
      const bgInt = readFiniteNumber(state['backgroundIntensity']);
      if (bgInt !== null && bgInt >= 0) uBackgroundIntensity.value = bgInt;
      const debugRaw = readFiniteNumber(state['debugMode']);
      if (debugRaw !== null && debugRaw >= 0) uDebugMode.value = debugRaw;

      // --- M10 observer-frame block ---
      const obsLegU = readVec4Components(state['observerLegU']);
      if (obsLegU) observerLegU.value.set(obsLegU[0], obsLegU[1], obsLegU[2], obsLegU[3]);
      const obsA1 = readVec4Components(state['observerLegA1']);
      if (obsA1) observerLegA1.value.set(obsA1[0], obsA1[1], obsA1[2], obsA1[3]);
      const obsA2v = readVec4Components(state['observerLegA2']);
      if (obsA2v) observerLegA2.value.set(obsA2v[0], obsA2v[1], obsA2v[2], obsA2v[3]);
      const obsA3v = readVec4Components(state['observerLegA3']);
      if (obsA3v) observerLegA3.value.set(obsA3v[0], obsA3v[1], obsA3v[2], obsA3v[3]);
      const obsFlagV = readFiniteNumber(state['observerActive']);
      if (obsFlagV !== null) uObserverF.value = obsFlagV;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    }
  };
}
