/**
 * Stellar Explosion bipolar jet / Long-GRB mode (CA4-06 GRB track).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 3 ("Long GRB
 *   mode: bipolar narrow relativistic jet visualization; viewing angle
 *   control; on-axis/off-axis brightness behavior; jet is not a spherical
 *   flash");
 * - mission sections 31/32/33 (engine morphology, collimated bipolar jet,
 *   geometric on/off-axis distinction — never a single flat multiplier);
 * - docs/cosmic-atlas/RENDERING_SERVICES.md section 5 (ribbon/jet visual
 *   guidance; batched structures only).
 *
 * DISCLOSED APPROXIMATIONS:
 * - The jet is a kinematic emission pattern: a smooth double-cone density
 *   factor whose front advances at beta x c after engine ignition. It is NOT
 *   a relativistic MHD outflow and claims no baryon-loading or photospheric
 *   physics.
 * - {@link viewingResponse} is a Doppler-beaming-INSPIRED contrast factor
 *   delta^3 evaluated with an effective gamma derived from the velocity
 *   proxy, CLAMPED to a bounded illustrative range. It produces the correct
 *   qualitative "on-axis blazes, off-axis fades" behavior without claiming
 *   radiative-transfer accuracy.
 * - On-axis vs off-axis differ GEOMETRICALLY (cone solid angle + axial
 *   profile), not by a scalar brightness toggle.
 *
 * Purity: pure functions; no wall clock, no randomness.
 */

import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import { abs, dot, length, max, min, smoothstep, uniform, vec3 } from 'three/tsl';

import type { ResolvedScenario } from './types.js';

/** Illustrative clamp range for the beaming-inspired response factor. */
export const VIEWING_RESPONSE_MIN = 0.05;
export const VIEWING_RESPONSE_MAX = 50;

// ---------------------------------------------------------------------------
// Axis frame
// ---------------------------------------------------------------------------

export interface JetBasis {
  /** Unit-length jet axis. */
  readonly axis: THREE.Vector3;
  /** First orthonormal transverse direction. */
  readonly u: THREE.Vector3;
  /** Second orthonormal transverse direction (axis x u). */
  readonly v: THREE.Vector3;
}

/**
 * Orthonormal frame around the (normalized) jet axis. Deterministic helper
 * selection mirrors ParticleService's disc-basis construction so both
 * services agree for the same axis vector. Degenerate inputs fall back to
 * the +Y axis rather than throwing (renderer paths must never crash).
 */
export function jetAxisBasis(axis: readonly [number, number, number]): JetBasis {
  const a = new THREE.Vector3(axis[0], axis[1], axis[2]);
  if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.z)) {
    a.set(0, 1, 0);
  }
  if (a.lengthSq() < 1e-12) a.set(0, 1, 0);
  a.normalize();

  const helper = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(helper, a).normalize();
  const v = new THREE.Vector3().crossVectors(a, u);
  return { axis: a, u, v };
}

// ---------------------------------------------------------------------------
// Jet front kinematics
// ---------------------------------------------------------------------------

/**
 * Jet-front length (scene units) at simulation time `tSeconds`. Exactly zero
 * before the engine ignition phase begins (the collapsar engine does not
 * exist yet — mission section 36 phase gating); afterwards the front
 * advances linearly at beta x c in scene units/s. ILLUSTRATIVE kinematics:
 * no drilling/cocoon physics is modeled.
 *
 * `ignitionSeconds` is the simulation-clock second at which the engine turns
 * on (timeline segment boundary supplied by the destination module).
 */
export function jetFrontUnits(
  tSeconds: number,
  ignitionSeconds: number,
  resolved: ResolvedScenario
): number {
  if (!Number.isFinite(tSeconds) || !Number.isFinite(ignitionSeconds)) return 0;
  const dt = tSeconds - ignitionSeconds;
  if (dt <= 0) return 0;
  const r = resolved.jet.velocityUnitsS * dt;
  return Number.isFinite(r) ? r : 0;
}

// ---------------------------------------------------------------------------
// Bipolar cone density factor (CPU reference form)
// ---------------------------------------------------------------------------

/** Cone-profile sharpness exponent (fixed, disclosed). */
const CONE_SHARPNESS = 2;

/**
 * Multiplicative jet emission factor at world point p, in [0, 1]:
 * - zero outside the bipolar cone (half-opening angle respected: negligible
 *   beyond ~1.5x the half-angle due to the Gaussian-squared profile);
 * - axially confined to [headFadeStart, Rj] along +- axis with a soft tip
 *   fade over the last FRACTION_TIP of the front length;
 * - strongest near the axis, fading smoothly to the cone edge.
 */
