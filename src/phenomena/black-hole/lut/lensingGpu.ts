/**
 * LUT Schwarzschild lensing material - GPU production path (M8-06, BH-164).
 *
 * Trajectory source is the validated offline family instead of per-pixel RK4.
 * NOT a second renderer: camera-ray reconstruction, geodesic-plane reduction,
 * disk emission, g-factor, environment sampling and HDR output are identical
 * to schwarzschildIntegrator.createLensingMaterial. Only the trajectory query
 * differs:
 *
 *   numerical: per-pixel fixed-step RK4 + segment-crossing bisection
 *   LUT:       analytic classification -> bounded binary-search launch-row
 *              solve on the shared-span table -> disk-plane crossings at the
 *              EXACT zeros of the plane-height sinusoid (u_y(phi)=0 at
 *              phi* + k*pi, ADR section 7) sampled from the bilinear table in
 *              ascending-arc order -> terminal direction from aux (nR,nT).
 *
 * FALLBACK IS EXPLICIT AND VISIBLE: pixels outside LUT representability (x
 * out of domain, inside the measured hybrid band, radial rays, launch-solve
 * failure, non-finite samples) execute an inline copy of the numerical
 * integrator and are TAGGED for the debug status view (uLutDebugStatus >=
 * 0.5): LUT-escaped cyan, LUT-captured black, numerical-resolved orange,
 * failure magenta.
 *
 * DUPLICATION DISCLOSURE: the inline fallback loop mirrors
 * schwarzschildIntegrator's numerics op-for-op rather than sharing graph
 * factories - keeping the certified numerical pass untouched during M8-06.
 * Drift between the copies is pinned by equivalence specs + goldens.
 *
 * Classification is ANALYTIC everywhere (b vs b_c): no texture flag ever
 * decides captured vs escaped (ADR section 6).
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  NodeMaterial,
  Vector2,
  Vector3,
  Vector4
} from 'three/webgpu';
import type { Texture } from 'three';
import type { Node } from 'three/webgpu';
import {
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
  texture,
  uniform,
  varying,
  vec2,
  vec3,
  vec4
} from 'three/tsl';
import type { LensingPassParams, QualityTier } from '../../../atlas/types.js';
import {
  RAY_CAPTURED,
  RAY_ESCAPED,
  RAY_MAX_STEPS,
  RAY_NON_FINITE
} from '../../../physics/schwarzschild.js';
import { createEnvironmentSamplerNode } from '../../../shaders/starfieldGpu.js';
import { makeCinematicStarfieldParams } from '../../../shaders/starfield.js';
import { DEFAULT_AXIS_X } from './domain.js';
import {
  makeDiskEmissionNode,
  validateDiskModelParams,
  type DiskModelParams
} from '../accretionDisk.js';

type FloatNode = Node<'float'>;
type Vec3Node = Node<'vec3'>;
type Vec4Node = Node<'vec4'>;

const RADIAL_EPSILON = 1e-12;
const DENOM_FLOOR = 1e-6;
const FINITE_MAGNITUDE_BOUND = 1e30;
const DISK_BISECTION_ITERATIONS = 24;

const NUMERICAL_FAILURE_RGB: readonly [number, number, number] = [0.08, 0.0, 0.08];

const LAUNCH_SOLVE_ITERATIONS = 15;
export const CROSSING_CANDIDATES = 9;
const CROSSING_K_OFFSET = 4;
const MAX_CROSSINGS = 4;
const MAX_COMPILE_LOOP_BOUND = 2048;

const QUALITY_TIER_STEP_BUDGETS: Record<QualityTier, number> = {
  low: 256,
  medium: 512,
  high: 1024,
  ultra: 2048
};

export const LUT_STATUS_LUT_ESCAPED = 0;
export const LUT_STATUS_LUT_CAPTURED = 1;
export const LUT_STATUS_NUMERICAL_RESOLVED = 2;
export const LUT_STATUS_FAILURE = 3;

export interface LutLensingUniforms {
  cameraPositionRg: { value: Vector3 };
  cameraRight: { value: Vector3 };
  cameraUp: { value: Vector3 };
  cameraForward: { value: Vector3 };
  tanHalfFovY: { value: number };
  aspect: { value: number };
  massRg: { value: number };
  centerRg: { value: Vector3 };
  diskEnabled: { value: number };
  diskInnerRg: { value: number };
  diskOuterRg: { value: number };
  maxSteps: { value: number };
  baseStep: { value: number };
  minStep: { value: number };
  maxStep: { value: number };
  escapeRadiusRg: { value: number };
  captureEpsilon: { value: number };
  backgroundIntensity: { value: number };
  debugMode: { value: number };
  lutEnabled: { value: number };
  lutDebugStatus: { value: number };
}

export interface CreateLutLensingMaterialParams extends LensingPassParams {
  trajectoryTexture: Texture;
  auxTexture: Texture;
  storedSpanRad: number;
  bCriticalRg: number;
  hybridBandHalfWidthX: number;
}

export interface LutLensingMaterial {
  material: NodeMaterial;
  uniforms: LutLensingUniforms;
  /** Additive V2 environment contribution; never changes LUT classification. */
  setEnvironmentDetail(detail: number): void;
  setUniformsFromState(state: Record<string, unknown>): void;
  dispose(): void;
}

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
    if (raw.length !== 3) return null;
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

