/**
 * FieldLineService — shared field-line visualization geometry.
 *
 * Spec sources:
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §7 (FieldLineService)
 * - src/atlas/types.ts (IFieldLineService, FieldLineConfig)
 *
 * Field lines are visualization geometry, not measured magnetospheric
 * structure (RENDERING_SERVICES.md §7 "Rule"). The analytic dipole mode
 * traces the vacuum-dipole line shape r = L·sin²(theta); this is a
 * PROCEDURAL_SCIENTIFIC-style idealized model and must be labeled as such
 * in any UI that exposes it.
 *
 * Determinism: all stochastic choices (azimuthal offsets) come from a
 * seeded mulberry32 PRNG — never bare Math.random.
 */

import * as THREE from 'three';
import type { FieldLineConfig, IFieldLineService } from '../../atlas/types';

/** Smallest field magnitude still considered integrable in createCustomLines. */
const FIELD_EPSILON = 1e-12;
/** Floor for the dipole inner radius so asin/sqrt arguments stay finite. */
const MIN_RADIUS = 1e-6;

/**
 * Mulberry32 PRNG: small, fast, deterministic for a given uint32 seed.
 * Returns values in [0, 1).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build an orthonormal basis (e1, e2) perpendicular to `axis`.
 * The helper vector is chosen from the smallest axis component so the
 * basis is stable for every non-degenerate input orientation.
 */
function buildPerpendicularBasis(axis: THREE.Vector3, e1: THREE.Vector3, e2: THREE.Vector3): void {
  const absX = Math.abs(axis.x);
  const absY = Math.abs(axis.y);
  const absZ = Math.abs(axis.z);
  const helper =
    absX <= absY && absX <= absZ
      ? new THREE.Vector3(1, 0, 0)
      : absY <= absZ
        ? new THREE.Vector3(0, 1, 0)
        : new THREE.Vector3(0, 0, 1);
  e1.crossVectors(axis, helper).normalize();
  e2.crossVectors(axis, e1);
}

export class FieldLineService implements IFieldLineService {
  /** Every LineSegments created by this service, for deterministic disposal. */
  private readonly created: THREE.LineSegments[] = [];

