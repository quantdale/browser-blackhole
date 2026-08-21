/**
 * Neutron-star exterior physics — pure TypeScript CPU model.
 *
 * Spec sources implemented here (do not drift without updating docs):
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 2 "Neutron Star"
 *   (fidelity classes, minimum viable visualization, main controls).
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md section 8 "Neutron Star"
 *   (destination state vocabulary mirrored as plain data downstream).
 * - docs/NUMERICAL_METHODS.md section 16 — frequency-ratio convention
 *   g = nu_obs/nu_emit, reused verbatim for the static-surface case.
 *
 * FIDELITY CLASS: DIRECT (exterior Schwarzschild), with explicit, deliberate
 * simplifications. The star is modeled as a static, spherical exterior
 * Schwarzschild spacetime truncated at a material surface:
 *
 * - Frame dragging is NEGLECTED (no Hartle-Thorne / O(Omega^2) exterior
 *   terms). Valid for slow/moderate spins; millisecond pulsars drift beyond
 *   this model and must not claim otherwise.
 * - No interior solution is solved: the surface at R > 2 r_g is a boundary;
 *   nothing below it participates.
 * - Surface redshift uses the exact Schwarzschild static-emitter factor
 *   sqrt(1 - 2GM/(Rc^2)). Photon paths surface-to-observer are STRAIGHT
 *   lines here: no ray bending, no Doppler shift, no aberration, no
 *   light-travel-time effects. The lensing DIRECT path for this destination
 *   arrives later via the shared LensingService pass.
 * - The pulse/beacon light curve is an ANALYTIC GEOMETRY MODEL (smooth
 *   cosine-power cone with limb falloff) for readout and validation of pulse
 *   geometry — not an atmospheric radiative-transfer model.
 * - Flares are a documented procedural state machine
 *   (PROCEDURAL_SCIENTIFIC), not a magnetospheric simulation.
 *
 * Every approximation above is called out at its use site; nothing here
 * claims precision it does not have.
 *
 * This module is PURE: it must never import `three` (or anything else) so it
 * stays unit-testable and usable as the CPU reference for the GPU path.
 */

/** 3-vector tuple; frames are always stated per function. */
export type Vec3 = [number, number, number];

/**
 * Gravitational radius r_g = GM_sun/c^2 in kilometres.
 *
 * Provenance: IAU 2015 Resolution B3 NOMINAL solar mass parameter
 * GM_sun^N = 1.3271244e20 m^3 s^-2 (exact by convention) divided by the
 * exact speed of light c = 299792458 m/s gives GM/c^2 = 1476.625038... m,
 * quoted here as 1.476625 km. Consistent with src/physics/constants.ts
 * `metersPerRg`, which derives the same value from the same nominal
 * constants; duplicated locally so this module stays dependency-free.
 */
export const RG_KM_PER_SOLAR_MASS = 1.476625;

/** Canonical default mass in solar masses (canonical NS ~1.4 Msun). */
export const DEFAULT_MASS_SOLAR = 1.4;

/** Canonical default radius in kilometres (typical NS equation-of-state). */
export const DEFAULT_RADIUS_KM = 12;

/** Speed of light in km/s. Exact (SI definition of the metre). */
export const SPEED_OF_LIGHT_KM_S = 299792.458;

const TWO_PI = Math.PI * 2;

// ---------------------------------------------------------------------------
// Validation helpers (fail loudly on contract violations, mirroring CameraRig)
// ---------------------------------------------------------------------------

function requireFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `neutron-star/physics: ${label} must be a finite number (got ${String(value)}).`
    );
  }
  return value;
}

function requirePositive(value: number, label: string): number {
  requireFinite(value, label);
  if (!(value > 0)) {
    throw new RangeError(`neutron-star/physics: ${label} must be > 0 (got ${String(value)}).`);
  }
  return value;
}

