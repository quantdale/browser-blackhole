/**
 * GPU null-geodesic integrator material — Schwarzschild backwards ray tracing
 * on a single full-screen triangle (M2-06/07/08/09 + M3 disk geometry).
 *
 * Spec sources (implemented here; do not drift without updating docs):
 * - docs/NUMERICAL_METHODS.md
 *     §2  static-observer tetrad: E = sqrt(f), b = L/E = r*|n_tangential|/sqrt(f)
 *     §3  geodesic-plane reduction and world re-embedding
 *     §4  planar Hamiltonian first-order system with E normalized to 1
 *     §8.1/8.2 classical fixed-step RK4 (the documented GPU bring-up path)
 *     §9  radius-aware step policy honoring minStep/maxStep/maxSteps
 *     §10 event classification: capture / disk crossing / escape / failure
 *     §13 dedicated stable radial path for L ~= 0 (never normalizes a
 *         near-zero tangent)
 *     §15 circular equatorial emitter Omega = sqrt(M/r^3), u^t = 1/sqrt(1-3M/r)
 *     §16 frequency ratio g = nu_obs/nu_emit = 1/(u^t * (1 - Omega*b_z))
 *     §17 specific-intensity transform I_nu,obs = g^3 I_nu,emit
 * - docs/SHADER_CONTRACTS.md
 *     §2  canonical CameraGpuParams / BlackHoleGpuParams / DiskGpuParams /
 *         IntegratorGpuParams / VisualGpuParams uniform groups
 *     §5  integrator steps stay geometry-only (shading lives outside RK4)
 *     §6  stable integer classification codes, imported verbatim from
 *         src/physics/schwarzschild.js so CPU/GPU never renumber them
 *     §11 primary pass output is linear HDR
 *     §13 compile-time bounded loop work; the maxSteps uniform exits early
 *         within the tier-selected compile-time bound
 *     §14 non-finite guards via bounded-magnitude proxy (NaN fails |x| < B)
 * - docs/WORLD_FRAME.md §1 right-handed Y-up world frame; disk normal +Y;
 *   black-hole center configurable, default the world origin
 *
 * The math mirrors src/phenomena/black-hole/cpuReference.ts (binary64 CPU
 * reference) formulation-for-formulation; this f32 GPU path is the production
 * renderer and the CPU path stays the validation oracle (NM §18).
 *
 * Honest approximations / disclosures:
 * - Fixed-step RK4 with a QUALITY step heuristic (NM §8.3 wording): h follows
 *   the CPU reference's §9 radius policy plus an extra linear shrink toward
 *   the photon sphere, factor |r - 3M| / (3M) (the "~r/3 sensitivity"). This
 *   is NOT an error-controlled tolerance; it must never be labeled as one.
 * - Disk-crossing refinement bisects the segment parameter s in [0, 1] over a
 *   LINEAR interpolation of the planar state (r, phi), re-embedded per probe
 *   (NM §10.2 "interpolation/substepping" option). Fixed 24 iterations;
 *   accuracy is bounded by intra-segment curvature, not formally controlled.
 * - The g^3 Liouville boost is applied INSIDE makeDiskEmissionNode (its
 *   documented contract). This integrator passes the RAW g factor and must
 *   not multiply again — that would square the transform (forbidden, NM §17).
 * - Disk emitters are taken PROGRADE around world +Y: Omega > 0 in
 *   g = 1/(u^t (1 - Omega*b_z)) with the right-handed frame of WORLD_FRAME §1.
 *   Axial-invariant derivation: with dphi/dlambda = L/r^2 and the embedding
 *   pos = r*(cos(phi) e0 + sin(phi) e1), the photon angular momentum vector is
 *   L_vec = L * N with N = e0 x e1, so its projection on the symmetry axis is
 *   L_z = L * dot(N, +Y). The stored angularMomentum already equals the
 *   E-normalized L/E (NM §4 rescaling), hence b_z = L * dot(N, Y).
 * - Non-finite state cannot be queried directly in WGSL; SHADER_CONTRACTS §14
 *   explicitly permits bounded-magnitude proxies. Any |state| >= 1e30 — or
 *   NaN, which fails the strict less-than — routes to NUMERICAL_FAILURE.
 * - captureEpsilon is in units of M: capture fires at r <= (2 + eps) * M,
 *   exactly like cpuReference (NM §10.1). Step inputs scale with M likewise.
 * - Loop-exhausted / invalid rays render explicit dim magenta (0.08, 0, 0.08)
 *   — NEVER black — so numerical failure can never masquerade as the shadow.
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
  attribute,
  clamp,
  cos,
  cross,
  dot,
  float,
  int,
  length,
  max,
  min,
  mix,
  normalize,
  pow,
  abs as tslAbs,
  select,
  sin,
  sqrt,
  uniform,
  varying,
  vec3,
  vec4
} from 'three/tsl';
import type { LensingPassParams, QualityTier } from '../../atlas/types.js';
import {
  RAY_ACTIVE,
  RAY_CAPTURED,
  RAY_ESCAPED,
  RAY_INVALID_INITIAL_STATE,
  RAY_MAX_STEPS,
  RAY_NON_FINITE
} from '../../physics/schwarzschild.js';
import { createEnvironmentSamplerNode } from '../../shaders/starfieldGpu.js';
import { makeStarfieldParams } from '../../shaders/starfield.js';
import {
  makeDiskEmissionNode,
  validateDiskModelParams,
  type DiskModelParams
} from './accretionDisk.js';

// ---------------------------------------------------------------------------
// Local node aliases (boundary casts; mirrors accretionDisk.ts style)
// ---------------------------------------------------------------------------

type FloatNode = Node<'float'>;
type Vec3Node = Node<'vec3'>;
type Vec4Node = Node<'vec4'>;

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/**
 * Tangential magnitude below which a ray takes the dedicated radial path
 * (NM §13); mirrors cpuReference's RADIAL_EPSILON.
 */