  /**
   * Analytic dipole field lines.
   *
   * Traces r = L·sin²(theta) (theta measured from `momentAxis`) for
   * `lineCount` L-shells distributed logarithmically between `rMin` and
   * `rMax`. Each line is sampled with `pointsPerLine` points spanning both
   * hemispheres, from the northern footpoint (r = rMin) through the
   * equator (r = L) to the southern footpoint. A seeded per-line azimuthal
   * offset rotates lines around `momentAxis` (the pure dipole is
   * axisymmetric, so offsets only decorrelate vertex placement).
   *
   * Output is THREE.LineSegments with constant vertex colors equal to
   * color*opacity and a transparent material; opacity is baked into the
   * vertex colors exactly once (material.opacity stays at 1 to avoid
   * double application).
   *
   * Note on `strength`: the dipole line SHAPE r = L·sin²theta is invariant
   * under the moment magnitude (only |B| scales), so `strength` does not
   * alter geometry here. It is accepted for interface conformance.
   */
  createDipoleLines(config: FieldLineConfig): THREE.LineSegments {
    const lineCount = Math.max(1, Math.floor(config.lineCount));
    const pointsPerLine = Math.max(2, Math.floor(config.pointsPerLine));
    const rMin = Math.max(MIN_RADIUS, config.rMin);
    const rMax = Math.max(rMin, config.rMax);

    const axis = new THREE.Vector3(
      config.momentAxis[0],
      config.momentAxis[1],
      config.momentAxis[2]
    );
    if (axis.lengthSq() < FIELD_EPSILON) {
      axis.set(0, 1, 0); // stable fallback for degenerate moment axis
    }
    axis.normalize();

    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    buildPerpendicularBasis(axis, e1, e2);

    const rng = mulberry32(config.seed);

    const segmentsPerLine = pointsPerLine - 1;
    const vertexCount = lineCount * segmentsPerLine * 2;
    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const cr = config.color[0] * config.opacity;
    const cg = config.color[1] * config.opacity;
    const cb = config.color[2] * config.opacity;

    let v = 0;
    const point = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const meridian = new THREE.Vector3();
    const cosPhi = new THREE.Vector3();
    const sinPhi = new THREE.Vector3();

    for (let i = 0; i < lineCount; i++) {
      // Logarithmic L-shell distribution; single line -> geometric mean.
      const t = lineCount === 1 ? 0.5 : i / (lineCount - 1);
      const shellL = rMin * Math.pow(rMax / rMin, t);
      // Footpoints where r = rMin: sin²(theta_min) = rMin / L.
      const thetaMin = Math.asin(Math.min(1, Math.sqrt(rMin / shellL)));
      const thetaSpan = Math.PI - 2 * thetaMin;

      // Seeded rotational offset of this meridian around momentAxis.
      const phi = rng() * Math.PI * 2;
      cosPhi.copy(e1).multiplyScalar(Math.cos(phi));
      sinPhi.copy(e2).multiplyScalar(Math.sin(phi));
      meridian.addVectors(cosPhi, sinPhi);

      for (let j = 0; j < pointsPerLine; j++) {
        const theta = thetaMin + thetaSpan * (j / (pointsPerLine - 1));
        const sinTheta = Math.sin(theta);
        const r = shellL * sinTheta * sinTheta;
        point
          .copy(axis)
          .multiplyScalar(r * Math.cos(theta))
          .addScaledVector(meridian, r * sinTheta);

        if (j > 0) {
          positions[v * 3] = prev.x;
          positions[v * 3 + 1] = prev.y;
          positions[v * 3 + 2] = prev.z;
          colors[v * 3] = cr;
          colors[v * 3 + 1] = cg;
          colors[v * 3 + 2] = cb;
          v++;
          positions[v * 3] = point.x;
          positions[v * 3 + 1] = point.y;
          positions[v * 3 + 2] = point.z;
          colors[v * 3] = cr;
          colors[v * 3 + 1] = cg;
          colors[v * 3 + 2] = cb;
          v++;
        }
        prev.copy(point);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = true;
    this.created.push(lines);
    return lines;
  }

  /**
   * Integrate arbitrary field lines from seed points through the vector
   * field defined by `stepFn` (which writes the field vector at a position
   * into its out argument). Each line uses fixed-step RK2 (midpoint):
   *
   *   k1_hat = normalize(stepFn(p))
   *   mid    = p + 0.5 * stepSize * k1_hat
   *   k2_hat = normalize(stepFn(mid))
   *   p_next = p + stepSize * k2_hat
   *
   * Integration runs forward along the field direction implied by the
   * seeds and stops early when the field magnitude collapses below
   * epsilon or a step produces non-finite coordinates. Output encoding
   * matches createDipoleLines (vertex colors = color*opacity, transparent
   * material).
   */
  createCustomLines(
    seeds: THREE.Vector3[],
    stepFn: (p: THREE.Vector3, out: THREE.Vector3) => void,
    stepsPerLine: number,
    stepSize: number,
    color: [number, number, number],
    opacity: number
  ): THREE.LineSegments {
    const steps = Math.max(0, Math.floor(stepsPerLine));
    const maxSegments = seeds.length * steps;
    const positions = new Float32Array(maxSegments * 2 * 3);
    const colors = new Float32Array(maxSegments * 2 * 3);
    const cr = color[0] * opacity;
    const cg = color[1] * opacity;
    const cb = color[2] * opacity;

    let v = 0;
    const current = new THREE.Vector3();
    const next = new THREE.Vector3();
    const mid = new THREE.Vector3();
    const k1 = new THREE.Vector3();
    const k2 = new THREE.Vector3();

    for (const seed of seeds) {
      current.copy(seed);
      for (let s = 0; s < steps; s++) {
        stepFn(current, k1);
        const m1 = k1.length();
        if (!(m1 > FIELD_EPSILON)) break;
        mid.copy(current).addScaledVector(k1, (0.5 * stepSize) / m1);
        stepFn(mid, k2);
        const m2 = k2.length();
        if (!(m2 > FIELD_EPSILON)) break;
        next.copy(current).addScaledVector(k2, stepSize / m2);
        if (!Number.isFinite(next.x + next.y + next.z)) break;

        positions[v * 3] = current.x;
        positions[v * 3 + 1] = current.y;
        positions[v * 3 + 2] = current.z;
        colors[v * 3] = cr;
        colors[v * 3 + 1] = cg;
        colors[v * 3 + 2] = cb;
        v++;
        positions[v * 3] = next.x;
        positions[v * 3 + 1] = next.y;
        positions[v * 3 + 2] = next.z;
        colors[v * 3] = cr;
        colors[v * 3 + 1] = cg;
        colors[v * 3 + 2] = cb;
        v++;
        current.copy(next);
      }
    }

    const geometry = new THREE.BufferGeometry();
    // Trim to the segments actually emitted (early termination shrinks lines).
    geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, v * 3), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, v * 3), 3));

    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = true;
    this.created.push(lines);
    return lines;
  }

  /** Dispose every LineSegments created by this service. */
  dispose(): void {
    for (const lines of this.created) {
      lines.geometry.dispose();
      const material = lines.material;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else {
        material.dispose();
      }
    }
    this.created.length = 0;
  }
}
