/**
 * Compact Merger deterministic inspiral model (CA5-03).
 *
 * Spec sources:
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 4 (validated
 *   inspiral trajectory; DIRECT reduced model);
 * - docs/cosmic-atlas/VALIDATION_TESTING.md section 7 (separation decreases,
 *   frequency increases, deterministic contact, scrub reversibility);
 * - docs/PHYSICS.md discipline: explicit conventions, closed-form where
 *   possible, no hidden state.
 *
 * MODEL (quadrupole-order, circular, GR-derived reduced dynamics — DIRECT):
 *
 *   da/dt = -(64/5) G^3 m1 m2 (m1+m2) / (c^5 a^3)
 *   => a(t) = (a0^4 - 4 K t)^(1/4),  K = (64/5) G^3 m1 m2 M / c^5
 *   omega(t) = sqrt(GM / a(t)^3)            (Kepler, exact for circular)
 *   phi(t)   = (2 sqrt(GM) / (5 K)) (a0^(5/2) - a(t)^(5/2))   [closed form]
 *   contact  <=> a <= R1 + R2               (deterministic t_contact)
 *
 * All quantities are CLOSED FORM in t: scrubbing to any time reproduces the
 * identical state with zero traversal history (CA5-12). Positions use the
 * center-of-mass frame with the orbital plane = world XZ (+Y polar axis);
 * equal masses give exact point symmetry, unequal masses place each star at
 * the COM-correct radius (m1 r1 = m2 r2).
 *
 * Post-contact the analytic inspiral is DEFINITIONALLY over (mission
 * section 10): consumers must switch to the merger/ejecta presentation and
 * MUST NOT extrapolate the orbit past contact.
 */

import type { ResolvedMergerScenario } from './types.js';

/** Orbital separation a(t), scene units — clamped at the contact floor. */
export function inspiralSeparation(
  a0Units: number,
  decayKUnits4S: number,
  tSeconds: number
): number {
  const t = Number.isFinite(tSeconds) ? Math.max(0, tSeconds) : 0;
  const fourth = a0Units * a0Units * a0Units * a0Units - 4 * decayKUnits4S * t;
  return fourth > 0 ? Math.pow(fourth, 0.25) : 0;
}

/** Kepler orbital angular frequency omega = sqrt(GM)/a^1.5, rad/s. */
export function inspiralOrbitalFrequency(keplerSqrtMu: number, separationUnits: number): number {
  const a = Math.max(separationUnits, 1e-6);
  return keplerSqrtMu / (a * Math.sqrt(a));
}

/** Closed-form accumulated orbital phase, rad (exact integral of omega). */
export function inspiralPhase(
  keplerSqrtMu: number,
  decayKUnits4S: number,
  a0Units: number,
  tSeconds: number
): number {
  const t = Number.isFinite(tSeconds) ? Math.max(0, tSeconds) : 0;
  const a4 = a0Units * a0Units * a0Units * a0Units - 4 * decayKUnits4S * t;
  const aNow = a4 > 0 ? Math.pow(a4, 0.25) : 0;
  return (
    ((2 * keplerSqrtMu) / (5 * decayKUnits4S)) * (Math.pow(a0Units, 2.5) - Math.pow(aNow, 2.5))
  );
}

/** Deterministic contact time (a(t_c) = contact separation), seconds. */
export function inspiralContactSeconds(
  a0Units: number,
  contactSeparationUnits: number,
  decayKUnits4S: number
): number {
  const a04 = Math.pow(a0Units, 4);
  const ac4 = Math.pow(contactSeparationUnits, 4);
  if (a04 <= ac4) return 0; // already at/inside contact
  return (a04 - ac4) / (4 * decayKUnits4S);
}

/** Contact separation R1 + R2, scene units (kept beside the law for tests). */
export function contactSeparationOf(r1Units: number, r2Units: number): number {
  return r1Units + r2Units;
}

/** Component position in the COM frame, world XZ plane, +Y polar axis. */
export interface InspiralPosition {
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
}

/** Full inspiral state at physical time t (clamped to [0, contactSeconds]). */
export interface InspiralState {
  readonly atContact: boolean;
  /** Orbital separation, scene units. */
  readonly separation: number;
  /** Orbital angular frequency, rad/s (Kepler). */
  readonly orbitalFrequency: number;
  /** Accumulated orbital phase, rad (closed form). */
  readonly phase: number;
  /** COM-frame component positions, scene units. */
  readonly position: InspiralPosition;
  /** Seconds until deterministic contact (0 at/after contact). */
  readonly secondsToContact: number;
}

/** Evaluate the inspiral state at time `t` seconds (never throws). */
export function inspiralStateAt(scenario: ResolvedMergerScenario, tSeconds: number): InspiralState {
  const t = Number.isFinite(tSeconds) ? Math.max(0, tSeconds) : 0;
  const atContact = t >= scenario.contactSeconds;
  const tc = atContact ? scenario.contactSeconds : t;

  const separation = inspiralSeparation(scenario.a0Units, scenario.decayKUnits4S, tc);
  const orbitalFrequency = inspiralOrbitalFrequency(scenario.keplerSqrtMu, separation);
  const phase = inspiralPhase(scenario.keplerSqrtMu, scenario.decayKUnits4S, scenario.a0Units, tc);

  const massFraction1 = scenario.m2Kg / scenario.totalKg;
  const massFraction2 = scenario.m1Kg / scenario.totalKg;
  const cos = Math.cos(phase);
  const sin = Math.sin(phase);
  const r1 = separation * massFraction1;
  const r2 = separation * massFraction2;

  return {
    atContact,
    separation,
    orbitalFrequency,
    phase,
    position: {
      x1: r1 * cos,
      z1: r1 * sin,
      x2: -r2 * cos,
      z2: -r2 * sin
    },
    secondsToContact: Math.max(0, scenario.contactSeconds - t)
  };
}
