/**
 * Shared ribbon rendering service — triangle-strip ribbons swept along a spine polyline.
 *
 * Spec sources:
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §5 (RibbonService representation & quality controls)
 * - docs/cosmic-atlas/ARCHITECTURE.md §6 (RibbonService role)
 * Contracts implemented from src/atlas/types.ts: `IRibbonService`, `RibbonHandle`,
 * `RibbonConfig`.
 *
 * Model notes (fidelity: CINEMATIC visualization geometry — makes no physical
 * radiance claim; destinations supply meaningful widths/colors under their model):
 * - World-space flat ribbon. The lateral direction comes from parallel-transported
 *   frames seeded once per spine from a fixed world-up heuristic. There is
 *   deliberately no camera-facing billboarding, so geometry is stable under camera
 *   motion and timeline scrubbing stays deterministic.
 * - Width lerps `widthStart -> widthEnd` along normalized arc length `s`; the taper
 *   mode additionally scales BOTH width and alpha:
 *   'none' -> 1, 'linear' -> 1 - s, 'exponential' -> exp(-3 s).
 * - Vertex RGB lerps `colorStart -> colorEnd`; per-vertex alpha rides in the fourth
 *   component of the RGBA color attribute (three.js USE_COLOR_ALPHA path).
 * - Blending is additive or normal per `RibbonConfig.additive`; the material is
 *   double-sided, transparent, depth-write off (standard translucent-trail setup).
 * - Vertex/index buffers are preallocated for `segments + 1` spine points and reused.
 *   Shorter spines render via drawRange; longer spines are uniformly resampled by
 *   arc length down to capacity so the overall shape survives truncation.
 */

import * as THREE from 'three';
import type { IRibbonService, RibbonConfig, RibbonHandle } from '../../atlas/types';

/** Dot-product threshold above which a seed axis counts as parallel to the tangent. */
const PARALLEL_THRESHOLD = 0.99;
/** Squared length below which a vector is treated as degenerate. */
const DEGENERATE_EPSILON_SQ = 1e-12;
/** Exponential taper decay rate: taper factor = exp(-RATE * s). */
const EXPONENTIAL_TAPER_RATE = 3;

/** Seed axes tried in order when initializing the transported lateral frame. */
const FRAME_SEED_AXES: readonly THREE.Vector3[] = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 0, 0),
];

/** Taper factor applied to both width and alpha at normalized arc length s in [0, 1]. */
function taperFactor(mode: RibbonConfig['taper'], s: number): number {
  switch (mode) {
    case 'linear':
      return 1 - s;
    case 'exponential':
      return Math.exp(-EXPONENTIAL_TAPER_RATE * s);
    case 'none':
    default:
      return 1;
  }
}

/**
 * Strip index buffer for `capacityPoints` spine points (two vertices each).
 * Quads are laid out contiguously so a truncated spine can simply lower the
 * draw range instead of rebuilding indices.
 */
function buildStripIndices(capacityPoints: number): THREE.BufferAttribute {
  const quads = capacityPoints - 1;
  const vertexCount = capacityPoints * 2;
  const indices =
    vertexCount > 65535 ? new Uint32Array(quads * 6) : new Uint16Array(quads * 6);
  for (let i = 0; i < quads; i++) {
    const v = i * 2;
    const o = i * 6;
    indices[o + 0] = v + 0;
    indices[o + 1] = v + 1;
    indices[o + 2] = v + 2;
    indices[o + 3] = v + 2;
    indices[o + 4] = v + 1;
    indices[o + 5] = v + 3;
  }
  return new THREE.BufferAttribute(indices, 1);
}

/**
 * Uniformly resample a polyline by arc length down to exactly `count` points.
 * Used when a caller supplies more spine points than the preallocated capacity.
 */