const RADIAL_EPSILON = 1e-12;

/**
 * Floor applied to denominators (f, r, sqrt arguments) so a division or root
 * can never see zero/negative input (SHADER_CONTRACTS §14). Capture fires
 * first in well-conditioned traces, so legitimate states never reach it.
 */
const DENOM_FLOOR = 1e-6;

/** Magnitude bound of the non-finite proxy (see header disclosure §14). */
const FINITE_MAGNITUDE_BOUND = 1e30;

/** Fixed bisection count for disk-crossing refinement (NM §10.2). */
const DISK_BISECTION_ITERATIONS = 24;

// (The old DEFAULT_LOOP_BOUND fallback was removed: unrecognized tiers now
// fall back to the medium budget inline at the factory.)

/**
 * Explicit NUMERICAL_FAILURE debug color — dim magenta, never black
 * (AGENTS.md: a plausible-looking frame is not proof; failures must be
 * visibly distinct from the capture shadow).
 */
const NUMERICAL_FAILURE_RGB: readonly [number, number, number] = [0.08, 0.0, 0.08];

/**
 * Step budgets per quality tier. PERFORMANCE CAMPAIGN FINDING: baking the
 * tier bound as the compile-time loop limit froze whatever tier was current
 * at prepare time into the pipeline forever (first boot prepared at 'high',
 * so Low quality silently ran 1024-step rays). The Loop bound is therefore
 * the MAXIMUM tier budget and the ACTUAL per-frame budget is the uMaxSteps
 * uniform, which the destination updates when the governor changes tier —
 * no recompile, live adaptation (SHADER_CONTRACTS §13 still holds: no
 * unbounded iterations).
 */
const QUALITY_TIER_STEP_BUDGETS: Record<QualityTier, number> = {
  low: 256,
  medium: 512,
  high: 1024,
  ultra: 2048
};

/** Compile-time hard ceiling of the integration loop (ultra budget). */
const MAX_COMPILE_LOOP_BOUND = QUALITY_TIER_STEP_BUDGETS.ultra;

// ---------------------------------------------------------------------------
// Public uniform-block documentation
// ---------------------------------------------------------------------------

/**
 * Full uniform block of the lensing material, grouped per
 * docs/SHADER_CONTRACTS.md §2 (CameraGpuParams / BlackHoleGpuParams /
 * DiskGpuParams / IntegratorGpuParams / VisualGpuParams subsets actually
 * consumed by this pass).
 *
 * Scalar entries are the live uniform NODE objects themselves — writing
 * `uniforms.maxSteps.value = n` reaches the shader (repo lesson: never
 * snapshot a scalar into `uniform(...)`). Vector entries own a THREE.Vector3
 * that the shader references by identity, so `.value.set(...)` updates in
 * place.
 *
 * Units: positions/bases are r_g-native world vectors; tanHalfFovY/aspect are
 * dimensionless; baseStep/minStep/maxStep and captureEpsilon are in units of
 * M (matching cpuReference.PhotonIntegrationOptions); escapeRadiusRg,
 * disk radii and centerRg are absolute r_g lengths.
 */
export interface SchwarzschildIntegratorUniforms {
  // --- CameraGpuParams (orthonormal basis; SHADER_CONTRACTS §2) ---
  /** Observer position relative to the SCENE origin, r_g units. */
  cameraPositionRg: { value: Vector3 };
  cameraRight: { value: Vector3 };
  cameraUp: { value: Vector3 };
  cameraForward: { value: Vector3 };
  /** tan(fovY / 2) > 0. */
  tanHalfFovY: { value: number };
  /** width / height > 0. */
  aspect: { value: number };

  // --- BlackHoleGpuParams ---
  /** Mass in geometric units r_g = GM/c^2 (> 0); horizon at 2*massRg. */
  massRg: { value: number };
  /** Black-hole center in world r_g coordinates (WORLD_FRAME §1: default origin). */
  centerRg: { value: Vector3 };

  // --- DiskGpuParams (normal is FIXED to world +Y per WORLD_FRAME §1) ---
  /** 1 when the thin disk shades contributions, 0 otherwise. */
  diskEnabled: { value: number };
  diskInnerRg: { value: number };
  diskOuterRg: { value: number };

  // --- IntegratorGpuParams (steps in units of M; see header) ---
  /** Early-exit step budget, clamped to [1, compile-time tier bound]. */
  maxSteps: { value: number };
  /** Base RK4 step at r >> 10M before radius scaling. */
  baseStep: { value: number };
  /** Global lower step bound. */
  minStep: { value: number };
  /** Global upper step bound. */
  maxStep: { value: number };
  /** Conservative escape radius, absolute r_g (NM §10.3). */
  escapeRadiusRg: { value: number };
  /** Capture band half-width ABOVE the horizon, in units of M (NM §10.1). */
  captureEpsilon: { value: number };