function clampUnitInterval(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampUnit(value: number): number {
  return value < -1 ? -1 : value > 1 ? 1 : value;
}

/** Hermite smoothstep on a clamped [0, 1] argument. */
function smoothstep01(t: number): number {
  const x = clampUnitInterval(t);
  return x * x * (3 - 2 * x);
}

function normalizeVec3(v: Vec3, label: string): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 0) || !Number.isFinite(len)) {
    throw new RangeError(`neutron-star/physics: ${label} must be a non-degenerate finite vector.`);
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ---------------------------------------------------------------------------
// Compactness and gravitational redshift (DIRECT, exterior Schwarzschild)
// ---------------------------------------------------------------------------

/** Gravitational radius r_g = GM/c^2 in km for `massSolar` solar masses. */
export function gravitationalRadiusKm(massSolar: number): number {
  return requirePositive(massSolar, 'massSolar') * RG_KM_PER_SOLAR_MASS;
}

/**
 * Compactness defined as GM/(Rc^2) = r_g / R (dimensionless, in (0, 1/2]).
 *
 * Convention note: some literature defines compactness as 2GM/(Rc^2)
 * (= r_s/R, horizon limit 1). THIS module uses r_g/R throughout; the
 * horizon limit is therefore 1/2 and appears explicitly in the redshift
 * factor below. Throws RangeError unless R > 2 r_g strictly: at or inside
 * the would-be horizon the static-surface emitter this model describes does
 * not exist.
 */
export function compactness(radiusMeters: number, massSolar: number): number {
  requirePositive(radiusMeters, 'radiusMeters');
  const rgMeters = gravitationalRadiusKm(massSolar) * 1000;
  if (!(radiusMeters > 2 * rgMeters)) {
    throw new RangeError(
      `neutron-star/physics: radius ${radiusMeters} m must exceed 2 r_g = ${2 * rgMeters} m ` +
        `for ${massSolar} Msun.`
    );
  }
  return rgMeters / radiusMeters;
}

/**
 * Static-surface gravitational redshift factor
 * g = nu_obs/nu_emit = sqrt(1 - 2GM/(Rc^2)) = sqrt(1 - 2 r_g / R)
 * (docs/NUMERICAL_METHODS.md section 16 convention; far-away static
 * observer). Exact for a STATIC emitter in the exterior Schwarzschild
 * metric; Doppler/aberration from rotation are intentionally excluded
 * (see header). Throws RangeError unless R > 2 r_g.
 */
export function surfaceRedshift(massSolar: number, radiusMeters: number): number {
  const c = compactness(radiusMeters, massSolar);
  return Math.sqrt(1 - 2 * c);
}

/**
 * Observed/emitted temperature ratio T_obs/T_emit for the surface.
 *
 * SIMPLIFICATION (disclosed): for a static surface emitter with no Doppler
 * shift, the frequency ratio equals the redshift factor g, and photon
 * energy scales with frequency, so the color/effective temperature ratio is
 * taken as T_obs = g * T_emit. Bolometric flux additionally transforms with
 * g^4 (and apparent area is lens-distorted once ray bending lands); those
 * refinements are deferred with the LensingService pass. Valid R > 2 r_g
 * (throws otherwise).
 */
export function observedTemperatureRatio(massSolar: number, radiusMeters: number): number {
  return surfaceRedshift(massSolar, radiusMeters);
}

// ---------------------------------------------------------------------------
// Rotation kinematics
// ---------------------------------------------------------------------------

/**
 * Spin phase in radians, wrapped to [0, 2*pi): phase(t) = 2*pi*f*t mod 2*pi.
 * Deterministic; negative t wraps consistently. spinHz must be >= 0.
 */
export function spinPhase(tSeconds: number, spinHz: number): number {
  requireFinite(tSeconds, 'tSeconds');
  const f = requireFinite(spinHz, 'spinHz');
  if (f < 0) {
    throw new RangeError(`neutron-star/physics: spinHz must be >= 0 (got ${String(f)}).`);
  }
  let phase = (TWO_PI * tSeconds * f) % TWO_PI;
  if (phase < 0) phase += TWO_PI;
  return phase;
}

/**
 * Unit direction of a surface point in SPIN-FRAME coordinates.
 *
 * Frame convention: +Y is the spin axis; azimuth is measured in the
 * equatorial plane from +X toward +Z (right-handed about +Y). Colatitude
 * runs from the +Y pole. Returns a unit vector.
 */
export function spotDirectionFromSpinAxis(colatitudeRad: number, phaseRad: number): Vec3 {
  const theta = requireFinite(colatitudeRad, 'colatitudeRad');
  const phi = requireFinite(phaseRad, 'phaseRad');
  const sinTheta = Math.sin(theta);
  return [sinTheta * Math.cos(phi), Math.cos(theta), sinTheta * Math.sin(phi)];
}

// ---------------------------------------------------------------------------
// Pulse geometry (analytic beacon light curve)
// ---------------------------------------------------------------------------

/** Cosine-power index of the beam profile (smooth-cone model). */
const BEAM_EXPONENT = 2;
/** Outer fraction of the cone over which the limb falloff fades to zero. */
const BEAM_LIMB_FALLOFF_FRACTION = 0.25;
/** Floor fed to pow() so the profile stays finite at grazing angles. */
const BEAM_DOT_EPSILON = 1e-9;

/**
 * Analytic beacon visibility in [0, 1] for one hot spot.
 *
 * Model (documented approximation): a smooth cosine-power cone beamed along
 * `spotDir`, evaluated in the SPIN FRAME so the light curve is periodic in
 * spin phase by construction:
 *
 *   mu        = dot(spotDir, observerDirInSpinFrame)
 *   gamma     = acos(mu)                       (angle off the beam axis)
 *   core      = max(mu, eps)^BEAM_EXPONENT      (cosine-power beam)
 *   limbFade  = 1 - smoothstep over the outer BEAM_LIMB_FALLOFF_FRACTION
 *               of the cone                     (limb falloff)
 *   visible   = gamma < opening ? min(1, core * limbFade) : 0
 *
 * phaseOfMaximum (documented): with spot colatitude/azimuth (theta_s,
 * phi_s) and observer colatitude/azimuth (theta_o, phi_o) in the spin
 * frame, mu(phi) = cos(theta_s)cos(theta_o) +
 * sin(theta_s)sin(theta_o)cos(phi + phi_s - phi_o), so visibility peaks at
 * the spin phase phi_max = phi_o - phi_s (mod 2*pi) — the moment the spot
 * meridian sweeps through the observer meridian.
 *
 * Aligned-axis case: if the spot sits ON the spin axis (theta_s = 0), both
 * directions are fixed in the spin frame, gamma is independent of phase and
 * visibility is CONSTANT (no modulation). This is the expected geometric
 * behavior of the model, not a defect: an aligned rotator beams steadily at
 * whatever latitude it reaches.
 *
 * Both direction arguments are normalized defensively; opening must lie in
 * (0, pi) strictly. Throws TypeError/RangeError on contract violations.
 */
export function pulseVisibility(
  spotDir: Vec3,
  observerDirInSpinFrame: Vec3,
  beamOpeningAngleRad: number
): number {
  const opening = requireFinite(beamOpeningAngleRad, 'beamOpeningAngleRad');
  if (!(opening > 0) || !(opening < Math.PI)) {
    throw new RangeError(
      `neutron-star/physics: beamOpeningAngleRad must lie in (0, pi) (got ${String(opening)}).`
    );
  }
  const s = normalizeVec3(spotDir, 'spotDir');
  const o = normalizeVec3(observerDirInSpinFrame, 'observerDirInSpinFrame');
  const mu = clampUnit(s[0] * o[0] + s[1] * o[1] + s[2] * o[2]);
  const gamma = Math.acos(mu);
  if (gamma >= opening) return 0;
  const core = Math.pow(Math.max(mu, BEAM_DOT_EPSILON), BEAM_EXPONENT);
  const x = gamma / opening;
  const limbStart = 1 - BEAM_LIMB_FALLOFF_FRACTION;
  const fade = x <= limbStart ? 1 : 1 - smoothstep01((x - limbStart) / BEAM_LIMB_FALLOFF_FRACTION);
  return Math.min(1, core * fade);
}

// ---------------------------------------------------------------------------
// Dipole geometry helpers (PROCEDURAL_SCIENTIFIC visualization support)
// ---------------------------------------------------------------------------

/**
 * Light-cylinder radius in r_g units: r_LC = c / (2*pi*f), normalized by
 * r_g(massSolar). Returns Infinity for f <= 0 (non-rotating limit), which
 * callers must treat as "no light cylinder".
 */
export function lightCylinderRadiusRg(spinHz: number, massSolar: number): number {
  const f = requireFinite(spinHz, 'spinHz');
  const rgKm = gravitationalRadiusKm(massSolar);
  if (f <= 0) return Infinity;
  return SPEED_OF_LIGHT_KM_S / (TWO_PI * f) / rgKm;
}

/**
 * Polar-cap rim colatitude in radians for a vacuum dipole whose open field
 * lines close through the light cylinder: the last closed shell has
 * L = r_LC and its footpoint satisfies r_star = L sin^2(theta_p), hence
 * theta_p = asin(sqrt(r_star / r_LC)).
 *
 * Requires 0 < radiusRg < lightCylinderRadiusRg (throws RangeError
 * otherwise); clamps the ratio at 1 so grazing configurations saturate at
 * the equator instead of producing NaN.
 */
export function polarCapColatitude(radiusRg: number, lcRadiusRg: number): number {
  const rStar = requirePositive(radiusRg, 'radiusRg');
  const rLc = requirePositive(lcRadiusRg, 'lcRadiusRg');
  if (!(rLc > rStar)) {
    throw new RangeError(
      `neutron-star/physics: light cylinder (${rLc} r_g) must lie outside the star (${rStar} r_g).`
    );
  }
  return Math.asin(Math.min(1, Math.sqrt(rStar / rLc)));
}

/**
 * Unit vector of a Rodrigues rotation of `v` about `unitAxis` by angleRad.
 * Pure helper shared by the magnetic-axis construction.
 */
function rodriguesRotation(v: Vec3, unitAxis: Vec3, angleRad: number): Vec3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  const dotVK = v[0] * unitAxis[0] + v[1] * unitAxis[1] + v[2] * unitAxis[2];
  const crossX = unitAxis[1] * v[2] - unitAxis[2] * v[1];
  const crossY = unitAxis[2] * v[0] - unitAxis[0] * v[2];
  const crossZ = unitAxis[0] * v[1] - unitAxis[1] * v[0];
  const k = 1 - c;
  return [
    v[0] * c + crossX * s + unitAxis[0] * dotVK * k,
    v[1] * c + crossY * s + unitAxis[1] * dotVK * k,
    v[2] * c + crossZ * s + unitAxis[2] * dotVK * k
  ];
}