export function jetDensityFactor(
  px: number,
  py: number,
  pz: number,
  tSeconds: number,
  ignitionSeconds: number,
  resolved: ResolvedScenario
): number {
  const front = jetFrontUnits(tSeconds, ignitionSeconds, resolved);
  if (front <= 0) return 0;

  // Axial coordinate along the unit axis.
  const ax = px * resolved.axis[0] + py * resolved.axis[1] + pz * resolved.axis[2];
  const axialAbs = Math.abs(ax);
  if (axialAbs <= 1e-9 || axialAbs > front) return 0;

  // Perpendicular distance from the axis.
  const perpX = px - ax * resolved.axis[0];
  const perpY = py - ax * resolved.axis[1];
  const perpZ = pz - ax * resolved.axis[2];
  const perp = Math.hypot(perpX, perpY, perpZ);

  // Cone profile: Gaussian in (angle / halfAngle)^2 -> ~0 beyond ~1.5 half-
  // angles while remaining C1-smooth on-axis.
  const angle = Math.atan2(perp, axialAbs);
  const ratio = angle / resolved.jet.halfOpeningAngleRad;
  const cone = Math.exp(-Math.min(ratio * ratio, 25) * CONE_SHARPNESS);

  // Tip fade over the last quarter of the drilled length.
  const tipStart = front * 0.75;
  const tip =
    1 - Math.min(Math.max((axialAbs - tipStart) / Math.max(front - tipStart, 1e-9), 0), 1);

  const value = cone * tip;
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

// ---------------------------------------------------------------------------
// Viewing-angle response (beaming-inspired contrast)
// ---------------------------------------------------------------------------

/**
 * Doppler-beaming-inspired observer response for the jet, delta^3 with
 * effective gamma from the velocity proxy, clamped to
 * [{@link VIEWING_RESPONSE_MIN}, {@link VIEWING_RESPONSE_MAX}].
 *
 * At beta = 0.95: on-axis delta ~ 12.5 -> clamped response 50 (saturated),
 * at 90 degrees delta = 1/gamma ~ 0.31. The > 2x on/off contrast required by
 * VALIDATION-style tests is geometric+response driven, never a flat switch.
 */
export function viewingResponse(viewingAngleDeg: number, resolved: ResolvedScenario): number {
  const thetaDeg = Number.isFinite(viewingAngleDeg)
    ? Math.min(180, Math.max(0, viewingAngleDeg))
    : 90;
  const beta = Math.min(0.995, Math.max(0.05, resolved.jet.velocityProxyC));
  const gamma = 1 / Math.sqrt(1 - beta * beta);
  const mu = Math.cos((thetaDeg * Math.PI) / 180);
  const delta = 1 / (gamma * (1 - beta * mu));
  const response = delta * delta * delta;
  return Number.isFinite(response)
    ? Math.min(VIEWING_RESPONSE_MAX, Math.max(VIEWING_RESPONSE_MIN, response))
    : 1;
}

// ---------------------------------------------------------------------------
// TSL twin of the jet factor (volume march / ribbon shading)
// ---------------------------------------------------------------------------

/** Inferred uniform bundle (ReturnType pattern; see density.ts note). */
function createJetUniforms() {
  return {
    /** Unit-length jet axis. Vector3 BY REFERENCE, mutated. */
    axis: uniform(new THREE.Vector3(0, 1, 0)),
    /** Half-opening angle, radians. */
    halfOpeningRad: uniform(0.15),
    /** Current jet-front length, scene units (0 disables the jet). */
    frontUnits: uniform(0),
    /** Tip-fade fraction of the front length (fixed constant exposed). */
    tipFraction: uniform(0.25)
  };
}

export type JetUniformBundle = ReturnType<typeof createJetUniforms>;

/** Create the bundle; overwrite via {@link configureJetUniforms} per frame. */
export function createExplosionJetUniforms(): JetUniformBundle {
  return createJetUniforms();
}

/**
 * Push the current jet state into the bundle. `frontUnits` comes from
 * {@link jetFrontUnits}; writing exactly 0 before ignition lets the shader
 * branch vanish without graph rebuilds.
 */
export function configureJetUniforms(
  u: JetUniformBundle,
  resolved: ResolvedScenario,
  frontUnits: number
): void {
  u.axis.value.set(resolved.axis[0], resolved.axis[1], resolved.axis[2]);
  u.halfOpeningRad.value = resolved.jet.halfOpeningAngleRad;
  u.frontUnits.value = Number.isFinite(frontUnits) && frontUnits > 0 ? frontUnits : 0;
}

/**
 * TSL twin of {@link jetDensityFactor}: same constants and shape, consuming
 * the uniform bundle instead of CPU arguments. Returns a float node in
 * [0, 1]. Method-chain form preserves node-type branding (see density.ts).
 */
export function buildJetFactor(
  u: JetUniformBundle
): (args: { pos: unknown; dir: unknown }) => Node<'float'> {
  return ({ pos }) => {
    const p = vec3(pos as Node<'vec3'>);
    const axialAbs = abs(dot(p, u.axis));
    const perpLen = length(p.sub(u.axis.mul(dot(p, u.axis))));

    // Cone profile: exp(-2 * min((angle/half)^2, 25)).
    const angle = perpLen.div(axialAbs.max(1e-9)).atan();
    const ratio = angle.div(u.halfOpeningRad.max(1e-4));
    const cone = ratio.mul(ratio).min(25).mul(2).negate().exp();

    // Tip fade across the last tipFraction of the front.
    const tipStart = u.frontUnits.mul(u.tipFraction.oneMinus());
    const tip = axialAbs
      .sub(tipStart)
      .div(u.frontUnits.sub(tipStart).max(1e-6))
      .clamp(0, 1)
      .oneMinus();

    // Active window: 0 when the front has not launched or past its tip.
    const active = stepIf(axialAbs, u.frontUnits);
    return max(min(cone.mul(tip).mul(active), 1), 0);
  };
}

/** 1 when x < limit else 0, branch-free (mirrors the CPU early-outs). */
function stepIf(x: Node<'float'>, limit: Node<'float'>): Node<'float'> {
  return smoothstep(limit, limit, x).oneMinus();
}