function resamplePolyline(points: readonly THREE.Vector3[], count: number): THREE.Vector3[] {
  const n = points.length;
  const cumulative = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cumulative[i] = cumulative[i - 1] + points[i - 1].distanceTo(points[i]);
  }
  const total = cumulative[n - 1];

  const out: THREE.Vector3[] = new Array(count);
  if (total <= DEGENERATE_EPSILON_SQ) {
    for (let j = 0; j < count; j++) {
      out[j] = points[0].clone();
    }
    return out;
  }

  let seg = 0;
  for (let j = 0; j < count; j++) {
    const d = total * (j / (count - 1));
    while (seg < n - 2 && cumulative[seg + 1] < d) {
      seg++;
    }
    const span = cumulative[seg + 1] - cumulative[seg];
    const f = span > DEGENERATE_EPSILON_SQ ? (d - cumulative[seg]) / span : 0;
    out[j] = new THREE.Vector3().lerpVectors(points[seg], points[seg + 1], f);
  }
  return out;
}

/** Concrete ribbon handle. One GPU geometry + material pair per ribbon. */
class RibbonHandleImpl implements RibbonHandle {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;

  private readonly cfg: RibbonConfig;
  private readonly capacityPoints: number;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly tangents: Float32Array;
  private readonly positionAttr: THREE.BufferAttribute;
  private readonly colorAttr: THREE.BufferAttribute;
  private readonly vecA = new THREE.Vector3();
  private readonly vecB = new THREE.Vector3();
  private readonly lateral = new THREE.Vector3();
  private readonly onRelease: () => void;
  private released = false;

  constructor(config: RibbonConfig, onRelease: () => void) {
    this.cfg = {
      ...config,
      colorStart: [...config.colorStart] as [number, number, number],
      colorEnd: [...config.colorEnd] as [number, number, number],
    };
    this.onRelease = onRelease;
    this.capacityPoints = Math.max(2, Math.floor(config.segments) + 1);

    const vertexCount = this.capacityPoints * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 4);
    this.tangents = new Float32Array(this.capacityPoints * 3);

