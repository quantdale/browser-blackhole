/**
 * Neutron-star surface-lensing material — Schwarzschild backwards ray tracing
 * terminating on the MATERIAL stellar surface (M12-NS).
 *
 * Spec sources implemented here (do not drift without updating docs):
 * - openspec/changes/m12-neutron-star-surface-lensing/design.md
 *     §3   neutron-star-local outcomes; black-hole stable codes 0..6 are NOT
 *          renumbered — this pass uses its OWN documented packing below;
 *     §3.1 material-surface crossing refined on the accepted segment BEFORE
 *          any would-be horizon logic (the star body blocks that region);
 *     §4   architecture B: formulation-for-formulation mirror of the validated
 *          black-hole integrator structure, never an edit of it;
 *     §7   surface emission/hot spots evaluated AT THE GEODESIC HIT COORDINATE
 *          (normal = normalized refined hit), never the straight-line sphere;
 *     §8   deterministic debug surface for tests (parity pixel encoding).
 * - docs/NUMERICAL_METHODS.md §2/§3/§4/§9/§10.3/§13/§14: tetrad ray init,
 *   plane reduction, E-normalized RK4, radius-aware step policy, conservative
 *   escape, dedicated radial path, bounded-magnitude non-finite proxies.
 * - docs/SHADER_CONTRACTS.md §2 (camera param group), §5 (geometry-only
 *   integration steps), §6 (stable classification discipline), §11 (linear
 *   HDR output), §13 (compile-time bounded loop), §14 (guards).
 *
 * Reuse mirrors cpuReference.integratePhoton / schwarzschildIntegrator.ts:
 *   tetrad init -> planar RK4 (same RHS/RK4/step-policy formulas) ->
 *   NS-local event policy -> destination shading.
 *
 * Neutron-star-local classification packing (design.md §3 mandate; values are
 * deliberately disjoint from the black-hole 0..6 family):
 *   11 NS_SURFACE_HIT   12 NS_ESCAPED   13 NS_NUMERICAL_FAILURE
 *   14 NS_INVALID_INITIAL_STATE
 *
 * Honest approximations / disclosures:
 * - Fixed-step RK4 with the SAME QUALITY step heuristic as the black-hole
 *   production pass (NM §9 wording): NOT error-controlled. Tier budget ladder
 *   mirrors the black-hole values; the NS workload terminates earlier on the
 *   material surface, so effective cost is lower at equal settings.
 * - Surface-crossing refinement bisects the segment parameter s in [0, 1]
 *   over a LINEAR interpolation of the planar state (r, phi) — the exact
 *   method of the validated disk-crossing path (NM §10.2 interpolation
 *   option). Fixed 24 iterations; accuracy bounded by intra-segment
 *   curvature; validated against the binary64 reference (unit suite measures
 *   < 1e-9 r_g on radial hits at reference settings).
 * - Static gravitational redshift g = sqrt(1 - 2 r_g/R) is computed on the
 *   CPU (physics.ts convention) and applied as a scalar multiplier here.
 *   Doppler/aberration/frame dragging remain deliberately omitted.
 * - Escaped rays sample the pinned procedural starfield along the terminal
 *   tetrad-projected direction (same collaborator as the black-hole pass).
 * - Loop-exhausted / invalid / non-finite rays render explicit dim magenta —
 *   NEVER black — so numerical failure cannot masquerade as shadow or sky.
 */

import { BufferGeometry, Float32BufferAttribute, NodeMaterial, Vector3 } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  attribute,
  clamp,
  cos,
  dot,
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
  smoothstep,
  sqrt,
  uniform,
  varying,
  vec3,
  vec4
} from 'three/tsl';
import type { QualityTier } from '../../atlas/types.js';
import { createEnvironmentSamplerNode } from '../../shaders/starfieldGpu.js';
import { makeStarfieldParams } from '../../shaders/starfield.js';

// ---------------------------------------------------------------------------
// Local node aliases (boundary casts; mirrors schwarzschildIntegrator style)
// ---------------------------------------------------------------------------

type FloatNode = Node<'float'>;
type Vec3Node = Node<'vec3'>;
type Vec4Node = Node<'vec4'>;