function readVec2Components(raw: unknown): [number, number] | null {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const c = [Number(raw[0]), Number(raw[1])];
  return c.every(Number.isFinite) ? (c as [number, number]) : null;
}

const K1 = DEFAULT_AXIS_X.xKnots[1] as number;
const K2 = DEFAULT_AXIS_X.xKnots[2] as number;
const K3 = DEFAULT_AXIS_X.xKnots[3] as number;
const U1K = DEFAULT_AXIS_X.uBreakpoints[1] as number;
const U2K = DEFAULT_AXIS_X.uBreakpoints[2] as number;

export function createLutLensingMaterial(
  params: CreateLutLensingMaterialParams
): LutLensingMaterial {
  const stepBudget = QUALITY_TIER_STEP_BUDGETS[params.qualityTier] ?? 512;
  const safeMassRg = Number.isFinite(params.massRg) && params.massRg > 0 ? params.massRg : 1;

  const uTanHalfFovY = uniform(1);
  const uAspect = uniform(1);
  const uMassRg = uniform(safeMassRg);
  const uDiskEnabled = uniform(params.diskEnabled ? 1 : 0);
  const uDiskInnerRg = uniform(Number.isFinite(params.diskInnerRg) ? params.diskInnerRg : 6);
  const uDiskOuterRg = uniform(Number.isFinite(params.diskOuterRg) ? params.diskOuterRg : 18);
  const uMaxSteps = uniform(stepBudget);
  const uBaseStep = uniform(0.3);
  const uMinStep = uniform(0.001);
  const uMaxStep = uniform(100);
  const uEscapeRadiusRg = uniform(1000);
  const uCaptureEpsilon = uniform(0.01);
  const uBackgroundIntensity = uniform(1);
  const uEnvironmentDetail = uniform(0);
  const uTemporalJitterNdc = uniform(new Vector2());
  const uDebugMode = uniform(0);
  const uLutEnabled = uniform(0);
  const uLutDebugStatus = uniform(0);
  // --- M10 observer-frame block (mirrors schwarzschildIntegrator) ---
  const observerLegU = { value: new Vector4() };
  const observerLegA1 = { value: new Vector4() };
  const observerLegA2 = { value: new Vector4() };
  const observerLegA3 = { value: new Vector4() };
  const observerLegW1 = { value: new Vector3() };
  const observerLegW2 = { value: new Vector3() };
  const observerLegW3 = { value: new Vector3() };
  const observerLegWu = { value: new Vector3() };
  const uniforms: LutLensingUniforms = {
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
    lutEnabled: uLutEnabled,
    lutDebugStatus: uLutDebugStatus
  };

  const uCamPos = uniform(uniforms.cameraPositionRg.value);
  // M10 observer-frame graph nodes (pass-by-reference to the block entries).
  const uObserverActiveF = uniform(0);
  const uComovingF = uniform(0);
  const uLegU = uniform(observerLegU.value);
  const uLegA1 = uniform(observerLegA1.value);
  const uLegA2 = uniform(observerLegA2.value);
  const uLegA3 = uniform(observerLegA3.value);
  const uW1 = uniform(observerLegW1.value);
  const uW2 = uniform(observerLegW2.value);
  const uW3 = uniform(observerLegW3.value);
  const uWu = uniform(observerLegWu.value);
  const uRight = uniform(uniforms.cameraRight.value);
  const uUp = uniform(uniforms.cameraUp.value);
  const uForward = uniform(uniforms.cameraForward.value);
  const uCenter = uniform(uniforms.centerRg.value);

  const sampleEnvironment = createEnvironmentSamplerNode(
    makeCinematicStarfieldParams(),
    uEnvironmentDetail
  );
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

  const trajSampler = texture(params.trajectoryTexture);
  const auxSampler = texture(params.auxTexture);
  const spanLit = params.storedSpanRad;
  const bcLit = params.bCriticalRg;
  const bandLit = params.hybridBandHalfWidthX;

  function trajAt(u: FloatNode, v: FloatNode): FloatNode {
    return trajSampler.sample(vec2(u, v)).r as FloatNode;
  }
  function auxAt(u: FloatNode): Vec4Node {
    return auxSampler.sample(vec2(u, 0.5)) as Vec4Node;
  }

  function xToUNode(x: FloatNode): FloatNode {
    const k1 = float(K1);
    const k2 = float(K2);
    const k3 = float(K3);
    const uu1 = float(U1K);
    const uu2 = float(U2K);
    const s1 = x.mul(uu1.div(k1));
    const s2 = uu1.add(x.sub(k1).mul(uu2.sub(uu1)).div(k2.sub(k1)));
    const s3 = uu2.add(x.sub(k2).mul(float(1).sub(uu2)).div(k3.sub(k2)));
    return select(x.lessThan(k1), s1, select(x.lessThan(k2), s2, s3));
  }

  const positionAttr = attribute<'vec3'>('position', 'vec3');
  const vX = varying(positionAttr.x);
  const vY = varying(positionAttr.y);
  const legacyRayDir = normalize(
    uForward
      .add(uRight.mul(vX.add(uTemporalJitterNdc.x).mul(uTanHalfFovY).mul(uAspect)))
      .add(uUp.mul(vY.add(uTemporalJitterNdc.y).mul(uTanHalfFovY)))
  );

  const relPos = uCamPos.sub(uCenter);
  const r0 = length(relPos);
  const denomFloor = float(DENOM_FLOOR);
  const e0 = relPos.div(max(r0, denomFloor));
  const f0 = float(1).sub(uMassRg.mul(2).div(max(r0, denomFloor)));
  const f0Safe = max(f0, denomFloor);

  // --- M10 observer-frame photon initialization (OBSERVER_FRAME_ADR §5) —
  // mirrors schwarzschildIntegrator exactly (shared uniform contract).
  const obsNx = vX.add(uTemporalJitterNdc.x).mul(uTanHalfFovY).mul(uAspect);
  const obsNy = vY.add(uTemporalJitterNdc.y).mul(uTanHalfFovY);
  const obsNz = float(1);
  const obsLen = sqrt(obsNx.mul(obsNx).add(obsNy.mul(obsNy)).add(obsNz.mul(obsNz)));
  const nxO = obsNx.div(obsLen);
  const nyO = obsNy.div(obsLen);
  const nzO = obsNz.div(obsLen);
  // M11 FIX: k = u + sum(n_a A_a) is linear — the photon's world spatial
  // direction is Wu + sum(n_a W_a) (see schwarzschildIntegrator).
  const kWorldRaw = uWu.add(uW1.mul(nxO)).add(uW2.mul(nyO)).add(uW3.mul(nzO)) as Vec3Node;
  const observerWorldDir = normalize(kWorldRaw);
  const obsKT = uLegU.x.add(nxO.mul(uLegA1.x)).add(nyO.mul(uLegA2.x)).add(nzO.mul(uLegA3.x));
  const obsKR = uLegU.y.add(nxO.mul(uLegA1.y)).add(nyO.mul(uLegA2.y)).add(nzO.mul(uLegA3.y));
  const obsEnergy = f0.mul(obsKT);
  const activeF = uObserverActiveF.greaterThan(0.5);
  const energyMultiplier = select(
    uComovingF.greaterThan(0.5),
    float(1).div(max(tslAbs(obsEnergy), denomFloor)),
    float(1)
  );
  const observerValidGate = select(
    activeF,
    select(obsEnergy.greaterThan(denomFloor), float(1), float(0)),
    float(1)
  );
  const rayDir = select(activeF, observerWorldDir, legacyRayDir);

  const nRadial = dot(rayDir, e0);
  const tangent = rayDir.sub(e0.mul(nRadial));
  const tangential = length(tangent);
  const radialEps = float(RADIAL_EPSILON);
  const isRadial = tangential.lessThan(radialEps);
  const e1 = tangent.div(max(tangential, radialEps));
  // Legacy (camera/static): validated static-tetrad direction formulas,
  // preserved BIT-FOR-BIT (locked policy).
  const bLegacy = select(isRadial, float(0), r0.mul(tangential).div(sqrt(f0Safe)));
  const prLegacy = nRadial.div(f0Safe);
  // M11 FIX — moving observers: covariant E-normalized constants (mirrors
  // the numerical pass; see the derivation note there).
  const kTangentialRate = length(kWorldRaw.sub(e0.mul(dot(kWorldRaw, e0))));
  const energySafe = max(tslAbs(obsEnergy), denomFloor);
  const bMoving = select(isRadial, float(0), r0.mul(kTangentialRate).div(energySafe));
  const prMoving = obsKR.div(f0Safe.mul(energySafe));
  const angularMomentum = select(activeF, bMoving, bLegacy);
  const prInitial = select(activeF, prMoving, prLegacy);
  const planeNormal = select(isRadial, vec3(0, 1, 0), normalize(cross(e0, e1)));
  const bzImpact = angularMomentum.mul(planeNormal.y);
  const captureRadius = uMassRg.mul(2).add(uCaptureEpsilon.mul(uMassRg));

  const initValid = select(r0.greaterThan(captureRadius), float(1), float(0))
    .mul(select(r0.lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
    .mul(select(f0.greaterThan(0), float(1), float(0)))
    .mul(observerValidGate)
    .greaterThan(0.5);

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

  const embedWorldFn = Fn(([rIn, phiIn]: [unknown, unknown]): Vec3Node => {
    const r = max(float(rIn as FloatNode), float(0));
    const phi = float(phiIn as FloatNode);
    const planar = r.mul(cos(phi).mul(e0).add(sin(phi).mul(e1)));
    const radial = r.mul(e0);
    return uCenter.add(select(isRadial, radial, planar));
  });

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

  const fragmentGraph = Fn((): Vec4Node => {
    const radiance = vec3(0).toVar();
    const escapedDirection = vec3(0).toVar();
    const rayWasCaptured = float(0).toVar();
    const numStatusOut = int(-1).toVar();
    const statusTag = int(LUT_STATUS_FAILURE).toVar();

    If(initValid, () => {
      statusTag.assign(int(LUT_STATUS_NUMERICAL_RESOLVED));

      // Classification + LUT-eligibility gates (flat 0/1 gate products).
      const xNorm = angularMomentum.div(bcLit);
      const gateDomainLow = select(xNorm.greaterThanEqual(0), float(1), float(0));
      const gateDomainHigh = select(xNorm.lessThanEqual(float(K3)), float(1), float(0));
      const bandDist = xNorm.sub(1).abs();
      const gateBandOut = select(bandDist.greaterThan(bandLit), float(1), float(0));
      const gateEnvelope = select(
        r0.lessThanEqual(uEscapeRadiusRg.mul(1.0000001)),
        float(1),
        float(0)
      );
      const gateNotRadial = select(isRadial, float(0), float(1));
      const gateLutOn = select(uLutEnabled.greaterThanEqual(0.5), float(1), float(0));

      const lutEligible = gateDomainLow
        .mul(gateDomainHigh)
        .mul(gateBandOut)
        .mul(gateEnvelope)
        .mul(gateNotRadial)
        .mul(gateLutOn)
        .greaterThan(0.5);

      // ---- LUT branch ------------------------------------------------------
      const lutResolved = float(0).toVar();
      If(lutEligible, () => {
        const lutFailed = float(0).toVar();
        const lutRadiance = vec3(0).toVar();
        const lutEscapeDir = vec3(0).toVar();

        // Captured-class columns are anchored at r_ref (=64) INBOUND and this
        // family carries no apsis azimuth for them, so the launch-frame ->
        // observer-frame shift needed below is undefined; those pixels are
        // routed to the numerical oracle EXPLICITLY (never a silent mixup).
        const uCol = clamp(xToUNode(xNorm), float(0), float(1)).toVar();
        const aux4 = auxAt(uCol).toVar();
        const arcEnd = aux4.z.toVar();
        const isCaptured = select(aux4.w.lessThan(0), float(1), float(0)).toVar();
        If(isCaptured.greaterThan(0.5), () => {
          lutFailed.assign(1);
        });

        // Launch solve: bounded binary search for v where traj(u,v) crosses
        // the observer radius. Escaping rows are ANCHORED AT APSIS and rise
        // monotonically to the escape-radius crossing / clamp plateau.
        const target = r0.toVar();
        const loV = float(0).toVar();
        const hiV = float(1).toVar();
        Loop(LAUNCH_SOLVE_ITERATIONS, () => {
          const midV = loV.add(hiV).mul(0.5);
          const rMid = trajAt(uCol, midV);
          If(rMid.lessThan(target), () => {
            loV.assign(midV);
          }).Else(() => {
            hiV.assign(midV);
          });
        });
        const launchRow = loV.add(hiV).mul(0.5).mul(spanLit).toVar();

        // FRAME MAPPING (M8 root-cause fix): table rows and aux channels live
        // in LAUNCH coordinates (phi = 0 at the r_ref inbound crossing, apsis
        // at psiApsis), while THIS pass embeds the geodesic plane with
        // phi = 0 AT THE OBSERVER. The inbound observer-sphere crossing sits
        // at launch azimuth (psiApsis - launchRow), so
        //   phiLaunch = phiOurs + (psiApsis - launchRow)
        // and therefore the folded row for an our-frame azimuth is
        //   row = |phiOurs - launchRow|
        // and the outgoing escape crossing happens at our-frame azimuth
        //   phiExit = launchRow + arcEnd.
        // Using psiApsis directly here rotated every LUT-resolved ray by the
        // camera-dependent angle (psiApsis - launchRow), corrupting disk-hit
        // geometry and terminal sky directions for r0 != r_ref cameras.
        const frameO = launchRow.toVar();

        // Solve validity: observer radius must lie inside this ray's tabulated
        // radial range AND inside real data; non-finite reads fail explicitly.
        const rLo = trajAt(uCol, float(0)).toVar();
        const rHi = trajAt(uCol, float(1)).toVar();
        const finiteReads = select(
          select(rLo.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0))
            .mul(select(rHi.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
            .greaterThan(0.5),
          float(1),
          float(0)
        );
        const solveOk = select(target.greaterThan(rLo.add(0.01)), float(1), float(0))
          .mul(select(target.lessThan(rHi), float(1), float(0)))
          .mul(select(launchRow.lessThan(arcEnd), float(1), float(0)))
          .mul(finiteReads)
          .greaterThan(0.5)
          .toVar();

        If(solveOk.not(), () => {
          lutFailed.assign(1);
        });

        // Disk-plane crossings at the exact zeros of the plane-height
        // sinusoid u_y(phi) = cos(phi)*e0.y + sin(phi)*e1.y (observer frame):
        // phi* = atan2(-e0.y, e1.y), candidates phi* + k*pi (ADR section 7);
        // rows fold through the OBSERVER-frame origin (see FRAME MAPPING).
        // The +k*pi sweep makes the atan2 quadrant irrelevant, but the RATIO
        // itself must be -e0.y/e1.y: an earlier e1.y/(-e0.y) version computed
        // the PERPENDICULAR angle (tan psi = -b/a vs tan phi* = -a/b) and
        // transplanted the entire disk image by ~90 degrees per pixel plane.
        const phiStar = e0.y.mul(-1).div(e1.y).atan().toVar();

        // Emission in ascending-arc order: MAX_CROSSINGS selection passes,
        // each scanning all candidates for the smallest row > previous min.
        // EXCLUSION IS BY CANDIDATE AZIMUTH (phiCand), not by row alone: the
        // folded row maps the inbound AND outbound branches to the same value,
        // so a row-only window would (a) re-emit the same crossing on every
        // pass (4x brightness blowup) and (b) drop the legitimate branch
        // partner that shares its row.
        const prevBest = float(-1).toVar();
        const prevBestPhi = float(1e30).toVar();
        Loop(MAX_CROSSINGS, () => {
          const bestS = float(1e30).toVar();
          const bestR = float(0).toVar();
          const bestPhi = float(0).toVar();
          const found = float(0).toVar();
          Loop(CROSSING_CANDIDATES, ({ i }) => {
            const k = float(i).sub(float(CROSSING_K_OFFSET));
            const phiCand = phiStar.add(k.mul(Math.PI));
            const rowCand = select(
              isCaptured.greaterThan(0.5),
              phiCand,
              phiCand.sub(frameO).abs()
            ).toVar();
            const inWindow = select(rowCand.greaterThanEqual(prevBest), float(1), float(0))
              .mul(select(rowCand.lessThanEqual(arcEnd), float(1), float(0)))
              .mul(
                select(phiCand.sub(prevBestPhi).abs().greaterThan(float(1e-4)), float(1), float(0))
              );
            If(inWindow.greaterThan(0.5), () => {
              const rHit = trajAt(uCol, rowCand.div(spanLit)).toVar();
              const finite = select(
                rHit.abs().lessThan(FINITE_MAGNITUDE_BOUND),
                float(1),
                float(0)
              );
              const annulus = select(rHit.greaterThanEqual(uDiskInnerRg), float(1), float(0)).mul(
                select(rHit.lessThanEqual(uDiskOuterRg), float(1), float(0))
              );
              const isBetter = select(rowCand.lessThan(bestS), float(1), float(0));
              If(finite.mul(annulus).mul(isBetter).greaterThan(0.5), () => {
                bestS.assign(rowCand);
                bestR.assign(rHit);
                bestPhi.assign(phiCand);
                found.assign(1);
              });
              If(finite.lessThan(0.5), () => {
                lutFailed.assign(1);
              });
            });
          });
          If(found.greaterThan(0.5).and(lutFailed.equal(0)), () => {
            const orbitArg = float(1).sub(uMassRg.mul(3).div(max(bestR, denomFloor)));
            const ut = float(1).div(sqrt(max(orbitArg, denomFloor)));
            const omega = sqrt(uMassRg.div(pow(max(bestR, denomFloor), 3)));
            const dopplerDenom = float(1).sub(omega.mul(bzImpact));
            const gValid = select(orbitArg.greaterThan(0), float(1), float(0)).mul(
              select(dopplerDenom.greaterThan(0), float(1), float(0))
            );
            const dopplerDenomSafe = max(dopplerDenom.mul(gValid), denomFloor);
            // M10 comoving-observer convention (ADR §6): ×nu_obs/E_ray; exactly
            // 1 for legacy camera/static paths.
            const gFactor = select(
              gValid.greaterThan(0.5),
              float(1).div(ut.mul(dopplerDenomSafe)),
              float(0)
            ).mul(energyMultiplier);
            const emitted = diskEmission.emit({
              r: bestR,
              gFactor,
              phi: bestPhi
            }) as Vec3Node;
            lutRadiance.addAssign(emitted);
            prevBest.assign(bestS);
            prevBestPhi.assign(bestPhi);
          });
        });

        // Terminal state per class.
        If(lutFailed.equal(0), () => {
          lutResolved.assign(1);
          If(isCaptured.greaterThan(0.5), () => {
            statusTag.assign(int(LUT_STATUS_LUT_CAPTURED));
            rayWasCaptured.assign(1);
          }).Else(() => {
            // Outgoing envelope azimuth + reconstructed world direction from
            // aux terminal components (same tetrad projection as numerical),
            // expressed in the OBSERVER frame per FRAME MAPPING above.
            const phiExit = launchRow.add(arcEnd).toVar();
            const cE = cos(phiExit);
            const sE = sin(phiExit);
            const dirWorld = normalize(
              aux4.x.mul(cE.mul(e0).add(sE.mul(e1))).add(aux4.y.mul(cE.mul(e1).sub(sE.mul(e0))))
            );
            lutEscapeDir.assign(dirWorld);
            const skyRadiance = sampleEnvironment(dirWorld) as Vec3Node;
            lutRadiance.addAssign(skyRadiance.mul(uBackgroundIntensity));
            statusTag.assign(int(LUT_STATUS_LUT_ESCAPED));
          });
        });

        radiance.assign(
          select(lutFailed.greaterThan(0.5), vec3(...NUMERICAL_FAILURE_RGB), lutRadiance)
        );
        escapedDirection.assign(lutEscapeDir);
      });

      // ---- numerical path: owns every pixel the LUT did not fully resolve --
      // Runs when LUT is disabled, ineligible, OR failed mid-sample; its
      // results OVERWRITE the LUT contribution entirely (no backend blend).
      const numericalOwns = select(lutResolved.greaterThan(0.5), float(0), float(1)).toVar();

      If(numericalOwns.greaterThan(0.5), () => {
        statusTag.assign(int(LUT_STATUS_NUMERICAL_RESOLVED));
        const numRadiance = vec3(0).toVar();
        const numEscapeDir = vec3(0).toVar();
        const numStatus = int(RAY_MAX_STEPS).toVar();

        If(initValid, () => {
          const r = r0.toVar();
          const phi = float(0).toVar();
          const pr = prInitial.toVar();
          const rPrev = float(0).toVar();
          const phiPrev = float(0).toVar();
          const done = float(0).toVar();

          Loop(MAX_COMPILE_LOOP_BOUND, ({ i }) => {
            If(done.equal(0), () => {
              If(float(i).greaterThanEqual(uMaxSteps), () => {
                done.assign(1);
              });
              If(done.equal(0), () => {
                // CPU-validated step-size heuristic (NM section 9).
                const farScale = pow(max(r.div(uMassRg.mul(10)), float(1)), float(1.5));
                const nearScale = min(
                  float(1),
                  max(r.sub(uMassRg.mul(2)).div(uMassRg), float(0.02))
                );
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

                // Non-finite proxy guard (SHADER_CONTRACTS 14).
                If(
                  select(r.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0))
                    .mul(select(pr.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
                    .mul(select(phi.abs().lessThan(FINITE_MAGNITUDE_BOUND), float(1), float(0)))
                    .lessThan(0.5),
                  () => {
                    numStatus.assign(int(RAY_NON_FINITE));
                    done.assign(1);
                  }
                );

                // Disk crossing via segment bisection (identical to numerical).
                If(done.equal(0), () => {
                  If(uDiskEnabled.greaterThan(0.5), () => {
                    const segStart = embedWorldFn(rPrev, phiPrev);
                    const segEnd = embedWorldFn(r, phi);
                    const hStart = segStart.y.sub(uCenter.y);
                    const hEnd = segEnd.y.sub(uCenter.y);
                    If(hStart.mul(hEnd).lessThan(0), () => {
                      const loB = float(0).toVar();
                      const hiB = float(1).toVar();
                      Loop(DISK_BISECTION_ITERATIONS, () => {
                        const mid = loB.add(hiB).mul(0.5);
                        const probe = embedWorldFn(mix(rPrev, r, mid), mix(phiPrev, phi, mid));
                        const hProbe = probe.y.sub(uCenter.y);
                        If(hStart.mul(hProbe).greaterThan(0), () => {
                          loB.assign(mid);
                        }).Else(() => {
                          hiB.assign(mid);
                        });
                      });
                      const sCross = loB.add(hiB).mul(0.5);
                      const rHit = mix(rPrev, r, sCross);
                      const phiHit = mix(phiPrev, phi, sCross);
                      If(
                        select(rHit.greaterThanEqual(uDiskInnerRg), float(1), float(0))
                          .mul(select(rHit.lessThanEqual(uDiskOuterRg), float(1), float(0)))
                          .greaterThan(0.5),
                        () => {
                          const orbitArg = float(1).sub(uMassRg.mul(3).div(max(rHit, denomFloor)));
                          const ut = float(1).div(sqrt(max(orbitArg, denomFloor)));
                          const omega = sqrt(uMassRg.div(pow(max(rHit, denomFloor), 3)));
                          const dopplerDenom = float(1).sub(omega.mul(bzImpact));
                          const gValid = select(orbitArg.greaterThan(0), float(1), float(0)).mul(
                            select(dopplerDenom.greaterThan(0), float(1), float(0))
                          );
                          const dopplerDenomSafe = max(dopplerDenom.mul(gValid), denomFloor);
                          // M10 comoving-observer convention (ADR §6).
                          const gFactor = select(
                            gValid.greaterThan(0.5),
                            float(1).div(ut.mul(dopplerDenomSafe)),
                            float(0)
                          ).mul(energyMultiplier);
                          const emitted = diskEmission.emit({
                            r: rHit,
                            gFactor,
                            phi: phiHit
                          }) as Vec3Node;
                          numRadiance.addAssign(emitted);
                        }
                      );
                    });
                  });
                });

                // Capture (priority) then conservative escape.
                // Two capture conditions (identical to original integrator):
                // 1. r <= (2 + captureEpsilon) * M
                // 2. Coordinate stall: f < 1e-3 while infalling (pr < 0)
                If(done.equal(0), () => {
                  If(r.lessThanEqual(captureRadius), () => {
                    numStatus.assign(int(RAY_CAPTURED));
                    rayWasCaptured.assign(1);
                    done.assign(1);
                  });
                });
                If(done.equal(0), () => {
                  If(
                    select(pr.lessThan(0), float(1), float(0))
                      .mul(
                        select(
                          float(1)
                            .sub(uMassRg.mul(2).div(max(r, uMassRg)))
                            .lessThan(float(1e-3)),
                          float(1),
                          float(0)
                        )
                      )
                      .greaterThan(0.5),
                    () => {
                      numStatus.assign(int(RAY_CAPTURED));
                      rayWasCaptured.assign(1);
                      done.assign(1);
                    }
                  );
                });
                If(done.equal(0), () => {
                  If(
                    select(pr.greaterThan(0), float(1), float(0))
                      .mul(select(r.greaterThan(uEscapeRadiusRg), float(1), float(0)))
                      .greaterThan(0.5),
                    () => {
                      numStatus.assign(int(RAY_ESCAPED));
                      done.assign(1);
                    }
                  );
                });
              });
            });
          });

          numEscapeDir.assign(escapeDirectionFn(r, phi, pr));
          If(numStatus.equal(int(RAY_ESCAPED)), () => {
            const skyRadiance = sampleEnvironment(numEscapeDir) as Vec3Node;
            numRadiance.addAssign(skyRadiance.mul(uBackgroundIntensity));
          });
        });

        // Failure pixels stay failure-magenta even in radiance view.
        If(
          select(numStatus.equal(int(RAY_MAX_STEPS)), float(1), float(0))
            .add(select(numStatus.equal(int(RAY_NON_FINITE)), float(1), float(0)))
            .greaterThan(0.5),
          () => {
            numRadiance.assign(vec3(...NUMERICAL_FAILURE_RGB));
          }
        );

        radiance.assign(numRadiance);
        escapedDirection.assign(numEscapeDir);
        numStatusOut.assign(numStatus);
        statusTag.assign(int(LUT_STATUS_NUMERICAL_RESOLVED));
      });
    });

    // ---- output assembly --------------------------------------------------
    // Status-based selection (identical to original integrator):
    //   captured -> ALWAYS pure black (no debug encoding)
    //   escaped  -> parity encoding when debugMode=1, radiance otherwise
    //   other    -> failure magenta
    // Capture covers BOTH backends through rayWasCaptured (LUT captured class
    // AND numerical horizon/stall capture): a captured ray must never leak
    // accumulated disk light or the debug-parity encoding. Escape is
    // LUT-escaped or numerical RAY_ESCAPED; everything else (init-invalid,
    // MAX_STEPS, NON_FINITE) is failure magenta, matching the reference.
    const debugMixLegacy = select(uDebugMode.greaterThanEqual(0.5), float(1), float(0));
    const escapedOutput = mix(
      radiance,
      escapedDirection.mul(0.5).add(0.5),
      debugMixLegacy
    ) as Vec3Node;

    const escapedOut = select(
      statusTag.equal(int(LUT_STATUS_LUT_ESCAPED)),
      float(1),
      select(numStatusOut.equal(int(RAY_ESCAPED)), float(1), float(0))
    ).greaterThan(0.5);

    const physicalRgb = select(
      rayWasCaptured.greaterThan(0.5),
      vec3(0, 0, 0),
      select(escapedOut, escapedOutput, vec3(...NUMERICAL_FAILURE_RGB))
    ) as Vec3Node;

    const statusColor = select(
      statusTag.equal(int(LUT_STATUS_LUT_ESCAPED)),
      vec3(0.0, 0.7, 1.0),
      select(
        statusTag.equal(int(LUT_STATUS_LUT_CAPTURED)),
        vec3(0.0, 0.0, 0.0),
        select(
          statusTag.equal(int(LUT_STATUS_NUMERICAL_RESOLVED)),
          vec3(1.0, 0.45, 0.0),
          vec3(1.0, 0.0, 1.0)
        )
      )
    ) as Vec3Node;
    const statusMix = select(uLutDebugStatus.greaterThanEqual(0.5), float(1), float(0));
    const finalRgb = mix(physicalRgb, statusColor, statusMix) as Vec3Node;

    return vec4(finalRgb, float(1));
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
    uniforms,
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
      const environmentDetail = readFiniteNumber(state['environmentDetail']);
      if (environmentDetail !== null && environmentDetail >= 0) {
        uEnvironmentDetail.value = Math.min(1, environmentDetail);
      }
      const jitter = readVec2Components(state['temporalJitterNdc']);
      if (jitter) uTemporalJitterNdc.value.set(jitter[0], jitter[1]);
      const debugRaw = readFiniteNumber(state['debugMode']);
      if (debugRaw !== null && debugRaw >= 0) uDebugMode.value = debugRaw;

      // --- M10 observer-frame block ---
      const legU = readVec4Components(state['observerLegU']);
      if (legU) observerLegU.value.set(legU[0], legU[1], legU[2], legU[3]);
      const legA1v = readVec4Components(state['observerLegA1']);
      if (legA1v) observerLegA1.value.set(legA1v[0], legA1v[1], legA1v[2], legA1v[3]);
      const legA2v = readVec4Components(state['observerLegA2']);
      if (legA2v) observerLegA2.value.set(legA2v[0], legA2v[1], legA2v[2], legA2v[3]);
      const legA3v = readVec4Components(state['observerLegA3']);
      if (legA3v) observerLegA3.value.set(legA3v[0], legA3v[1], legA3v[2], legA3v[3]);
      const legW1v = readVec3Components(state['observerLegW1']);
      if (legW1v) observerLegW1.value.set(legW1v[0], legW1v[1], legW1v[2]);
      const legW2v = readVec3Components(state['observerLegW2']);
      if (legW2v) observerLegW2.value.set(legW2v[0], legW2v[1], legW2v[2]);
      const legW3v = readVec3Components(state['observerLegW3']);
      if (legW3v) observerLegW3.value.set(legW3v[0], legW3v[1], legW3v[2]);
      const legWuv = readVec3Components(state['observerLegWu']);
      if (legWuv) observerLegWu.value.set(legWuv[0], legWuv[1], legWuv[2]);
      const obsActiveV = readFiniteNumber(state['observerActive']);
      if (obsActiveV !== null) uObserverActiveF.value = obsActiveV;
      const comovingV = readFiniteNumber(state['observerFrequencyComoving']);
      if (comovingV !== null) uComovingF.value = comovingV;
      const lutGate = readFiniteNumber(state['lutEnabled']);
      if (lutGate !== null && lutGate >= 0) uLutEnabled.value = lutGate;
      const lutDbg = readFiniteNumber(state['lutDebugStatus']);
      if (lutDbg !== null && lutDbg >= 0) uLutDebugStatus.value = lutDbg;
    },
    setEnvironmentDetail(detail: number): void {
      uEnvironmentDetail.value = Number.isFinite(detail) ? Math.min(1, Math.max(0, detail)) : 0;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      geometry.dispose();
      material.dispose();
    }
  };
}
