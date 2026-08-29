/**
 * StrandService — bounded tube/impostor presentation for continuous streams.
 *
 * The input spine is authoritative. The service only transports a local frame
 * around that spine and supplies a variable elliptical cross-section, radial
 * opacity, longitudinal color/temperature variation, and seeded clumping. It
 * is a presentation layer for TDE debris and similar media, not a hydrodynamic
 * solver. RibbonService remains the low-tier/debug fallback.
 */

import * as THREE from 'three';
import type { IStrandService, StrandConfig, StrandHandle } from '../../atlas/types';
import { CINEMATIC_EMISSIVE_LAYER } from './visualLayers.js';

const MIN_POINTS = 2;
const MIN_RADIAL_SEGMENTS = 4;
const MAX_RADIAL_SEGMENTS = 16;
const EPSILON_SQ = 1e-12;
const FRAME_SEED_AXES: readonly THREE.Vector3[] = [
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(1, 0, 0)
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hash01(value: number): number {
  const x = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function resamplePolyline(points: readonly THREE.Vector3[], count: number): THREE.Vector3[] {
  if (points.length <= count) return [...points];
  const cumulative = new Float64Array(points.length);
  for (let i = 1; i < points.length; i += 1) {
    cumulative[i] = cumulative[i - 1]! + points[i - 1]!.distanceTo(points[i]!);
  }
  const total = cumulative[cumulative.length - 1] ?? 0;
  if (total <= EPSILON_SQ) return Array.from({ length: count }, () => points[0]!.clone());
  const output: THREE.Vector3[] = [];
  let segment = 0;
  for (let i = 0; i < count; i += 1) {
    const distance = (total * i) / (count - 1);
    while (segment < points.length - 2 && cumulative[segment + 1]! < distance) segment += 1;
    const start = cumulative[segment] ?? 0;
    const end = cumulative[segment + 1] ?? start;
    const amount = end > start ? (distance - start) / (end - start) : 0;
    output.push(new THREE.Vector3().lerpVectors(points[segment]!, points[segment + 1]!, amount));
  }
  return output;
}

function buildTubeIndices(points: number, radial: number): THREE.BufferAttribute {
  const quadCount = (points - 1) * radial;
  const vertices = points * (radial + 1);
  const indices =
    vertices > 65535 ? new Uint32Array(quadCount * 6) : new Uint16Array(quadCount * 6);
  let cursor = 0;
  for (let i = 0; i < points - 1; i += 1) {
    for (let j = 0; j < radial; j += 1) {
      const a = i * (radial + 1) + j;
      const b = a + 1;
      const c = (i + 1) * (radial + 1) + j;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  return new THREE.BufferAttribute(indices, 1);
}

class StrandHandleImpl implements StrandHandle {
  private readonly config: StrandConfig;
  private readonly root: THREE.Group;
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly coreGeometry: THREE.BufferGeometry;
  private readonly coreMaterial: THREE.LineBasicMaterial;
  private readonly coreMesh: THREE.Line;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly corePositions: Float32Array;
  private readonly coreColors: Float32Array;
  private readonly positionAttribute: THREE.BufferAttribute;
  private readonly colorAttribute: THREE.BufferAttribute;
  private readonly corePositionAttribute: THREE.BufferAttribute;
  private readonly coreColorAttribute: THREE.BufferAttribute;
  private readonly tangents: THREE.Vector3[];
  private readonly laterals: THREE.Vector3[];
  private readonly binormals: THREE.Vector3[];
  private readonly scratch = new THREE.Vector3();
  private quality = 1;
  private pointCount = 0;
  private released = false;

  constructor(config: StrandConfig, onRelease: () => void) {
    this.config = {
      ...config,
      radialSegments: clamp(
        Math.floor(config.radialSegments ?? 10),
        MIN_RADIAL_SEGMENTS,
        MAX_RADIAL_SEGMENTS
      ),
      aspectStart: clamp(config.aspectStart ?? 0.7, 0.15, 1),
      aspectEnd: clamp(config.aspectEnd ?? 0.45, 0.15, 1),
      opacityStart: clamp(config.opacityStart, 0, 1),
      opacityEnd: clamp(config.opacityEnd, 0, 1),
      temperatureVariation: clamp(config.temperatureVariation ?? 0.25, 0, 1),
      clumpStrength: clamp(config.clumpStrength ?? 0.2, 0, 1),
      radianceScale: clamp(config.radianceScale ?? 1, 0, 8),
      coreOpacity: clamp(config.coreOpacity ?? 0.55, 0, 1),
      colorStart: [...config.colorStart] as [number, number, number],
      colorEnd: [...config.colorEnd] as [number, number, number]
    };
    const pointCapacity = Math.max(MIN_POINTS, Math.floor(config.segments) + 1);
    const radial = this.config.radialSegments!;
    this.positions = new Float32Array(pointCapacity * (radial + 1) * 3);
    this.colors = new Float32Array(pointCapacity * (radial + 1) * 4);
    this.corePositions = new Float32Array(pointCapacity * 3);
    this.coreColors = new Float32Array(pointCapacity * 3);
    this.tangents = Array.from({ length: pointCapacity }, () => new THREE.Vector3(0, 1, 0));
    this.laterals = Array.from({ length: pointCapacity }, () => new THREE.Vector3(1, 0, 0));
    this.binormals = Array.from({ length: pointCapacity }, () => new THREE.Vector3(0, 0, 1));

    this.geometry = new THREE.BufferGeometry();
    this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
    this.colorAttribute = new THREE.BufferAttribute(this.colors, 4);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('color', this.colorAttribute);
    this.geometry.setIndex(buildTubeIndices(pointCapacity, radial));
    this.geometry.setDrawRange(0, 0);

    // A narrow centerline is a deliberate part of the high-quality stream
    // representation, not a second source of motion: it is copied directly
    // from the authoritative spine. It keeps a subpixel tube from vanishing
    // at long standoffs while the swept surface supplies the cross-section,
    // clumping and temperature profile.
    this.coreGeometry = new THREE.BufferGeometry();
    this.corePositionAttribute = new THREE.BufferAttribute(this.corePositions, 3);
    this.coreColorAttribute = new THREE.BufferAttribute(this.coreColors, 3);
    this.coreGeometry.setAttribute('position', this.corePositionAttribute);
    this.coreGeometry.setAttribute('color', this.coreColorAttribute);
    this.coreGeometry.setDrawRange(0, 0);
    this.coreMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: config.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.coreMaterial.userData['cinematicEmissive'] = true;
    this.coreMaterial.userData['strandRepresentation'] = 'authoritative-spine-core';
    this.coreMesh = new THREE.Line(this.coreGeometry, this.coreMaterial);
    this.coreMesh.frustumCulled = false;
    this.coreMesh.renderOrder = 1;
    this.coreMesh.name = 'StrandCore';
    this.coreMesh.layers.enable(CINEMATIC_EMISSIVE_LAYER);

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      // Strands are a translucent presentation layer over the destination's
      // site marker/volume. Their depth is already represented by the
      // authoritative spine; testing against an opaque marker can erase the
      // near-BH portion of a tube at exactly the framing where it is needed.
      depthTest: false,
      alphaTest: 0.002,
      side: THREE.DoubleSide,
      blending: config.additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.material.userData['cinematicEmissive'] = true;
    this.material.userData['strandRepresentation'] = 'tube';
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.enable(CINEMATIC_EMISSIVE_LAYER);
    this.mesh.name = 'StrandTube';
    this.root = new THREE.Group();
    this.root.name = 'StrandService.Tube';
    this.root.frustumCulled = false;
    this.root.add(this.mesh);
    this.root.add(this.coreMesh);
    this.onRelease = onRelease;
  }

  private readonly onRelease: () => void;

  setSpine(points: THREE.Vector3[]): void {
    if (this.released || points.length < MIN_POINTS) {
      this.geometry.setDrawRange(0, 0);
      this.coreGeometry.setDrawRange(0, 0);
      return;
    }
    const capacity = this.tangents.length;
    const spine = points.length > capacity ? resamplePolyline(points, capacity) : points;
    this.pointCount = spine.length;
    this.computeFrames(spine);

    const radial = this.config.radialSegments!;
    const seed = this.config.clumpSeed;
    for (let i = 0; i < spine.length; i += 1) {
      const s = spine.length > 1 ? i / (spine.length - 1) : 0;
      const baseWidth = Math.max(
        1e-4,
        THREE.MathUtils.lerp(this.config.widthStart, this.config.widthEnd, s)
      );
      const clump = 1 + (hash01(seed + i * 1.37) - 0.5) * 2 * this.config.clumpStrength!;
      const radiusX = baseWidth * 0.5 * clump;
      const radiusY =
        radiusX * THREE.MathUtils.lerp(this.config.aspectStart!, this.config.aspectEnd!, s);
      const baseOpacity = THREE.MathUtils.lerp(this.config.opacityStart, this.config.opacityEnd, s);
      const tempWave = Math.sin(seed * 0.011 + s * Math.PI * 7) * this.config.temperatureVariation!;
      const colorT = clamp(s + tempWave * 0.18, 0, 1);
      const r = THREE.MathUtils.lerp(this.config.colorStart[0], this.config.colorEnd[0], colorT);
      const g = THREE.MathUtils.lerp(this.config.colorStart[1], this.config.colorEnd[1], colorT);
      const b = THREE.MathUtils.lerp(this.config.colorStart[2], this.config.colorEnd[2], colorT);
      const radianceScale = this.config.radianceScale!;
      const coreIndex = i * 3;
      this.corePositions[coreIndex] = spine[i]!.x;
      this.corePositions[coreIndex + 1] = spine[i]!.y;
      this.corePositions[coreIndex + 2] = spine[i]!.z;
      this.coreColors[coreIndex] = r * radianceScale;
      this.coreColors[coreIndex + 1] = g * radianceScale;
      this.coreColors[coreIndex + 2] = b * radianceScale;
      const lateral = this.laterals[i]!;
      const binormal = this.binormals[i]!;
      for (let j = 0; j <= radial; j += 1) {
        const angle = (j / radial) * Math.PI * 2;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const point = spine[i]!;
        const vertex = this.scratch
          .copy(point)
          .addScaledVector(lateral, cos * radiusX)
          .addScaledVector(binormal, sin * radiusY);
        const vertexIndex = (i * (radial + 1) + j) * 3;
        this.positions[vertexIndex] = vertex.x;
        this.positions[vertexIndex + 1] = vertex.y;
        this.positions[vertexIndex + 2] = vertex.z;

        // The center-facing half of the ellipse is denser/brighter than its
        // silhouette, giving the tube a radial opacity profile without a
        // second noisy material. Alpha remains continuous at the seam.
        const radialProfile = 0.2 + 0.8 * Math.max(0, cos * 0.5 + 0.5);
        const colorIndex = (i * (radial + 1) + j) * 4;
        this.colors[colorIndex] = r * radianceScale;
        this.colors[colorIndex + 1] = g * radianceScale;
        this.colors[colorIndex + 2] = b * radianceScale;
        this.colors[colorIndex + 3] = clamp(baseOpacity * radialProfile, 0, 1);
      }
    }
    this.geometry.setDrawRange(0, (spine.length - 1) * radial * 6);
    this.coreGeometry.setDrawRange(0, spine.length);
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.corePositionAttribute.needsUpdate = true;
    this.coreColorAttribute.needsUpdate = true;
  }

  setQuality(quality: number): void {
    this.quality = clamp(Number.isFinite(quality) ? quality : 1, 0, 1);
    this.material.opacity = this.quality;
    this.coreMaterial.opacity = this.config.coreOpacity! * this.quality;
    this.root.visible = this.quality > 0.02;
    if (this.pointCount > 1) this.colorAttribute.needsUpdate = true;
  }

  object3d(): THREE.Object3D {
    return this.root;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible && this.quality > 0.02;
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      representation: 'tube',
      pointCount: this.pointCount,
      radialSegments: this.config.radialSegments,
      quality: this.quality,
      clumpStrength: this.config.clumpStrength,
      radianceScale: this.config.radianceScale,
      coreOpacity: this.config.coreOpacity,
      temperatureVariation: this.config.temperatureVariation,
      authoritativeSpine: true
    };
  }

  dispose(): void {
    if (this.released) return;
    this.released = true;
    this.onRelease();
    this.root.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    this.coreGeometry.dispose();
    this.coreMaterial.dispose();
  }

  private computeFrames(spine: readonly THREE.Vector3[]): void {
    for (let i = 0; i < spine.length; i += 1) {
      const tangent = this.tangents[i]!;
      if (i === 0) tangent.subVectors(spine[1]!, spine[0]!);
      else if (i === spine.length - 1) tangent.subVectors(spine[i]!, spine[i - 1]!);
      else tangent.subVectors(spine[i + 1]!, spine[i - 1]!);
      if (tangent.lengthSq() <= EPSILON_SQ) {
        if (i > 0) tangent.copy(this.tangents[i - 1]!);
        else tangent.set(0, 1, 0);
      }
      tangent.normalize();
    }

    const firstTangent = this.tangents[0]!;
    let seed = FRAME_SEED_AXES[FRAME_SEED_AXES.length - 1]!;
    for (const axis of FRAME_SEED_AXES) {
      if (Math.abs(axis.dot(firstTangent)) < 0.95) {
        seed = axis;
        break;
      }
    }
    this.laterals[0]!.copy(seed).addScaledVector(firstTangent, -seed.dot(firstTangent)).normalize();
    this.binormals[0]!.crossVectors(firstTangent, this.laterals[0]!).normalize();
    for (let i = 1; i < spine.length; i += 1) {
      const tangent = this.tangents[i]!;
      const lateral = this.laterals[i]!.copy(this.laterals[i - 1]!);
      lateral.addScaledVector(tangent, -lateral.dot(tangent));
      if (lateral.lengthSq() <= EPSILON_SQ) {
        lateral.copy(FRAME_SEED_AXES[0]!);
        lateral.addScaledVector(tangent, -lateral.dot(tangent));
      }
      lateral.normalize();
      this.binormals[i]!.crossVectors(tangent, lateral).normalize();
    }
  }
}

export class StrandService implements IStrandService {
  private readonly handles = new Set<StrandHandleImpl>();
  private disposed = false;

  createStrand(config: StrandConfig): StrandHandle {
    if (this.disposed) throw new Error('StrandService has been disposed');
    const handle = new StrandHandleImpl(config, () => this.handles.delete(handle));
    this.handles.add(handle);
    return handle;
  }

  setQuality(quality: number): void {
    for (const handle of this.handles) handle.setQuality(quality);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of [...this.handles]) handle.dispose();
    this.handles.clear();
  }
}