/**
 * Deterministic unit vector perpendicular to `axis`, chosen via the
 * smallest-component rule (same policy as FieldLineService so CPU and
 * visualization bases agree for every orientation).
 */
function perpendicularUnit(axis: Vec3): Vec3 {
  const absX = Math.abs(axis[0]);
  const absY = Math.abs(axis[1]);
  const absZ = Math.abs(axis[2]);
  const helper: Vec3 =
    absX <= absY && absX <= absZ ? [1, 0, 0] : absY <= absZ ? [0, 1, 0] : [0, 0, 1];
  const cross: Vec3 = [
    axis[1] * helper[2] - axis[2] * helper[1],
    axis[2] * helper[0] - axis[0] * helper[2],
    axis[0] * helper[1] - axis[1] * helper[0]
  ];
  return normalizeVec3(cross, 'perpendicular basis');
}

/**
 * Magnetic (dipole moment) axis in the WORLD frame.
 *
 * Construction: start from the spin axis, tilt by `tiltRad` about a
 * deterministic transverse reference direction, then carry the tilted axis
 * around the spin axis by `phaseRad` (the star's rotation). With
 * tiltRad = 0 the magnetic axis IS the spin axis for every phase.
 *
 * `spinAxis` defaults to +Y = [0, 1, 0] and is normalized defensively;
 * degenerate (near-zero) axes throw RangeError. Returns a unit vector.
 */
