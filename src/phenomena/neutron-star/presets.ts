/**
 * Neutron-star destination presets (CA3-03/05/06).
 *
 * Spec sources:
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md section 8 "Neutron Star"
 *   (destination state vocabulary) and section 3 (preset descriptor shape
 *   via src/atlas/types.ts PresetDescriptor).
 * - docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md section 2 (pulsar and
 *   magnetar presets; main controls).
 *
 * SCENE SCALE CONVENTION (applies to every camera coordinate below):
 * the neutron-star destination uses 1 scene unit = 1 km, so a star of
 * radius R km is a sphere of radius R scene units and camera distances are
 * literally kilometres. All conversions for this destination live in
 * neutronStarModule.ts (KM_TO_SCENE_UNITS); this file only bakes numbers.
 *
 * Camera placement math (documented so positions are auditable): observer
 * direction from spherical coordinates matching THREE.Spherical /
 * CameraRig conventions — polar angle = observerInclinationDeg measured
 * from the +Y spin axis, azimuth chosen per preset for a pleasing view:
 *
 *   dir = (sin(incl)*sin(az), cos(incl), sin(incl)*cos(az))
 *   position = distance * dir, target = origin (star center)
 *
 * Physical parameter choices are ILLUSTRATIVE-but-plausible canonical
 * values (masses/radii/spins within observed population ranges); they are
 * not measurements of any specific object.
 */

import type { PresetDescriptor } from '../../atlas/types.js';

/** Destination id shared by every preset below. */
const DESTINATION_ID = 'neutron-star';

/**
 * 'surface' — default close-orbit view of one hot spot on a slowly rotating
 * star. Single polar-cap spot near the magnetic pole (tilt 30 deg -> spot
 * colatitude ~28 deg), equator-on-ish observer (80 deg inclination) so the
 * spot visibly rotates across the disc.
 */
const SURFACE_PRESET: PresetDescriptor = {
  id: 'surface',
  displayName: 'Surface',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'Exterior Schwarzschild DIRECT: surface redshift g=sqrt(1-2rg/R) and pulse geometry are ' +
    'analytic. Visible surface is direct emission (no ray-bent limb yet). Dipole field lines ' +
    'and flares are PROCEDURAL_SCIENTIFIC.',
  state: {
    preset: 'surface',
    mass: 1.4,
    radius: 12,
    spinHz: 0.5,
    spinAxis: [0, 1, 0],
    magneticTiltDeg: 30,
    observerInclinationDeg: 80,
    hotSpots: [{ colatitudeDeg: 28, azimuthDeg: 0, angularRadiusDeg: 8, temperatureK: 2.0e6 }],
    beamOpeningAngleDeg: 25,
    flareState: 'quiescent',
    flarePhase: 0,
    time: 0
  },
  // incl 80deg, azim 40deg, d=42 km:
  // dir = (sin80*sin40, cos80, sin80*cos40) = (0.633, 0.174, 0.755)
  camera: { position: [27, 7, 32], target: [0, 0, 0], fovDeg: 55 },
  seed: 101,
  timelineInitialPhase: 0
};

/**
 * 'pulsar' — faster rotator with two antipodal caps and a narrow beam,
 * framed far enough out to read the lighthouse geometry against the dipole
 * field lines. Spin 5 Hz keeps the sweep watchable while staying inside the
 * observed pulsar population (the model itself neglects frame dragging, so
 * this remains honest at moderate spins).
 */
const PULSAR_PRESET: PresetDescriptor = {
  id: 'pulsar',
  displayName: 'Pulsar',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'Pulse timing DIRECT analytic beacon geometry (spin-frame cone model); redshift DIRECT ' +
    'sqrt(1-2rg/R). No Doppler/aberration/frame-dragging yet. Field lines PROCEDURAL_SCIENTIFIC.',
  state: {
    preset: 'pulsar',
    mass: 1.4,
    radius: 12,
    spinHz: 5,
    spinAxis: [0, 1, 0],
    magneticTiltDeg: 45,
    observerInclinationDeg: 70,
    hotSpots: [
      { colatitudeDeg: 43, azimuthDeg: 0, angularRadiusDeg: 6, temperatureK: 3.0e6 },
      { colatitudeDeg: 137, azimuthDeg: 180, angularRadiusDeg: 6, temperatureK: 3.0e6 }
    ],
    beamOpeningAngleDeg: 15,
    flareState: 'quiescent',
    flarePhase: 0,
    time: 0
  },
  // incl 70deg, azim 150deg, d=110 km:
  // dir = (sin70*sin150, cos70, sin70*cos150) = (0.470, 0.342, -0.814)
  camera: { position: [52, 38, -90], target: [0, 0, 0], fovDeg: 60 },
  seed: 202,
  timelineInitialPhase: 0
};

/**
 * 'magnetar' — slow, strongly tilted, hotter spots, and the flare state
 * machine engaged from arrival (flareState 'active'). Magnetar population
 * reality check: multi-second spins (here 0.25 Hz) and X-ray-bright hot
 * regions; field decay physics itself is NOT simulated — the flare envelope
 * is procedural and labeled as such.
 */
const MAGNETAR_PRESET: PresetDescriptor = {
  id: 'magnetar',
  displayName: 'Magnetar',
  destinationId: DESTINATION_ID,
  stateSchemaVersion: 1,
  fidelityNote:
    'Redshift DIRECT sqrt(1-2rg/R); pulse geometry DIRECT analytic. Flare activity is a ' +
    'PROCEDURAL_SCIENTIFIC state machine (no magnetospheric simulation); field lines likewise.',
  state: {
    preset: 'magnetar',
    mass: 1.5,
    radius: 11,
    spinHz: 0.25,
    spinAxis: [0, 1, 0],
    magneticTiltDeg: 60,
    observerInclinationDeg: 65,
    hotSpots: [
      { colatitudeDeg: 58, azimuthDeg: 20, angularRadiusDeg: 14, temperatureK: 6.5e6 },
      { colatitudeDeg: 118, azimuthDeg: 200, angularRadiusDeg: 12, temperatureK: 5.5e6 }
    ],
    beamOpeningAngleDeg: 30,
    flareState: 'active',
    flarePhase: 0.05,
    time: 0
  },
  // incl 65deg, azim -120deg, d=95 km:
  // dir = (sin65*sin(-120), cos65, sin65*cos(-120)) = (-0.785, 0.423, -0.453)
  camera: { position: [-75, 40, -43], target: [0, 0, 0], fovDeg: 60 },
  seed: 303,
  timelineInitialPhase: 0
};

/** All neutron-star destination presets, default first ('surface'). */
export const NEUTRON_STAR_PRESETS: PresetDescriptor[] = [
  SURFACE_PRESET,
  PULSAR_PRESET,
  MAGNETAR_PRESET
];