// ---------------------------------------------------------------------------
// Module constants
// ---------------------------------------------------------------------------

/** NS-local classification packing (see header; disjoint from BH 0..6). */
export const NS_RAY_SURFACE_HIT = 11;
export const NS_RAY_ESCAPED = 12;
export const NS_RAY_NUMERICAL_FAILURE = 13;
export const NS_RAY_INVALID_INITIAL_STATE = 14;

/**
 * Tangential magnitude below which a ray takes the dedicated radial path
 * (NM §13); mirrors the CPU reference branch point.
 */
const RADIAL_EPSILON = 1e-12;

/** Floor for denominators (f, r, roots) — SHADER_CONTRACTS §14 guard. */
const DENOM_FLOOR = 1e-6;

/** Magnitude bound of the non-finite proxy (SHADER_CONTRACTS §14). */
const FINITE_MAGNITUDE_BOUND = 1e30;

/** Fixed bisection count for surface-crossing refinement (NM §10.2 method). */
const SURFACE_BISECTION_ITERATIONS = 24;

/**
 * Explicit NUMERICAL_FAILURE debug color — dim magenta, never black
 * (AGENTS.md honesty rule; mirrors the black-hole pass).
 */
const NUMERICAL_FAILURE_RGB: readonly [number, number, number] = [0.08, 0.0, 0.08];

/**
 * Step budgets per quality tier — deliberate mirror of the black-hole ladder
 * (local copy: the two destinations tune independently; SHADER_CONTRACTS §13
 * compile-bound + live uniform early-exit pattern is preserved).
 */
const NS_QUALITY_TIER_STEP_BUDGETS: Record<QualityTier, number> = {
  low: 256,
  medium: 512,
  high: 1024,
  ultra: 2048
};

/** Compile-time hard ceiling of the integration loop (ultra budget). */
const NS_MAX_COMPILE_LOOP_BOUND = NS_QUALITY_TIER_STEP_BUDGETS.ultra;

/**
 * Live per-frame step budget for a quality tier (the destination passes this
 * through `maxSteps`; the shader hard-clamps to the compile-time bound).
 */
export function nsQualityTierStepBudget(tier: QualityTier): number {
  return NS_QUALITY_TIER_STEP_BUDGETS[tier] ?? NS_QUALITY_TIER_STEP_BUDGETS.medium;
}

// ---------------------------------------------------------------------------
// Uniform block
// ---------------------------------------------------------------------------

/**
 * Full uniform block of the neutron-star surface pass. Scalars are live
 * uniform NODE objects (write `.value`); vectors hold THREE.Vector3 by
 * reference (mutate via `.value.set`). Units: camera position is r_g-native
 * RELATIVE TO THE STAR CENTER (the module converts scene kilometres once);
 * basis vectors are unit world directions; tanHalfFovY/aspect dimensionless;
 * surfaceRadiusRg absolute r_g; step inputs in units of M.
 */
export interface NeutronStarSurfaceUniforms {
  // --- CameraGpuParams ---
  cameraPositionRg: { value: Vector3 };
  cameraRight: { value: Vector3 };
  cameraUp: { value: Vector3 };
  cameraForward: { value: Vector3 };
  tanHalfFovY: { value: number };
  aspect: { value: number };

  // --- NeutronStarGpuParams (destination-local group) ---
  /** Mass in geometric units (> 0); horizon at 2*massRg. */
  massRg: { value: number };
  /** Material surface radius, absolute r_g (> 2*massRg enforced CPU-side). */
  surfaceRadiusRg: { value: number };

  // --- IntegratorGpuParams (steps in units of M) ---
  maxSteps: { value: number };
  baseStep: { value: number };
  minStep: { value: number };
  maxStep: { value: number };
  /** Conservative escape radius, absolute r_g (NM §10.3). */
  escapeRadiusRg: { value: number };

  // --- VisualGpuParams ---
  backgroundIntensity: { value: number };
  /**
   * Debug view selector (>= 0.5 = parity view): SURFACE_HIT outputs the unit
   * hit normal encoded n*0.5+0.5; ESCAPED outputs the terminal tetrad
   * direction d*0.5+0.5; failures stay failure-magenta. LINEAR space —
   * directly comparable against surfaceRayReference under exposure 1 /
   * bloom off / linear tone mapping. Debug tooling only.
   */
  debugMode: { value: number };