export function magneticAxisVector(
  tiltRad: number,
  phaseRad: number,
  spinAxis: Vec3 = [0, 1, 0]
): Vec3 {
  const tilt = requireFinite(tiltRad, 'tiltRad');
  const phase = requireFinite(phaseRad, 'phaseRad');
  const axis = normalizeVec3(spinAxis, 'spinAxis');
  const reference = perpendicularUnit(axis);
  const tilted = rodriguesRotation(axis, reference, tilt);
  return rodriguesRotation(tilted, axis, phase);
}

// ---------------------------------------------------------------------------
// Flare state machine (PROCEDURAL_SCIENTIFIC, pure functional core)
// ---------------------------------------------------------------------------

export type FlareMode = 'quiescent' | 'active';

export interface FlareState {
  mode: FlareMode;
  /** Envelope phase in [0, 1) while active; 0 while quiescent. */
  phase01: number;
  /** Accumulated trigger energy (arbitrary units, capped). */
  storedEnergy: number;
}

/** Rising-segment end (fraction of the envelope). */
export const FLARE_RISING_END = 0.15;
/** Plateau end (fraction of the envelope). */
export const FLARE_PEAK_END = 0.35;
/** Decay end; beyond this the envelope rests at the quiescent level. */
export const FLARE_DECAY_END = 0.85;
/** Baseline multiplier while quiescent (and the decay floor). */
export const FLARE_QUIESCENT_LEVEL = 0.15;
/** Stored energy required to trigger one flare. */
export const FLARE_TRIGGER_ENERGY = 1;
/** Envelope phase advanced per unit of input energy while active. */
export const FLARE_PHASE_RATE_PER_ENERGY = 0.25;
/** Hard cap on stored energy (bounds memoryless growth). */
export const FLARE_MAX_STORED_ENERGY = 10;

