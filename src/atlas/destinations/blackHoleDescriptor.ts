/**
 * Black-hole destination DESCRIPTOR + presets — deliberately lightweight.
 *
 * WS3/tasks.md §5 (whole-atlas performance optimization): the atlas registry
 * needs only metadata to build routes, the destination selector and the
 * preset catalogue. Keeping that metadata in the same module as the
 * implementation forced the heavy black-hole adapter — diagnostic shaders,
 * LUT texture/runtime code, Kerr characteristics, observer uniforms — to be
 * fetched during registry setup on EVERY boot, including boots that route to
 * a completely different destination. This module therefore contains data
 * only; `descriptor.load` dynamically imports the implementation, which is
 * the pattern galaxy-collision already demonstrated.
 *
 * The implementation module imports `blackHoleDescriptor` from here (a
 * static edge in that direction only), so there is no static import cycle.
 */

import type { PhenomenonDescriptor, PresetDescriptor } from '../types.js';

/** Display recommendations for scientific presentation presets. */
const DISPLAY_SCIENTIFIC = {
  exposure: 1,
  toneMapping: 'aces-filmic',
  bloomEnabled: false,
  bloomStrength: 0
} as const;

export const BLACK_HOLE_PRESETS: PresetDescriptor[] = [
  {
    id: 'default',
    displayName: 'Black Hole — Default',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Full numerical Schwarzschild backwards ray tracing (GPU f32 integrator; CPU binary64 reference is the oracle). Disk: Shakura-Sunyaev thin disk, ISCO inner edge.',
    state: { orbit: false },
    camera: {
      position: [0, 2.5, 16],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: 55
    },
    seed: 7,
    timelineInitialPhase: 0
  },
  {
    id: 'cinematic-orbit',
    displayName: 'Black Hole — Cinematic Orbit',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Same Schwarzschild lensing path as the default preset; differs only in arrival camera and a slow time-driven orbit.',
    state: { orbit: true },
    camera: {
      position: [12, 5, 12],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: 60
    },
    seed: 11,
    timelineInitialPhase: 0
  },
  {
    id: 'face-on-disk',
    displayName: 'Face-on Disk',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Same full numerical Schwarzschild ray tracer as the default preset; observer placed near the disk symmetry axis so the face-on reference geometry (no Doppler asymmetry expected) can be inspected directly.',
    state: { orbit: false },
    camera: { position: [1.5, 22, 4], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 50 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'medium'
  },
  {
    id: 'edge-on-lensing',
    displayName: 'Edge-on Lensing',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Identical lensing/disk model viewed from near the disk plane, emphasizing the upper/lower secondary disk images produced by strong-field light bending.',
    state: { orbit: false },
    camera: { position: [17, 0.9, 6], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: { exposure: 1.2, toneMapping: 'aces-filmic', bloomEnabled: false, bloomStrength: 0 },
    recommendedQuality: 'medium'
  },
  {
    id: 'photon-ring',
    displayName: 'Photon Ring',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Identical lensing/disk model with a closer camera framing the critical impact parameter; display recommendation raises exposure slightly to keep high-order ring structure readable. Physics unchanged.',
    state: { orbit: false },
    camera: { position: [0, 1.2, 9.5], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 45 },
    seed: 7,
    timelineInitialPhase: 0,
    display: { exposure: 1.5, toneMapping: 'aces-filmic', bloomEnabled: true, bloomStrength: 0.35 },
    recommendedQuality: 'high'
  },
  {
    id: 'doppler-demo',
    displayName: 'Doppler Demonstration',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Edge-on-ish view of the SAME Shakura-Sunyaev disk with relativistic beaming enabled, making the approaching/receding brightness contrast directly visible. No model change versus other presets.',
    state: { orbit: false },
    camera: { position: [14, 3, 8], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: { exposure: 1.15, toneMapping: 'aces-filmic', bloomEnabled: false, bloomStrength: 0 },
    recommendedQuality: 'medium'
  },
  // -------------------------------------------------------------------------
  // M9 Kerr preset family (scientifically purposeful; conventions per
  // docs/KERR_BACKEND_ADR.md). Disk inner edges follow kerrIscoRadius(spin).
  // -------------------------------------------------------------------------
  {
    id: 'kerr-zero-spin',
    displayName: 'Kerr — Zero Spin (Validation)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Numerical Kerr backend at a* = 0: the primary spin->0 convergence reference. Must be visually and physically indistinguishable from the Schwarzschild path within documented tolerances.',
    state: { metric: 'kerr', spin: 0, orbit: false },
    camera: { position: [0, 2.5, 16], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'high'
  },
  {
    id: 'kerr-moderate-prograde',
    displayName: 'Kerr — Moderate Prograde (a*=0.6)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Numerical Kerr backend, prograde thin disk corotating with a*= +0.6. Disk inner edge at the Bardeen-Press-Teukolsky ISCO (~4.38 r_g); frame dragging shifts the photon ring asymmetrically.',
    state: { metric: 'kerr', spin: 0.6, orbit: false },
    camera: { position: [13.5, 3.2, 7], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'high'
  },
  {
    id: 'kerr-high-prograde',
    displayName: 'Kerr — High Prograde (a*=0.9)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Numerical Kerr backend near the supported spin ceiling: a*= +0.9, disk down to ISCO ~2.32 r_g. Strong frame dragging and pronounced shadow asymmetry; numerical failures stay explicitly classified.',
    state: { metric: 'kerr', spin: 0.9, orbit: false },
    camera: { position: [12, 1.6, 6], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'ultra'
  },
  {
    id: 'kerr-retrograde',
    displayName: 'Kerr — Retrograde Disk (a*=-0.7)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Numerical Kerr backend with the disk still corotating with world +Y while the hole spins a*= -0.7 (retrograde relative to the disk): ISCO pushed to ~8.05 r_g, counter-rotating frame dragging.',
    state: { metric: 'kerr', spin: -0.7, orbit: false },
    camera: { position: [13.5, 3.2, -7], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'high'
  },
  {
    id: 'observer-static',
    displayName: 'Observer — Static Reference (M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'M10 compatibility anchor: the explicit STATIC observer mode routes through the new observer-frame abstraction while reproducing the legacy static physics exactly (OBSERVER_FRAME_ADR §5 equivalence gate).',
    state: { orbit: false, observer: { mode: 'static' } },
    camera: { position: [0, 2.5, 16], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 55 },
    seed: 7,
    timelineInitialPhase: 0
  },
  {
    id: 'observer-circular',
    displayName: 'Physical Circular Observer (M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Timelike equatorial circular geodesic at r = 12 r_g (stable, above the Schwarzschild ISCO): aberration and Doppler come from the comoving tetrad via g = (-k.u_obs)/(-k.u_emit), not from camera motion. Physically distinct from the cinematic Orbit preset.',
    state: {
      orbit: false,
      observer: { mode: 'circular', circularRadiusRg: 12, circularSense: 1 }
    },
    // Camera pose = presentation-only look axes. The RENDER ORIGIN under a
    // moving observer is the WORLDLINE position ((12,0,0) at tau=0), so the
    // pose is placed on the same sight line (+X, slightly elevated) — looking
    // at the scene ORIGIN means looking at the hole FROM THE OBSERVER.
    // Framing defect fix (M11): the original pose [0,0.5,13.5] pointed the
    // observer ~90 deg AWAY from the hole (outside the 60 deg FOV).
    camera: { position: [19, 2.2, 0], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 60 },
    seed: 7,
    timelineInitialPhase: 0,
    recommendedQuality: 'high'
  },
  {
    id: 'observer-flyby',
    displayName: 'Flyby Observer (M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Unbound equatorial timelike geodesic (E = gamma(0.6) ~ 1.25, impact parameter 8 r_g): a scattering encounter with conserved E/L_z; periastron and outbound asymptote are integrated, never scripted.',
    state: {
      orbit: false,
      observer: { mode: 'flyby', flybyBetaInfinity: 0.6, flybyImpactParameterRg: 8 }
    },
    // Sight-line-corrected pose (see observer-circular note); flyby seeds at
    // r = 40 on +X.
    camera: { position: [48, 6, 0], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 60 },
    seed: 7,
    timelineInitialPhase: 0,
    recommendedQuality: 'high'
  },
  {
    id: 'observer-freefall',
    displayName: 'Freefall Observer (M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Drop from rest relative to static observers at r0 = 14 r_g. Proper-time worldline ends at the declared horizon stop band (r_+ * 1.001) with an explicit TERMINAL state — rendering inside the horizon is NOT claimed (OBSERVER_FRAME_ADR §3).',
    state: {
      orbit: false,
      observer: { mode: 'freefall', freefallReleaseRadiusRg: 14 }
    },
    // Sight-line-corrected pose (see observer-circular note); release at
    // r = 14 on +X, infalling along -X.
    camera: { position: [21, 2.5, 0], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 70 },
    seed: 7,
    timelineInitialPhase: 0,
    recommendedQuality: 'high'
  },
  {
    id: 'kerr-circular-observer',
    displayName: 'Kerr Circular Observer (a* = +0.6, M10)',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'Physical circular observer on the numerical Kerr backend at a* = +0.6, r = 8 r_g prograde: frame-dragged comoving optics through the full Kerr tetrad chain.',
    state: {
      metric: 'kerr',
      spin: 0.6,
      orbit: false,
      observer: { mode: 'circular', circularRadiusRg: 8, circularSense: 1 }
    },
    // Sight-line-corrected pose (see observer-circular note); Kerr circular
    // observer at r = 8 on +X.
    camera: { position: [13, 1.8, 0], target: [0, 0, 0], up: [0, 1, 0], fovDeg: 60 },
    seed: 7,
    timelineInitialPhase: 0,
    display: DISPLAY_SCIENTIFIC,
    recommendedQuality: 'ultra'
  },
  {
    id: 'debug-parity',
    displayName: 'Black Hole — Debug Parity View',
    destinationId: 'black-hole',
    stateSchemaVersion: 2,
    fidelityNote:
      'DEBUG TOOL, not a presentation: ESCAPED rays output their terminal tetrad-projected direction encoded rgb = dir*0.5+0.5 (linear); CAPTURED rays pure black; numerical failures failure-magenta. Disk disabled. Consumed by tests/browser/integrator-parity.spec.ts against cpuReference.integratePhoton and by the M9 Kerr parity spec against the binary64 kerr reference.',
    state: { debugParity: true },
    camera: {
      position: [0, 2.5, 16],
      target: [0, 0, 0],
      up: [0, 1, 0],
      fovDeg: 55
    },
    seed: 7,
    timelineInitialPhase: 0
  }
];

export const blackHoleDescriptor: PhenomenonDescriptor = {
  id: 'black-hole',
  title: 'Black Hole',
  group: 'compact',
  fidelity: 'DIRECT',
  route: 'black-hole',
  defaultPreset: 'default',
  requiredCapabilities: [],
  // ESTIMATES, not measurements.
  estimatedGpuMemoryMB: { low: 64, medium: 128, high: 256, ultra: 512 },
  load: async () => (await import('./blackHoleDestination.js')).createBlackHoleModule
};