  // --- VisualGpuParams ---
  /** Linear multiplier on sampled environment radiance (escaped rays). */
  backgroundIntensity: { value: number }; /**
   * Debug view selector (0 = physical radiance, >= 0.5 = parity view).
   * Parity view: ESCAPED rays output the terminal tetrad-projected escape
   * direction encoded as `dir * 0.5 + 0.5` in LINEAR space — directly
   * comparable against `cpuReference.integratePhoton().finalDirection` under
   * a linear display chain (exposure 1, bloom off, 'linear' tone mapping);
   * CAPTURED stays pure black and failures stay failure-magenta so class
   * agreement is assertable in the same frame. Debug tooling only — never a
   * cinematic/scientific presentation.
   */
  debugMode: { value: number };

  // --- ObserverFrameGpuParams (M10, OBSERVER_FRAME_ADR §5) ---
  /** Tetrad legs U (=u^mu) and A1..A3 (spatial legs), BL contravariant. */
  observerLegU: { value: Vector4 };
  observerLegA1: { value: Vector4 };
  observerLegA2: { value: Vector4 };
  observerLegA3: { value: Vector4 };
  /** World-space directions of the three spatial tetrad legs. */
  observerLegW1: { value: Vector3 };
  observerLegW2: { value: Vector3 };
  observerLegW3: { value: Vector3 };
  /** 1 when the M10 observer block drives ray initialization. */
  observerActive: { value: number };
  /** 1 when shading must scale the legacy emitter factor by 1/E_ray. */
  observerFrequencyComoving: { value: number };
}