  // --- Emission params (mirrors the retired mesh color graph exactly) ---
  surfaceTint: { value: Vector3 };
  emissionScale: { value: number };
  redshiftFactor: { value: number };
  flareBoost: { value: number };
  slotA: SpotUniforms;
  slotB: SpotUniforms;
}

interface SpotUniforms {
  /** World-frame spot direction; Vector3 held BY REFERENCE and mutated. */
  direction: { value: Vector3 };
  cosAngularRadius: { value: number };
  tint: { value: Vector3 };
  gain: { value: number };
}

function createSlotUniformBlock(): SpotUniforms {
  return {
    direction: { value: new Vector3(0, 1, 0) },
    cosAngularRadius: { value: 0.99 },
    tint: { value: new Vector3(1, 1, 1) },
    gain: { value: 0 }
  };
}

/** Softness of the hot-spot rim (cosine-space angular smoothing). */
const SPOT_EDGE_SOFTNESS = 0.02;

/** Return shape of {@link createNeutronStarSurfaceMaterial}. */
export interface NeutronStarSurfaceMaterial {
  material: NodeMaterial;
  /** Local fullscreen-triangle geometry (consumers build their own mesh). */
  geometry: BufferGeometry;
  uniforms: NeutronStarSurfaceUniforms;
  /** Applies whitelisted state keys; unknown/wrong-typed keys ignored. */
  setUniformsFromState(state: Record<string, unknown>): void;
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Defensive state coercion helpers (mirrors schwarzschildIntegrator)
// ---------------------------------------------------------------------------

function readFiniteNumber(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string' && typeof raw !== 'boolean') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function readVec3Components(raw: unknown): [number, number, number] | null {
  if (Array.isArray(raw)) {
    if (raw.length !== 3) return null;
    const c = [Number(raw[0]), Number(raw[1]), Number(raw[2])];
    return c.every(Number.isFinite) ? (c as [number, number, number]) : null;
  }
  return null;
}

function applySpotState(slot: SpotUniforms, raw: Record<string, unknown> | undefined): void {
  if (!raw) return;
  const dir = readVec3Components(raw['direction']);
  if (dir) slot.direction.value.set(dir[0], dir[1], dir[2]);
  const cosR = readFiniteNumber(raw['cosAngularRadius']);
  if (cosR !== null) slot.cosAngularRadius.value = Math.min(1, Math.max(-1, cosR));
  const tint = readVec3Components(raw['tint']);
  if (tint) slot.tint.value.set(tint[0], tint[1], tint[2]);
  const gain = readFiniteNumber(raw['gain']);
  if (gain !== null) slot.gain.value = gain;
}

// ---------------------------------------------------------------------------
// Material factory
// ---------------------------------------------------------------------------

/**
 * Builds the fullscreen neutron-star surface NodeMaterial: camera-ray
 * reconstruction -> geodesic-plane reduction -> RK4 over the planar
 * Hamiltonian -> material-surface termination with refinement -> emission at
 * the geodesic hit coordinate OR starfield sample on escape -> linear HDR.
 */
export function createNeutronStarSurfaceMaterial(params: {
  qualityTier: QualityTier;
  massRg?: number;
  surfaceRadiusRg?: number;
}): NeutronStarSurfaceMaterial {
  const stepBudget =
    NS_QUALITY_TIER_STEP_BUDGETS[params.qualityTier] ?? NS_QUALITY_TIER_STEP_BUDGETS.medium;
  const safeMass = Number.isFinite(params.massRg) && params.massRg! > 0 ? params.massRg! : 1;
  const safeSurface =
    Number.isFinite(params.surfaceRadiusRg) && params.surfaceRadiusRg! > 2 * safeMass
      ? params.surfaceRadiusRg!
      : 5.8;

  // Scalar uniform NODES first so later `.value` writes reach the shader.
  const uTanHalfFovY = uniform(1);
  const uAspect = uniform(1);
  const uMassRg = uniform(safeMass);
  const uSurfaceRg = uniform(safeSurface);
  const uMaxSteps = uniform(stepBudget);
  const uBaseStep = uniform(0.3);
  const uMinStep = uniform(0.001);
  const uMaxStep = uniform(100);
  const uEscapeRadiusRg = uniform(128);
  const uBackgroundIntensity = uniform(1);
  const uDebugMode = uniform(0);

  // Emission block (mirrors the retired mesh graph's uniform semantics).
  const uSurfaceTint = uniform(new Vector3(1, 1, 1));
  const uEmissionScale = uniform(1);
  const uRedshiftFactor = uniform(1);
  const uFlareBoost = uniform(1);

  const uniforms: NeutronStarSurfaceUniforms = {
    cameraPositionRg: { value: new Vector3() },
    cameraRight: { value: new Vector3() },
    cameraUp: { value: new Vector3() },
    cameraForward: { value: new Vector3() },
    tanHalfFovY: uTanHalfFovY,
    aspect: uAspect,
    massRg: uMassRg,
    surfaceRadiusRg: uSurfaceRg,
    maxSteps: uMaxSteps,
    baseStep: uBaseStep,
    minStep: uMinStep,
    maxStep: uMaxStep,
    escapeRadiusRg: uEscapeRadiusRg,
    backgroundIntensity: uBackgroundIntensity,
    debugMode: uDebugMode,
    surfaceTint: uSurfaceTint,
    emissionScale: uEmissionScale,
    redshiftFactor: uRedshiftFactor,
    flareBoost: uFlareBoost,
    slotA: createSlotUniformBlock(),
    slotB: createSlotUniformBlock()
  };

  // Vector uniforms reference the SAME instances stored in the block.
  const uCamPos = uniform(uniforms.cameraPositionRg.value);
  const uRight = uniform(uniforms.cameraRight.value);
  const uUp = uniform(uniforms.cameraUp.value);
  const uForward = uniform(uniforms.cameraForward.value);
  const uSlotADir = uniform(uniforms.slotA.direction.value);
  const uSlotACos = uniform(uniforms.slotA.cosAngularRadius.value);
  const uSlotATint = uniform(uniforms.slotA.tint.value);
  const uSlotAGain = uniform(uniforms.slotA.gain.value);
  const uSlotBDir = uniform(uniforms.slotB.direction.value);
  const uSlotBCos = uniform(uniforms.slotB.cosAngularRadius.value);
  const uSlotBTint = uniform(uniforms.slotB.tint.value);
  const uSlotBGain = uniform(uniforms.slotB.gain.value);
  const uTint = uniform(uniforms.surfaceTint.value);

  // Pinned collaborator: procedural celestial environment (escaped rays).
  // Same collaborator instance pattern as the black-hole pass.
  const sampleEnvironment = createEnvironmentSamplerNode(makeStarfieldParams()) as (
    dir: Vec3Node
  ) => Vec3Node;

  // --- Fullscreen-triangle vertex stage (pattern of src/shaders/diagnostic.ts).
  const positionAttr = attribute<'vec3'>('position', 'vec3');
  const vX = varying(positionAttr.x);
  const vY = varying(positionAttr.y);

  // World-ray reconstruction (+x right, +y up, pixel-center exact).
  const rayDir = normalize(
    uForward.add(uRight.mul(vX.mul(uTanHalfFovY).mul(uAspect))).add(uUp.mul(vY.mul(uTanHalfFovY)))
  );

  // ---------------------------------------------------------------------------
  // Initial state — mirrors cpuReference.integratePhoton (NM §2/§3/§7)
  // ---------------------------------------------------------------------------

  const r0 = length(uCamPos);
  const denomFloor = float(DENOM_FLOOR);
  const e0 = uCamPos.div(max(r0, denomFloor)); // guarded normalize
  const f0 = float(1).sub(uMassRg.mul(2).div(max(r0, denomFloor)));
  const f0Safe = max(f0, denomFloor);

  const nRadial = dot(rayDir, e0);
  const tangent = rayDir.sub(e0.mul(nRadial));
  const tangential = length(tangent);
  const radialEps = float(RADIAL_EPSILON);
  const isRadial = tangential.lessThan(radialEps); // NM §13 selector
  const e1 = tangent.div(max(tangential, radialEps));

  // Conserved quantities (NM §2/§7, E-normalized): b = L/E = r|n_t|/sqrt(f),
  // p_r(E=1) = n_r / f. Bit-for-bit the legacy static-camera formulas.
  const angularMomentum = select(isRadial, float(0), r0.mul(tangential).div(sqrt(f0Safe)));
  const prInitial = nRadial.div(f0Safe);

  // Degenerate cameras route to INVALID instead of integrating (§10.4):
  // origin must sit OUTSIDE both the surface and the horizon, all finite.
  const outerBound = max(uSurfaceRg, uMassRg.mul(2)).add(denomFloor);
  const initValid = select(r0.greaterThan(outerBound), float(1), float(0))
    .mul(select(r0.lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
    .mul(select(f0.greaterThan(0), float(1), float(0)))
    .greaterThan(0.5);

  // ---------------------------------------------------------------------------
  // Integrator sub-graphs (geometry only — SHADER_CONTRACTS §5)
  // ---------------------------------------------------------------------------

  /** Planar Hamiltonian RHS (NM §4, E = 1) — same formulas as cpuReference. */
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

  /** One classical RK4 step (NM §8.1). */
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

  /** World embedding of the planar state (star centered at the origin). */
  const embedWorldFn = Fn(([rIn, phiIn]: [unknown, unknown]): Vec3Node => {
    const r = max(float(rIn as FloatNode), float(0));
    const phi = float(phiIn as FloatNode);
    const c = cos(phi);
    const s = sin(phi);
    const radial = r.mul(e0);
    const planar = r.mul(c.mul(e0).add(s.mul(e1)));
    return select(isRadial, radial, planar);
  });

  /**
   * Terminal local static-observer direction (cpuReference.localDirection
   * mirror): tetrad-project the coordinate velocity back to orthonormal
   * components and re-express in world axes.
   */
  const escapeDirectionFn = Fn(([rIn, phiIn, prIn]: [unknown, unknown, unknown]): Vec3Node => {
    const r = max(float(rIn as FloatNode), denomFloor);
    const phi = float(phiIn as FloatNode);
    const pr = float(prIn as FloatNode);
    const f = max(float(1).sub(uMassRg.mul(2).div(r)), denomFloor);
    const vr = f.mul(pr);
    const vt = angularMomentum.div(r);
    const normV = sqrt(max(vr.mul(vr).div(f).add(vt.mul(vt)), float(1e-12)));
    const nR = vr.div(sqrt(f).mul(normV));
    const nT = vt.div(normV);
    const c = cos(phi);
    const s = sin(phi);
    const radialDir = e0.mul(select(nR.greaterThanEqual(0), float(1), float(-1)));
    const planarDir = nR.mul(c.mul(e0).add(s.mul(e1))).add(nT.mul(c.mul(e1).sub(s.mul(e0))));
    return normalize(select(isRadial, radialDir, planarDir));
  });

  /**
   * Surface emission evaluated AT THE GEODESIC HIT COORDINATE (design.md §7):
   * normal = normalize(hit position); base graybody term plus two unrolled
   * hot-spot slots using the EXACT profile of the retired mesh color graph
   * (TSL smoothstep over [cos-s, cos]); static redshift applied CPU-side
   * through the gain/redshift uniforms.
   */
  const shadeSurfaceFn = Fn(([hitPos]: [unknown]): Vec3Node => {
    const normal = normalize(vec3(hitPos as Vec3Node));
    const base = uTint.mul(uEmissionScale).mul(uRedshiftFactor);
    const dotA = dot(normal, uSlotADir);
    const profileA = smoothstep(uSlotACos.sub(SPOT_EDGE_SOFTNESS), uSlotACos, dotA);
    const glowA = uSlotATint.mul(uSlotAGain).mul(profileA);
    const dotB = dot(normal, uSlotBDir);
    const profileB = smoothstep(uSlotBCos.sub(SPOT_EDGE_SOFTNESS), uSlotBCos, dotB);
    const glowB = uSlotBTint.mul(uSlotBGain).mul(profileB);
    return base.add(glowA).add(glowB).mul(uFlareBoost);
  });

  // ---------------------------------------------------------------------------
  // Fragment graph
  // ---------------------------------------------------------------------------

  const fragmentGraph = Fn((): Vec4Node => {
    // Status starts INVALID so a skipped integration can never look valid.
    const status = int(NS_RAY_INVALID_INITIAL_STATE).toVar();
    const radiance = vec3(0).toVar();
    const debugEncoding = vec3(0).toVar();

    If(initValid, () => {
      status.assign(int(NS_RAY_NUMERICAL_FAILURE));

      const r = r0.toVar();
      const phi = float(0).toVar();
      const pr = prInitial.toVar();
      const rPrev = float(0).toVar();
      const phiPrev = float(0).toVar();

      Loop(NS_MAX_COMPILE_LOOP_BOUND, ({ i }) => {
        If(float(i).greaterThanEqual(uMaxSteps), () => {
          status.assign(int(NS_RAY_NUMERICAL_FAILURE)); // exhausted budget
          Break();
        });

        // Step-size policy (NM §9 QUALITY heuristic; cpuReference mirror).
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

        // Non-finite proxy (§14): |x| >= 1e30 OR NaN fails the strict <.
        If(
          select(r.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0))
            .mul(select(pr.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .mul(select(phi.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .lessThan(0.5),
          () => {
            status.assign(int(NS_RAY_NUMERICAL_FAILURE));
            Break();
          }
        );

        // --- Material-surface event FIRST (openspec design.md §3.1): a
        // segment entering the star refines to the hit and TERMINATES before
        // any would-be horizon logic could bind.
        If(
          select(rPrev.greaterThan(uSurfaceRg), float(1), float(0))
            .mul(select(r.lessThanEqual(uSurfaceRg), float(1), float(0)))
            .greaterThan(0.5),
          () => {
            const lo = float(0).toVar();
            const hi = float(1).toVar();
            Loop(SURFACE_BISECTION_ITERATIONS, () => {
              const mid = lo.add(hi).mul(0.5);
              const rMid = mix(rPrev, r, mid);
              // Bracket condition: prev side stays OUTSIDE the surface.
              If(rMid.greaterThan(uSurfaceRg), () => {
                lo.assign(mid);
              }).Else(() => {
                hi.assign(mid);
              });
            });
            const sCross = lo.add(hi).mul(0.5);
            const rHit = mix(rPrev, r, sCross);
            const phiHit = mix(phiPrev, phi, sCross);
            const hitPos = embedWorldFn(rHit, phiHit);

            status.assign(int(NS_RAY_SURFACE_HIT));
            radiance.assign(shadeSurfaceFn(hitPos));
            debugEncoding.assign(normalize(hitPos).mul(0.5).add(0.5));
            Break();
          }
        );

        // --- Defensive horizon band: unreachable while the surface radius
        // exceeds the horizon margin; kept truthful (failure, never black).
        const captureRadius = uMassRg.mul(2).add(uMassRg.mul(0.001));
        If(r.lessThanEqual(captureRadius), () => {
          status.assign(int(NS_RAY_NUMERICAL_FAILURE));
          Break();
        });

        // --- Conservative escape (NM §10.3): beyond radius AND outward.
        If(
          select(r.greaterThan(uEscapeRadiusRg), float(1), float(0))
            .mul(select(pr.greaterThan(0), float(1), float(0)))
            .greaterThan(0.5),
          () => {
            status.assign(int(NS_RAY_ESCAPED));
            const escapedDirection = escapeDirectionFn(r, phi, pr);
            const skyRadiance = sampleEnvironment(escapedDirection) as Vec3Node;
            radiance.assign(skyRadiance.mul(uBackgroundIntensity));
            debugEncoding.assign(escapedDirection.mul(0.5).add(0.5));
            Break();
          }
        );
      });
    });

    // Debug parity encoding (uDebugMode >= 0.5): swap radiance for the probe
    // encoding — flat gate mix (WebGL2-safe), mirrors the black-hole pass.
    const debugMix = select(uDebugMode.greaterThanEqual(0.5), float(1), float(0));
    const successOutput = mix(radiance, debugEncoding, debugMix) as Vec3Node;

    // Output assembly (linear HDR, §11): SURFACE_HIT/ESCAPED -> shaded output
    // (or parity encoding); everything else -> explicit failure magenta.
    // Nested selects only (WebGL2 safety: no and()/or() IsolateNode chains).
    return vec4(
      select(
        status.equal(int(NS_RAY_SURFACE_HIT)),
        successOutput,
        select(status.equal(int(NS_RAY_ESCAPED)), successOutput, vec3(...NUMERICAL_FAILURE_RGB))
      ),
      float(1)
    );
  });

  const material = new NodeMaterial();
  material.vertexNode = vec4(positionAttr.xy, float(0), float(1));
  material.fragmentNode = fragmentGraph();

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
  );

  let disposed = false;

  return {
    material,
    geometry,
    uniforms,
    setUniformsFromState(state: Record<string, unknown>): void {
      const camPos = readVec3Components(state['cameraPositionRg']);
      if (camPos) uniforms.cameraPositionRg.value.set(camPos[0], camPos[1], camPos[2]);
      const right = readVec3Components(state['cameraRight']);
      if (right) uniforms.cameraRight.value.set(right[0], right[1], right[2]);
      const up = readVec3Components(state['cameraUp']);
      if (up) uniforms.cameraUp.value.set(up[0], up[1], up[2]);
      const forward = readVec3Components(state['cameraForward']);
      if (forward) uniforms.cameraForward.value.set(forward[0], forward[1], forward[2]);

      const tanHalf = readFiniteNumber(state['tanHalfFovY']);
      if (tanHalf !== null && tanHalf > 0) uTanHalfFovY.value = tanHalf;
      const aspectValue = readFiniteNumber(state['aspect']);
      if (aspectValue !== null && aspectValue > 0) uAspect.value = aspectValue;
      const mass = readFiniteNumber(state['massRg']);
      if (mass !== null && mass > 0) uMassRg.value = mass;
      const surface = readFiniteNumber(state['surfaceRadiusRg']);
      if (surface !== null && surface > 2 * Math.max(uMassRg.value, 0)) {
        uSurfaceRg.value = surface;
      }

      const steps = readFiniteNumber(state['maxSteps']);
      if (steps !== null) {
        uMaxSteps.value = Math.min(NS_MAX_COMPILE_LOOP_BOUND, Math.max(1, Math.round(steps)));
      }
      const base = readFiniteNumber(state['baseStep']);
      if (base !== null && base > 0) uBaseStep.value = base;
      const minS = readFiniteNumber(state['minStep']);
      if (minS !== null && minS > 0) uMinStep.value = minS;
      const maxS = readFiniteNumber(state['maxStep']);
      if (maxS !== null && maxS > 0) uMaxStep.value = maxS;
      const escape = readFiniteNumber(state['escapeRadiusRg']);
      if (escape !== null && escape > 0) uEscapeRadiusRg.value = escape;
      const bgInt = readFiniteNumber(state['backgroundIntensity']);
      if (bgInt !== null && bgInt >= 0) uBackgroundIntensity.value = bgInt;
      const debugRaw = readFiniteNumber(state['debugMode']);
      if (debugRaw !== null && debugRaw >= 0) uDebugMode.value = debugRaw;

      const tint = readVec3Components(state['surfaceTint']);
      if (tint) uniforms.surfaceTint.value.set(tint[0], tint[1], tint[2]);
      const emissionScale = readFiniteNumber(state['emissionScale']);
      if (emissionScale !== null && emissionScale >= 0) uEmissionScale.value = emissionScale;
      const redshift = readFiniteNumber(state['redshiftFactor']);
      if (redshift !== null && redshift > 0) uRedshiftFactor.value = redshift;
      const flare = readFiniteNumber(state['flareBoost']);
      if (flare !== null && flare >= 0) uFlareBoost.value = flare;

      applySpotState(uniforms.slotA, state['slotA'] as Record<string, unknown> | undefined);
      applySpotState(uniforms.slotB, state['slotB'] as Record<string, unknown> | undefined);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    }
  };
}