/**
 * Piecewise flare light-curve multiplier in [FLARE_QUIESCENT_LEVEL, 1]:
 *
 *   [0, 0.15)          rising   — smoothstep from quiescent level to peak
 *   [0.15, 0.35)       peak     — plateau at 1
 *   [0.35, 0.85)       decay    — quadratic falloff back to quiescent level
 *   [0.85, 1]          quiescent— baseline
 *
 * The quadratic decay is chosen for visual plausibility and C1-smoothness
 * at the resting end; it is NOT a physical cooling law (disclosed
 * PROCEDURAL_SCIENTIFIC). Inputs outside [0, 1] are clamped.
 */
export function flareEnvelope(phase01: number): number {
  const p = clampUnitInterval(requireFinite(phase01, 'phase01'));
  if (p < FLARE_RISING_END) {
    const t = p / FLARE_RISING_END;
    return FLARE_QUIESCENT_LEVEL + (1 - FLARE_QUIESCENT_LEVEL) * smoothstep01(t);
  }
  if (p < FLARE_PEAK_END) return 1;
  if (p < FLARE_DECAY_END) {
    const span = FLARE_DECAY_END - FLARE_PEAK_END;
    const t = (p - FLARE_PEAK_END) / span;
    const fall = (1 - t) * (1 - t);
    return FLARE_QUIESCENT_LEVEL + (1 - FLARE_QUIESCENT_LEVEL) * fall;
  }
  return FLARE_QUIESCENT_LEVEL;
}

/**
 * Advance the flare machine by one dose of input energy.
 *
 * `dtEnergyInput` couples simulated seconds to an energy-input rate chosen
 * by the caller (the destination module feeds dt * rate). Semantics:
 *
 * - Energy accumulates while quiescent (capped at FLARE_MAX_STORED_ENERGY);
 *   crossing FLARE_TRIGGER_ENERGY consumes one trigger worth of energy and
 *   switches to 'active' at phase 0.
 * - While active, the envelope phase advances by
 *   dtEnergyInput * FLARE_PHASE_RATE_PER_ENERGY; reaching 1 returns to
 *   'quiescent'. At the module's default rate (1/s) a flare lasts
 *   1 / 0.25 = 4 s and triggers after 1 s of accumulation.
 *
 * Pure: returns a NEW FlareState; the input is never mutated. Non-finite or
 * negative doses are treated as 0; corrupt current fields are repaired to
 * safe defaults rather than propagating NaN.
 */
export function nextFlareState(current: FlareState, dtEnergyInput: number): FlareState {
  const dose =
    typeof dtEnergyInput === 'number' && Number.isFinite(dtEnergyInput) && dtEnergyInput > 0
      ? dtEnergyInput
      : 0;
  const priorStored =
    typeof current.storedEnergy === 'number' && Number.isFinite(current.storedEnergy)
      ? current.storedEnergy
      : 0;
  const stored = Math.min(FLARE_MAX_STORED_ENERGY, Math.max(0, priorStored + dose));

  if (current.mode === 'active') {
    const priorPhase =
      typeof current.phase01 === 'number' && Number.isFinite(current.phase01) ? current.phase01 : 0;
    const phase = priorPhase + dose * FLARE_PHASE_RATE_PER_ENERGY;
    if (phase >= 1) {
      return { mode: 'quiescent', phase01: 0, storedEnergy: stored };
    }
    return { mode: 'active', phase01: phase, storedEnergy: stored };
  }

  if (stored >= FLARE_TRIGGER_ENERGY) {
    return { mode: 'active', phase01: 0, storedEnergy: stored - FLARE_TRIGGER_ENERGY };
  }
  return { mode: 'quiescent', phase01: 0, storedEnergy: stored };
}