/** Return shape of {@link createLensingMaterial} (consumer-locked additive superset). */
export interface SchwarzschildLensingMaterial {
  /** TSL node material rendering the fullscreen-triangle lensing pass. */
  material: NodeMaterial;
  /** Live uniform block; see {@link SchwarzschildIntegratorUniforms}. */
  uniforms: SchwarzschildIntegratorUniforms;
  /** Applies whitelisted state keys; unknown keys ignored silently. */
  setUniformsFromState(state: Record<string, unknown>): void;
  /** Disposes the locally-owned geometry and material. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Defensive state coercion helpers
// ---------------------------------------------------------------------------

/**
 * Number()-coerces a state entry and requires finiteness; wrong-typed values
 * (objects, arrays, undefined, symbolic strings) yield null and are ignored.
 */
function readFiniteNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string' && typeof raw !== 'boolean') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** Reads a vec4 as a 4-number array; null when malformed/non-finite. */
function readVec4Components(raw: unknown): [number, number, number, number] | null {
  if (Array.isArray(raw)) {
    if (raw.length !== 4) return null;
    const c = [Number(raw[0]), Number(raw[1]), Number(raw[2]), Number(raw[3])];
    return c.every(Number.isFinite) ? (c as [number, number, number, number]) : null;
  }
  return null;
}

/** Reads a vec3 as a 3-number array or {x,y,z}; null when malformed/non-finite. */
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
 * Builds the full-screen Schwarzschild lensing NodeMaterial:
 * camera-ray reconstruction -> geodesic-plane reduction (NM §3) -> fixed-step
 * RK4 over the planar Hamiltonian (NM §4/§8) with event classification
 * (NM §10) -> environment sampling on escape, additive thin-disk emission
 * with circular-emitter redshift (NM §15/§16) -> linear HDR color (§11).
 *
 * The pinned environment/disk collaborators are used verbatim:
 * `createEnvironmentSamplerNode(makeStarfieldParams())` for escaped rays and
 * `makeDiskEmissionNode(...)` for disk contributions.
 */
export function createLensingMaterial(params: LensingPassParams): SchwarzschildLensingMaterial {
  const stepBudget = QUALITY_TIER_STEP_BUDGETS[params.qualityTier] ?? 512;
  const safeMassRg = Number.isFinite(params.massRg) && params.massRg > 0 ? params.massRg : 1;

  // Scalar uniform NODES first, exposed through the block afterwards, so that
  // later `uniforms.field.value = x` writes reach the shader (repo lesson).
  const uTanHalfFovY = uniform(1);
  const uAspect = uniform(1);
  const uMassRg = uniform(safeMassRg);
  const uDiskEnabled = uniform(params.diskEnabled ? 1 : 0);
  const uDiskInnerRg = uniform(Number.isFinite(params.diskInnerRg) ? params.diskInnerRg : 6);
  const uDiskOuterRg = uniform(Number.isFinite(params.diskOuterRg) ? params.diskOuterRg : 20);
  const uMaxSteps = uniform(stepBudget);
  // Base step in units of M. Sized so a ray from a typical observer
  // distance (~10-20M) reaches the strong-field region within a fraction of
  // the LOW tier budget: curvature-induced error at r > ~6M scales as (M/r)^2
  // per unit length, so long STRAIGHTISH approach legs tolerate large h;
  // resolution where it matters comes from the horizon floor below plus the
  // bounded photon-sphere refinement.
  const uBaseStep = uniform(0.3);
  const uMinStep = uniform(0.001);
  const uMaxStep = uniform(100);
  const uEscapeRadiusRg = uniform(1000);
  // Capture epsilon in units of M. 1e-4 (the CPU reference value) is
  // unreachable within GPU tier step budgets because of the horizon
  // coordinate stall; the f<1e-3 floor condition in the loop is the primary
  // capture path and this epsilon stays as the outer band.
  const uCaptureEpsilon = uniform(0.01);
  const uBackgroundIntensity = uniform(1);
  const uDebugMode = uniform(0);

  // --- M10 observer-frame block (OBSERVER_FRAME_ADR §5) ---
  const uObserverActive = uniform(0);
  const uObserverFrequencyComoving = uniform(0);

  const uniforms: SchwarzschildIntegratorUniforms = {
    cameraPositionRg: { value: new Vector3() },
    cameraRight: { value: new Vector3() },
    cameraUp: { value: new Vector3() },
    cameraForward: { value: new Vector3() },
    tanHalfFovY: uTanHalfFovY,
    aspect: uAspect,
    massRg: uMassRg,
    centerRg: { value: new Vector3() },
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
    debugMode: uDebugMode,
    observerLegU: { value: new Vector4() },
    observerLegA1: { value: new Vector4() },
    observerLegA2: { value: new Vector4() },
    observerLegA3: { value: new Vector4() },
    observerLegW1: { value: new Vector3() },
    observerLegW2: { value: new Vector3() },
    observerLegW3: { value: new Vector3() },
    observerActive: uObserverActive,
    observerFrequencyComoving: uObserverFrequencyComoving
  };

  // Vector uniforms reference the SAME Vector3 instances stored in the block,
  // so `.value.set(...)` mutates what the shader sees (pass-by-reference).
  const uCamPos = uniform(uniforms.cameraPositionRg.value);
  const uRight = uniform(uniforms.cameraRight.value);
  const uUp = uniform(uniforms.cameraUp.value);
  const uForward = uniform(uniforms.cameraForward.value);
  const uCenter = uniform(uniforms.centerRg.value);
  const uActiveF = uniform(uniforms.observerActive.value);
  const uComovingF = uniform(uniforms.observerFrequencyComoving.value);
  const uLegU = uniform(uniforms.observerLegU.value);
  const uLegA1 = uniform(uniforms.observerLegA1.value);
  const uLegA2 = uniform(uniforms.observerLegA2.value);
  const uLegA3 = uniform(uniforms.observerLegA3.value);
  const uW1 = uniform(uniforms.observerLegW1.value);
  const uW2 = uniform(uniforms.observerLegW2.value);
  const uW3 = uniform(uniforms.observerLegW3.value);

  // Pinned collaborators (contracts owned by concurrent modules).
  const sampleEnvironment = createEnvironmentSamplerNode(makeStarfieldParams());
  const diskModel: DiskModelParams = {
    innerRadiusRg: params.diskInnerRg,
    outerRadiusRg: params.diskOuterRg,
    emissivityIndex: 1.5,
    temperatureScale: 1,
    densityScale: 1,
    turbulence: 0.35,
    seed: 0x9e3779b9
  };
  validateDiskModelParams(diskModel);
  const diskEmission = makeDiskEmissionNode(diskModel);

  // --- Fullscreen-triangle vertex stage (pattern of src/shaders/diagnostic.ts).
  const positionAttr = attribute<'vec3'>('position', 'vec3');
  const vX = varying(positionAttr.x);
  const vY = varying(positionAttr.y);

  // --- World-ray reconstruction; NDC convention of src/shaders/cameraRayMath.ts
  // --- (+x right, +y up, pixel-center exact): dir = normalize(forward +
  // --- right*x*tanHalfFovY*aspect + up*y*tanHalfFovY).
  // M10: this is the pixel direction in the CAMERA frame; when the physical
  // observer block is active the camera supplies only LOOK orientation and
  // the photon's world direction comes from the observer tetrad legs (the
  // local components n are identical — legs A1/A2/A3 ARE right/up/forward).
  const legacyRayDir = normalize(
    uForward.add(uRight.mul(vX.mul(uTanHalfFovY).mul(uAspect))).add(uUp.mul(vY.mul(uTanHalfFovY)))
  );

  // ---------------------------------------------------------------------------
  // Schwarzschild initial state — mirrors cpuReference.integratePhoton (NM §2/§3/§7)
  // ---------------------------------------------------------------------------

  const relPos = uCamPos.sub(uCenter);
  const r0 = length(relPos);
  const denomFloor = float(DENOM_FLOOR);
  const e0 = relPos.div(max(r0, denomFloor)); // radial plane axis (guarded normalize)
  const f0 = float(1).sub(uMassRg.mul(2).div(max(r0, denomFloor)));
  const f0Safe = max(f0, denomFloor); // §14 division-by-f guard

  // --- M10 observer-frame photon initialization (OBSERVER_FRAME_ADR §5) ---
  const obsNx = vX.mul(uTanHalfFovY).mul(uAspect);
  const obsNy = vY.mul(uTanHalfFovY);
  const obsNz = float(1);
  const obsLen = sqrt(obsNx.mul(obsNx).add(obsNy.mul(obsNy)).add(obsNz.mul(obsNz)));
  const nxO = obsNx.div(obsLen);
  const nyO = obsNy.div(obsLen);
  const nzO = obsNz.div(obsLen);
  // Photon world direction: sum of leg world directions weighted by the
  // LOCAL components (legs are orthonormal in the observer rest frame).
  const observerWorldDir = normalize(uW1.mul(nxO).add(uW2.mul(nyO)).add(uW3.mul(nzO)));
  // Conserved energy E = -k_t = f * k^t with k^t = U_t + sum n_a A_a,t.
  const obsKT = uLegU.x.add(nxO.mul(uLegA1.x)).add(nyO.mul(uLegA2.x)).add(nzO.mul(uLegA3.x));
  const obsEnergy = f0.mul(obsKT); // g_tt = -f on Schwarzschild
  const activeF = uActiveF.greaterThan(0.5);
  // Comoving frequency convention scales the legacy emitter factor by
  // nu_obs / E_ray with nu_obs = 1 by construction (ADR §6). Static/camera
  // keep the exact legacy value (multiplier 1).
  const energyMultiplier = select(
    uComovingF.greaterThan(0.5),
    float(1).div(max(tslAbs(obsEnergy), denomFloor)),
    float(1)
  );
  // Pixels whose traced photon cannot reach infinity (E <= 0 under a moving
  // observer) have no stationary image: truthful INVALID, never a fake sky.
  const observerValidGate = select(
    activeF,
    select(obsEnergy.greaterThan(denomFloor), float(1), float(0)),
    float(1)
  );
  const rayDir = select(activeF, observerWorldDir, legacyRayDir);

  const nRadial = dot(rayDir, e0);
  const tangent = rayDir.sub(e0.mul(nRadial)); // tangential component (unnormalized)
  const tangential = length(tangent);
  const radialEps = float(RADIAL_EPSILON);
  const isRadial = tangential.lessThan(radialEps); // dedicated radial path selector (NM §13)
  const e1 = tangent.div(max(tangential, radialEps)); // unit only when !isRadial
  // E-normalized constants of motion (NM §4 rescaling): L stores b = L/E.
  const angularMomentum = select(isRadial, float(0), r0.mul(tangential).div(sqrt(f0Safe)));
  // p_r(E=1) = n_r / f (NM §7 scaled by 1/E; cpuReference parity).
  const prInitial = nRadial.div(f0Safe);
  // Plane normal N = normalize(e0 x e1); placeholder +Y on the radial path
  // where L = 0 makes b_z vanish regardless (NM §13).
  const planeNormal = select(isRadial, vec3(0, 1, 0), normalize(cross(e0, e1)));
  // Axial impact parameter b_z = L * dot(N, worldUp); derivation in header.
  const bzImpact = angularMomentum.mul(planeNormal.y);

  // Horizon capture radius (2 + captureEpsilon) * M, cpuReference §10.1 parity.
  const captureRadius = uMassRg.mul(2).add(uCaptureEpsilon.mul(uMassRg));

  // Degenerate cameras (inside capture band, at the center, or non-finite
  // radius) route to INVALID_INITIAL_STATE instead of integrating (§10.4).
  // WebGL2 safety (9a152f6 defect class): no and()/or() IsolateNode chains —
  // conditions compose as products of flat 0/1 gates (same idiom as the
  // coordinate-stall capture below).
  const initValid = select(r0.greaterThan(captureRadius), float(1), float(0))
    .mul(select(r0.lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
    .mul(select(f0.greaterThan(0), float(1), float(0)))
    .mul(observerValidGate)
    .greaterThan(0.5);

  // ---------------------------------------------------------------------------
  // Integrator sub-graphs (geometry only — SHADER_CONTRACTS §5)
  // ---------------------------------------------------------------------------

  /**
   * Planar Hamiltonian RHS (NM §4, E = 1):
   *   dr/dlambda   = f * p_r
   *   dphi/dlambda = L / r^2
   *   dp_r/dlambda = -0.5*f'/f^2 - 0.5*f'*p_r^2 + L^2/r^3,  f' = 2M/r^2
   * Denominator floors are §14 guards; capture fires before they bind.
   */
  const planeDerivativesFn = Fn(([rIn, prIn]: [unknown, unknown]): Vec3Node => {
    const r = max(float(rIn as FloatNode), denomFloor);
    const f = float(1).sub(uMassRg.mul(2).div(r));
    const fPrime = uMassRg.mul(2).div(r.mul(r));
    const fSafe = max(f, denomFloor);
    const pr = float(prIn as FloatNode);
    const dr = f.mul(pr);
    const dphi = angularMomentum.div(r.mul(r));
    const dpr = float(-0.5)
      .mul(fPrime.div(fSafe.mul(fSafe)))
      .sub(float(0.5).mul(fPrime).mul(pr.mul(pr)))
      .add(angularMomentum.mul(angularMomentum).div(r.mul(r).mul(r)));
    return vec3(dr, dphi, dpr);
  });

  /** One classical RK4 step (NM §8.1): (r, phi, p_r) -> (r', phi', p_r'). */
  const rk4StepFn = Fn(
    ([rIn, phiIn, prIn, hIn]: [unknown, unknown, unknown, unknown]): Vec3Node => {
      const r = float(rIn as FloatNode);
      const phi = float(phiIn as FloatNode);
      const pr = float(prIn as FloatNode);
      const h = float(hIn as FloatNode);
      const halfH = h.mul(0.5);
      const d1 = planeDerivativesFn(r, pr);
      const d2 = planeDerivativesFn(r.add(halfH.mul(d1.x)), pr.add(halfH.mul(d1.z)));
      const d3 = planeDerivativesFn(r.add(halfH.mul(d2.x)), pr.add(halfH.mul(d2.z)));
      const d4 = planeDerivativesFn(r.add(h.mul(d3.x)), pr.add(h.mul(d3.z)));
      const sixthH = h.mul(1 / 6);
      return vec3(
        r.add(sixthH.mul(d1.x.add(d2.x.mul(2)).add(d3.x.mul(2)).add(d4.x))),
        phi.add(sixthH.mul(d1.y.add(d2.y.mul(2)).add(d3.y.mul(2)).add(d4.y))),
        pr.add(sixthH.mul(d1.z.add(d2.z.mul(2)).add(d3.z.mul(2)).add(d4.z)))
      );
    }
  );

  /** World re-embedding of the planar state (NM §3/§14). */
  const embedWorldFn = Fn(([rIn, phiIn]: [unknown, unknown]): Vec3Node => {
    const r = max(float(rIn as FloatNode), float(0));
    const phi = float(phiIn as FloatNode);
    const c = cos(phi);
    const s = sin(phi);
    const planar = r.mul(c.mul(e0).add(s.mul(e1)));
    const radial = r.mul(e0);
    return uCenter.add(select(isRadial, radial, planar));
  });

  /**
   * Terminal local static-observer direction (cpuReference.localDirection
   * mirror): tetrad-project the coordinate velocity (v_r, v_t) = (f*p_r, L/r)
   * back to orthonormal components and re-express in world axes.
   */
  const escapeDirectionFn = Fn(([rIn, phiIn, prIn]: [unknown, unknown, unknown]): Vec3Node => {
    const r = max(float(rIn as FloatNode), denomFloor);
    const phi = float(phiIn as FloatNode);
    const pr = float(prIn as FloatNode);
    const f = max(float(1).sub(uMassRg.mul(2).div(r)), denomFloor);
    const vr = f.mul(pr);
    const vt = angularMomentum.div(r);
    const norm = sqrt(max(vr.mul(vr).div(f).add(vt.mul(vt)), float(1e-12)));
    const nR = vr.div(sqrt(f).mul(norm));
    const nT = vt.div(norm);
    const c = cos(phi);
    const s = sin(phi);
    const radialDir = e0.mul(select(nR.greaterThanEqual(0), float(1), float(-1)));
    const planarDir = nR.mul(c.mul(e0).add(s.mul(e1))).add(nT.mul(c.mul(e1).sub(s.mul(e0))));
    return normalize(select(isRadial, radialDir, planarDir));
  });

  // ---------------------------------------------------------------------------
  // Fragment graph
  // ---------------------------------------------------------------------------

  const fragmentGraph = Fn((): Vec4Node => {
    // Status starts INVALID so a skipped integration can never look like a
    // valid black pixel (SHADER_CONTRACTS §6 codes).
    const status = int(RAY_INVALID_INITIAL_STATE).toVar();
    // Accumulated linear-HDR radiance: disk contributions + escaped sky.
    const radiance = vec3(0).toVar();
    // Terminal tetrad-projected escape direction (§9): assigned at the end of
    // a valid integration, consumed by environment shading AND the debug
    // parity encoding in the output assembly (both need it at Fn scope).
    const escapedDirection = vec3(0).toVar();

    If(initValid, () => {
      status.assign(int(RAY_ACTIVE));

      const r = r0.toVar();
      const phi = float(0).toVar();
      const pr = prInitial.toVar();
      // Segment-start snapshots for crossing detection/refinement (§10.2).
      const rPrev = float(0).toVar();
      const phiPrev = float(0).toVar();

      // Compile-time bound from the quality tier; the uniform budget below
      // exits earlier when configured (SHADER_CONTRACTS §13).
      Loop(MAX_COMPILE_LOOP_BOUND, ({ i }) => {
        If(float(i).greaterThanEqual(uMaxSteps), () => {
          status.assign(int(RAY_MAX_STEPS));
          Break();
        });

        // --- Step-size policy (NM §9 QUALITY heuristic, not error control).
        // Matches the validated CPU reference policy (cpuReference
        // stepSizeAt): far field grows like r^1.5 beyond 10M, horizon factor
        // shrinks towards 2M with a 0.02 floor, clamped to [minStep,maxStep]
        // scaled by M. (An earlier GPU-only extra shrink near the photon
        // sphere multiplied winding-ray cost several-fold and pushed
        // near-critical rays over the step budget — visible as a failure-
        // colored ring around the shadow in first runtime validation. The
        // CPU-validated policy is used verbatim instead.)
        const farScale = pow(max(r.div(uMassRg.mul(10)), float(1)), float(1.5));
        const nearScale = min(float(1), max(r.sub(uMassRg.mul(2)).div(uMassRg), float(0.02)));
        const h = clamp(
          uBaseStep.mul(uMassRg).mul(farScale).mul(nearScale),
          uMinStep.mul(uMassRg),
          uMaxStep.mul(uMassRg)
        );

        rPrev.assign(r);
        phiPrev.assign(phi);
        const next = rk4StepFn(r, phi, pr, h);
        r.assign(next.x);
        phi.assign(next.y);
        pr.assign(next.z);

        // --- Non-finite proxy (§14): |x| >= 1e30 OR NaN (fails strict <).
        // Flat gate arithmetic: fires iff any finite-gate is zero.
        If(
          select(r.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0))
            .mul(select(pr.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .mul(select(phi.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .lessThan(0.5),
          () => {
            status.assign(int(RAY_NON_FINITE));
            Break();
          }
        );

        // --- Thin-disk crossing (disk normal = world +Y, WORLD_FRAME §1):
        // signed height sign change between consecutive segment endpoints,
        // evaluated on the CURVED trajectory via re-embedding — never a flat
        // Euclidean camera-ray test (NM §10.2). Runs before capture/escape so
        // a crossing on the terminal segment still contributes.
        If(uDiskEnabled.greaterThan(0.5), () => {
          const segStart = embedWorldFn(rPrev, phiPrev);
          const segEnd = embedWorldFn(r, phi);
          const hStart = segStart.y.sub(uCenter.y);
          const hEnd = segEnd.y.sub(uCenter.y);

          If(hStart.mul(hEnd).lessThan(0), () => {
            // Fixed-count bisection over the segment parameter s in [0, 1]
            // against the linearly interpolated planar state (header
            // disclosure: interpolation refinement per NM §10.2).
            const lo = float(0).toVar();
            const hi = float(1).toVar();
            Loop(DISK_BISECTION_ITERATIONS, () => {
              const mid = lo.add(hi).mul(0.5);
              const probe = embedWorldFn(mix(rPrev, r, mid), mix(phiPrev, phi, mid));
              const hProbe = probe.y.sub(uCenter.y);
              If(hStart.mul(hProbe).greaterThan(0), () => {
                lo.assign(mid);
              }).Else(() => {
                hi.assign(mid);
              });
            });

            const sCross = lo.add(hi).mul(0.5);
            const rHit = mix(rPrev, r, sCross);
            const phiHit = mix(phiPrev, phi, sCross);

            // Accept only inside the annulus (NM §10.2); flat gate product
            // for WebGL2 safety (no and()/or() nodes).
            If(
              select(rHit.greaterThanEqual(uDiskInnerRg), float(1), float(0))
                .mul(select(rHit.lessThanEqual(uDiskOuterRg), float(1), float(0)))
                .greaterThan(0.5),
              () => {
                // Circular-equatorial-emitter frequency ratio (NM §15/§16),
                // GPU mirror of accretionDisk.diskRedshiftFactor:
                //   u^t = 1/sqrt(1 - 3M/r), Omega = sqrt(M/r^3),
                //   g = 1 / (u^t * (1 - Omega*b_z))
                // with b_z derived in the module header. Guards mirror the
                // CPU fn: no circular orbit for r <= 3M; denominator must be
                // positive or the emitter state is unreachable/invisible.
                const orbitArg = float(1).sub(uMassRg.mul(3).div(max(rHit, denomFloor)));
                const ut = float(1).div(sqrt(max(orbitArg, denomFloor)));
                const omega = sqrt(uMassRg.div(pow(max(rHit, denomFloor), 3)));
                const dopplerDenom = float(1).sub(omega.mul(bzImpact));
                // Gate as a flat 0/1 product; the denominator is floored through
                // the same gate so BOTH select arms stay finite (a raw mix would
                // smear NaN from the dead arm into radiance).
                const gValid = select(orbitArg.greaterThan(0), float(1), float(0)).mul(
                  select(dopplerDenom.greaterThan(0), float(1), float(0))
                );
                const dopplerDenomSafe = max(dopplerDenom.mul(gValid), denomFloor);
                // M10 comoving-observer convention (OBSERVER_FRAME_ADR §6):
                // scale the legacy distant-astronomer factor by nu_obs/E_ray
                // (nu_obs = 1 by tetrad construction). The multiplier is
                // exactly 1 for the legacy camera/static paths — bit-stable
                // historical output.
                const gFactor = select(
                  gValid.greaterThan(0.5),
                  float(1).div(ut.mul(dopplerDenomSafe)),
                  float(0)
                ).mul(energyMultiplier);
                // emit() applies the g^3 Liouville transform INTERNALLY (its
                // contract) — pass raw g, never re-multiply (NM §17).
                const emitted = diskEmission.emit({
                  r: rHit,
                  gFactor,
                  phi: phiHit
                }) as Vec3Node;
                // Additive accumulation: higher-order images emerge naturally
                // because integration continues after every crossing.
                radiance.addAssign(emitted);
              }
            );
          });
        });

        // --- Horizon capture (NM §10.1), priority over escape.
        // --- Horizon capture (NM §10.1 + coordinate-stall resolution) ---
        // Two capture conditions:
        //  1. r <= (2 + captureEpsilon) * M  (cpuReference §10.1 parity), or
        //  2. f = 1 - 2M/r < 1e-3 while still infalling (pr < 0).
        // Condition 2 resolves the COORDINATE STALL of these (t,r)-coordinates:
        // dr/dlambda = f * pr shrinks proportionally to f, so with a bounded
        // step budget a ray can spend its whole allowance crawling through the
        // last ~1e-3 M above the horizon without ever reaching the epsilon
        // band (this is exactly what the first runtime validation showed as a
        // purple failure disc where the shadow belongs). Geodesically, a ray
        // inside f < 1e-3 is already inside the photon-capture region for
        // every practical purpose; the shadow-boundary error introduced is
        // orders of magnitude below a pixel at any sane viewport.
        If(r.lessThanEqual(captureRadius), () => {
          status.assign(int(RAY_CAPTURED));
          Break();
        });
        // Coordinate-stall capture (branch-free gate, see note above):
        // captured iff pr < 0 AND f = 1 - 2M/r < 1e-3.
        If(
          select(pr.lessThan(0), float(1), float(0))
            .mul(
              select(
                float(1)
                  .sub(uMassRg.mul(2).div(max(r, uMassRg)))
                  .lessThan(1e-3),
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
          select(r.greaterThan(uEscapeRadiusRg), float(1), float(0))
            .mul(select(pr.greaterThan(0), float(1), float(0)))
            .greaterThan(0.5),
          () => {
            status.assign(int(RAY_ESCAPED));
            Break();
          }
        );
      });

      // Budget >= compile-time bound without an event: exhausted (§10.4).
      If(status.equal(int(RAY_ACTIVE)), () => {
        status.assign(int(RAY_MAX_STEPS));
      });

      // Terminal tetrad-projected escape direction (§9): pure math on the
      // terminal r/phi/pr, computed for every valid terminal state so both
      // the environment sampling and the debug-parity encoding below can
      // consume it without branch-dependent definitions.
      escapedDirection.assign(escapeDirectionFn(r, phi, pr));

      // Escape shading: sample the procedural environment along the terminal
      // tetrad-projected direction, scaled by the visual intensity (§9/§11).
      If(status.equal(int(RAY_ESCAPED)), () => {
        const skyRadiance = sampleEnvironment(escapedDirection) as Vec3Node;
        radiance.addAssign(skyRadiance.mul(uBackgroundIntensity));
      });
    });

    // Debug parity encoding (uDebugMode >= 0.5): ESCAPED rays output the
    // terminal tetrad-projected escape direction mapped to [0,1]^3 instead of
    // environment radiance. Flat gate mix (WebGL2 safety — no select() on
    // whole-output branches beyond the mandated class split above).
    const debugMix = select(uDebugMode.greaterThanEqual(0.5), float(1), float(0));
    const escapedOutput = mix(radiance, escapedDirection.mul(0.5).add(0.5), debugMix) as Vec3Node;

    // Output assembly (linear HDR, §11): captured -> photon-capture BLACK
    // (the shadow); escaped -> accumulated disk light + environment (or the
    // parity encoding when uDebugMode is set); every other terminal code
    // (ACTIVE/MAX_STEPS/NON_FINITE/INVALID) -> explicit NUMERICAL_FAILURE
    // magenta, never black (AGENTS.md honesty rule).
    return vec4(
      select(
        status.equal(int(RAY_CAPTURED)),
        vec3(0, 0, 0),
        select(status.equal(int(RAY_ESCAPED)), escapedOutput, vec3(...NUMERICAL_FAILURE_RGB))
      ),
      float(1)
    );
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
     * diskEnabled, diskInnerRg, diskOuterRg, maxSteps, baseStep, minStep,
     * maxStep, escapeRadiusRg, captureEpsilon, backgroundIntensity,
     * debugMode). Unknown keys are ignored silently; wrong-typed values fail
     * the finite coercion and are ignored defensively.
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
      if (outer !== null && outer > 0) uDiskOuterRg.value = outer;

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
      const legU = readVec4Components(state['observerLegU']);
      if (legU) uniforms.observerLegU.value.set(legU[0], legU[1], legU[2], legU[3]);
      const legA1 = readVec4Components(state['observerLegA1']);
      if (legA1) uniforms.observerLegA1.value.set(legA1[0], legA1[1], legA1[2], legA1[3]);
      const legA2 = readVec4Components(state['observerLegA2']);
      if (legA2) uniforms.observerLegA2.value.set(legA2[0], legA2[1], legA2[2], legA2[3]);
      const legA3 = readVec4Components(state['observerLegA3']);
      if (legA3) uniforms.observerLegA3.value.set(legA3[0], legA3[1], legA3[2], legA3[3]);
      const legW1 = readVec3Components(state['observerLegW1']);
      if (legW1) uniforms.observerLegW1.value.set(legW1[0], legW1[1], legW1[2]);
      const legW2 = readVec3Components(state['observerLegW2']);
      if (legW2) uniforms.observerLegW2.value.set(legW2[0], legW2[1], legW2[2]);
      const legW3 = readVec3Components(state['observerLegW3']);
      if (legW3) uniforms.observerLegW3.value.set(legW3[0], legW3[1], legW3[2]);
      const obsActive = readFiniteNumber(state['observerActive']);
      if (obsActive !== null) uObserverActive.value = obsActive;
      const comoving = readFiniteNumber(state['observerFrequencyComoving']);
      if (comoving !== null) uObserverFrequencyComoving.value = comoving;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    }
  };
}