    const geometry = new THREE.BufferGeometry();
    this.positionAttr = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttr = new THREE.BufferAttribute(this.colors, 4);
    geometry.setAttribute('position', this.positionAttr);
    geometry.setAttribute('color', this.colorAttr);
    geometry.setIndex(buildStripIndices(this.capacityPoints));
    geometry.setDrawRange(0, 0);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: config.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    // Vertices are rewritten wholesale on setSpine; maintaining a bounding sphere
    // across partial rewrites is not worth it for ribbon-sized vertex counts.
    this.mesh.frustumCulled = false;
  }

  setSpine(points: THREE.Vector3[]): void {
    if (this.released) {
      return;
    }
    const geometry = this.mesh.geometry;
    if (!points || points.length < 2) {
      geometry.setDrawRange(0, 0);
      return;
    }

    const spine =
      points.length > this.capacityPoints
        ? resamplePolyline(points, this.capacityPoints)
        : points;
    const n = spine.length;

    this.computeTangents(spine, n);
    this.seedLateralFrame();

    const { positions, colors, cfg } = this;
    const inv = 1 / (n - 1);
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        this.transportLateral(i);
      }

      const s = i * inv;
      const taper = taperFactor(cfg.taper, s);
      const halfWidth =
        0.5 * Math.max(0, THREE.MathUtils.lerp(cfg.widthStart, cfg.widthEnd, s)) * taper;

      const p = spine[i];
      const lx = this.lateral.x * halfWidth;
      const ly = this.lateral.y * halfWidth;
      const lz = this.lateral.z * halfWidth;

      const r = THREE.MathUtils.lerp(cfg.colorStart[0], cfg.colorEnd[0], s);
      const g = THREE.MathUtils.lerp(cfg.colorStart[1], cfg.colorEnd[1], s);
      const b = THREE.MathUtils.lerp(cfg.colorStart[2], cfg.colorEnd[2], s);
      const a = taper;

      const v0 = i * 6; // (i * 2) * 3
      positions[v0 + 0] = p.x - lx;
      positions[v0 + 1] = p.y - ly;
      positions[v0 + 2] = p.z - lz;
      const v1 = v0 + 3;
      positions[v1 + 0] = p.x + lx;
      positions[v1 + 1] = p.y + ly;
      positions[v1 + 2] = p.z + lz;

      const c0 = i * 8; // (i * 2) * 4
      colors[c0 + 0] = r;
      colors[c0 + 1] = g;
      colors[c0 + 2] = b;
      colors[c0 + 3] = a;
      const c1 = c0 + 4;
      colors[c1 + 0] = r;
      colors[c1 + 1] = g;
      colors[c1 + 2] = b;
      colors[c1 + 3] = a;
    }

    geometry.setDrawRange(0, (n - 1) * 6);
    this.positionAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
  }

  object3d(): THREE.Object3D {
    return this.mesh;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.onRelease();
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }

  /** Per-point unit tangents with midpoint averaging; degenerate joints inherit. */
  private computeTangents(spine: readonly THREE.Vector3[], n: number): void {
    const t = this.tangents;
    for (let i = 0; i < n; i++) {
      if (i === 0) {
        this.vecA.subVectors(spine[1], spine[0]);
      } else if (i === n - 1) {
        this.vecA.subVectors(spine[n - 1], spine[n - 2]);
      } else {
        this.vecA.subVectors(spine[i], spine[i - 1]);
        this.vecB.subVectors(spine[i + 1], spine[i]);
        this.vecA.add(this.vecB);
      }
      if (this.vecA.lengthSq() <= DEGENERATE_EPSILON_SQ) {
        if (i > 0) {
          t[i * 3 + 0] = t[(i - 1) * 3 + 0];
          t[i * 3 + 1] = t[(i - 1) * 3 + 1];
          t[i * 3 + 2] = t[(i - 1) * 3 + 2];
          continue;
        }
        this.vecA.set(0, 1, 0);
      }
      this.vecA.normalize();
      t[i * 3 + 0] = this.vecA.x;
      t[i * 3 + 1] = this.vecA.y;
      t[i * 3 + 2] = this.vecA.z;
    }
  }

  /** Fixed-up heuristic: project the least-parallel seed axis onto the first tangent. */
  private seedLateralFrame(): void {
    const t = this.tangents;
    this.vecB.set(t[0], t[1], t[2]);
    let seed: THREE.Vector3 = FRAME_SEED_AXES[FRAME_SEED_AXES.length - 1];
    for (const axis of FRAME_SEED_AXES) {
      if (Math.abs(axis.dot(this.vecB)) < PARALLEL_THRESHOLD) {
        seed = axis;
        break;
      }
    }
    this.lateral.copy(seed).addScaledVector(this.vecB, -seed.dot(this.vecB));
    if (this.lateral.lengthSq() <= DEGENERATE_EPSILON_SQ) {
      // Unreachable given the seed test; kept as a hard numerical guard.
      this.lateral.set(1, 0, 0);
    }
    this.lateral.normalize();
  }

  /** Project the previous lateral direction onto the plane normal to tangent i. */
  private transportLateral(i: number): void {
    const t = this.tangents;
    this.vecB.set(t[i * 3 + 0], t[i * 3 + 1], t[i * 3 + 2]);
    this.lateral.addScaledVector(this.vecB, -this.vecB.dot(this.lateral));
    if (this.lateral.lengthSq() <= DEGENERATE_EPSILON_SQ) {
      // Hairpin reversal put the tangent along the lateral axis: reseed from world up.
      const up = FRAME_SEED_AXES[0];
      this.lateral.copy(up).addScaledVector(this.vecB, -up.dot(this.vecB));
      if (this.lateral.lengthSq() <= DEGENERATE_EPSILON_SQ) {
        this.lateral.set(1, 0, 0);
      }
    }
    this.lateral.normalize();
  }
}

/**
 * Host-owned ribbon factory. Tracks live handles so `dispose()` releases every
 * ribbon it created, matching the deterministic-disposal policy of the atlas.
 */
export class RibbonService implements IRibbonService {
  private readonly handles = new Set<RibbonHandleImpl>();
  private disposed = false;

  createRibbon(config: RibbonConfig): RibbonHandle {
    if (this.disposed) {
      throw new Error('RibbonService has been disposed');
    }
    const handle = new RibbonHandleImpl(config, () => this.handles.delete(handle));
    this.handles.add(handle);
    return handle;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const handle of Array.from(this.handles)) {
      handle.dispose();
    }
    this.handles.clear();
  }
}
