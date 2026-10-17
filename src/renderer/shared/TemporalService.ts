/**
 * Bounded temporal reconstruction for the shared HDR image path.
 *
 * This is intentionally camera-only in its first production version. The
 * current HDR frame is resolved against a previous FP16 history using a
 * deterministic low-discrepancy jitter sequence, a far-field camera
 * reprojection offset, and a 3x3 current-frame neighborhood clamp. When a
 * destination/timeline/quality/pass discontinuity is known, history is
 * rejected instead of smearing stale science into the new frame.
 *
 * The service owns exactly two reusable history targets and one fullscreen
 * resolve material. It never allocates per frame. ResourceScope ownership is
 * explicit so repeated resize, route and tier changes can be measured.
 */

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import type { Node, UniformNode } from 'three/webgpu';
import { clamp, max, min, mix, screenUV, texture, uniform, vec2, vec4 } from 'three/tsl';
import type { RendererLike, ResourceScope } from '../../atlas/types';

export type TemporalResetReason =
  | 'initial'
  | 'route-change'
  | 'preset-change'
  | 'timeline-discontinuity'
  | 'camera-cut'
  | 'resize'
  | 'render-scale-change'
  | 'quality-tier-change'
  | 'backend-change'
  | 'pass-variant-change'
  | 'transition-handoff'
  | 'material-change'
  | 'explicit';

export interface TemporalPolicy {
  enabled: boolean;
  /** Maximum history age in resolved frames; always bounded. */
  historyFrames: number;
  /** Pixel jitter amplitude in [0, 1] pixels. */
  jitterScale: number;
  /** Interaction path uses this shorter history cap. */
  interactionHistoryFrames?: number;
}

export interface TemporalDebugSnapshot {
  enabled: boolean;
  valid: boolean;
  historyAge: number;
  historyFrames: number;
  interactionHistoryFrames: number;
  /** R-01/3.2: the cap actually in force this resolve (settled or interaction). */
  activeHistoryCap: number;
  /** R-01/3.2: the history blend weight actually applied by the last resolve. */
  appliedHistoryWeight: number;
  jitterIndex: number;
  jitter: [number, number];
  reprojectionOffset: [number, number];
  lastResetReason: TemporalResetReason;
  recentResetReasons: TemporalResetReason[];
  resetCount: number;
  resolvedFrames: number;
  targetSize: [number, number] | null;
  allocatedTargetCount: number;
  previousCameraMatrix: number[] | null;
  currentCameraMatrix: number[] | null;
}

const MAX_HISTORY_FRAMES = 64;
const MAX_JITTER_SCALE = 1;
const CAMERA_CUT_DISTANCE = 1.5;
const CAMERA_CUT_DOT = 0.82;

// R-08 (design D7): module-scope scratch for the per-resolve camera update.
// The old code cloned a matrix and allocated five vectors/two tuples per
// frame on the present path; steady-state resolve now allocates nothing.
const scratchMatrix = new THREE.Matrix4();
const scratchForward = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchRight = new THREE.Vector3();
const scratchUp = new THREE.Vector3();
const scratchDeltaForward = new THREE.Vector3();
const scratchOffset: [number, number] = [0, 0];
const scratchCameraState: { offset: [number, number]; confidence: number } = {
  offset: scratchOffset,
  confidence: 1
};

function clampHistory(value: number, fallback: number): number {
  return Number.isFinite(value)
    ? Math.max(1, Math.min(MAX_HISTORY_FRAMES, Math.floor(value)))
    : fallback;
}

function clampJitter(value: number): number {
  return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, MAX_JITTER_SCALE) : 0;
}

/** Deterministic Halton value in [0, 1). Index zero is deliberately avoided. */
export function halton(index: number, base: number): number {
  let value = 0;
  let fraction = 1 / base;
  let n = Math.max(1, Math.floor(index));
  while (n > 0) {
    value += (n % base) * fraction;
    n = Math.floor(n / base);
    fraction /= base;
  }
  return value;
}

/** Centered deterministic subpixel sample; no frame-time/random dependency. */
export function temporalJitter(index: number, scale: number): [number, number] {
  const safeScale = clampJitter(scale);
  return [(halton(index + 1, 2) - 0.5) * safeScale, (halton(index + 1, 3) - 0.5) * safeScale];
}

export class TemporalService {
  private readonly renderer: RendererLike;
  private readonly scope: ResourceScope;

  private historyRead: THREE.WebGLRenderTarget | null = null;
  private historyWrite: THREE.WebGLRenderTarget | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly geometry = TemporalService.createFullscreenTriangleGeometry();
  private readonly material = new MeshBasicNodeMaterial();
  private readonly mesh = new THREE.Mesh(this.geometry, this.material);

  private currentTextureNode: ReturnType<typeof texture> | null = null;
  private historyTextureNode: ReturnType<typeof texture> | null = null;
  private readonly texelSize: UniformNode<'vec2', THREE.Vector2> = uniform(new THREE.Vector2(1, 1));
  private readonly historyWeight: UniformNode<'float', number> = uniform(0);
  private readonly reprojectionOffset: UniformNode<'vec2', THREE.Vector2> = uniform(
    new THREE.Vector2()
  );

  private policy: TemporalPolicy = {
    enabled: false,
    historyFrames: 8,
    jitterScale: 0.5,
    interactionHistoryFrames: 1
  };
  private interaction = false;
  private valid = false;
  private historyAge = 0;
  private lastActiveHistoryCap = 1;
  private lastAppliedHistoryWeight = 0;
  private jitterIndex = 0;
  private currentJitter: [number, number] = [0, 0];
  private lastReprojectionOffset: [number, number] = [0, 0];
  private lastResetReason: TemporalResetReason = 'initial';
  private readonly recentResetReasons: TemporalResetReason[] = ['initial'];
  private resetCount = 1;
  private resolvedFrames = 0;
  private previousCamera: THREE.Matrix4 | null = null;
  private currentCamera: THREE.Matrix4 | null = null;
  private previousPosition = new THREE.Vector3();
  private previousForward = new THREE.Vector3();
  private hasPreviousCamera = false;
  private disposed = false;

  constructor(services: { renderer: RendererLike; scope: ResourceScope }) {
    this.renderer = services.renderer;
    this.scope = services.scope;
    this.material.depthTest = false;
    this.material.depthWrite = false;
    this.material.blending = THREE.NoBlending;
    this.material.side = THREE.DoubleSide;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  private static createFullscreenTriangleGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3)
    );
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, -1, 0, 1, 2, 1], 2));
    return geometry;
  }

  setPolicy(policy: Partial<TemporalPolicy>, interaction = false): void {
    if (this.disposed) return;
    const next: TemporalPolicy = {
      enabled: policy.enabled === true,
      historyFrames: clampHistory(policy.historyFrames ?? this.policy.historyFrames, 8),
      jitterScale: clampJitter(policy.jitterScale ?? this.policy.jitterScale),
      interactionHistoryFrames: clampHistory(
        policy.interactionHistoryFrames ?? this.policy.interactionHistoryFrames ?? 1,
        1
      )
    };
    const variantChanged =
      next.enabled !== this.policy.enabled ||
      next.historyFrames !== this.policy.historyFrames ||
      next.jitterScale !== this.policy.jitterScale ||
      next.interactionHistoryFrames !== this.policy.interactionHistoryFrames;
    this.interaction = interaction;
    this.policy = next;
    if (variantChanged) this.reset('pass-variant-change');
  }

  ensureSize(width: number, height: number): void {
    if (this.disposed) return;
    const w = Math.max(2, Math.floor(width));
    const h = Math.max(2, Math.floor(height));
    if (
      this.historyRead !== null &&
      this.historyRead.width === w &&
      this.historyRead.height === h
    ) {
      return;
    }
    const previousRead = this.historyRead;
    const previousWrite = this.historyWrite;
    this.historyRead = this.createHistoryTarget(w, h, 'SharedPost.Temporal.Read');
    this.historyWrite = this.createHistoryTarget(w, h, 'SharedPost.Temporal.Write');
    if (previousRead !== null) this.releaseTarget(previousRead);
    if (previousWrite !== null) this.releaseTarget(previousWrite);
    this.texelSize.value.set(1 / w, 1 / h);
    this.buildResolveGraph();
    this.reset('resize');
  }

  /** Start one resolved frame and return the deterministic camera jitter. */
  beginFrame(): [number, number] {
    if (this.disposed || !this.policy.enabled) return [0, 0];
    this.currentJitter = temporalJitter(this.jitterIndex, this.policy.jitterScale);
    this.jitterIndex = (this.jitterIndex + 1) % 4096;
    // By reference (R-08/D7): the tuple is replaced wholesale above, so a
    // held reference never observes a half-written value. Callers read-only.
    return this.currentJitter;
  }

  /** Resolve current scene HDR into history and make it the presentation source. */
  resolve(currentTexture: THREE.Texture, camera: THREE.PerspectiveCamera): void {
    if (
      this.disposed ||
      !this.policy.enabled ||
      this.historyRead === null ||
      this.historyWrite === null
    ) {
      return;
    }
    if (this.currentTextureNode === null || this.historyTextureNode === null) {
      this.buildResolveGraph();
    }
    if (this.currentTextureNode === null || this.historyTextureNode === null) return;

    const cameraState = this.updateCameraState(camera);
    const settledCap = Math.max(1, this.policy.historyFrames);
    const activeCap = this.interaction
      ? Math.max(1, Math.min(this.policy.historyFrames, this.policy.interactionHistoryFrames ?? 1))
      : settledCap;
    // R-01 (design D2): bound the NUMERATOR by the active cap and divide by
    // the SETTLED cap. The old `historyAge / activeCap` saturated — a history
    // accumulated under the long cap divided by the LOWERED interaction cap
    // is >= 1, so the weight stayed pinned at the 0.94 ceiling exactly when
    // the shorter interaction cap should REDUCE the history's contribution.
    // Forbidden forms that must not be reintroduced: `historyAge /
    // loweredMaxAge` and `min(historyAge, previousMaxAge) / loweredMaxAge` —
    // both stay at the ceiling while history is saturated.
    const historyWeight =
      this.valid && this.historyAge > 0
        ? Math.min(0.94, (Math.min(this.historyAge, activeCap) / settledCap) * 0.94) *
          cameraState.confidence
        : 0;
    this.lastActiveHistoryCap = activeCap;
    this.lastAppliedHistoryWeight = historyWeight;
    this.historyWeight.value = historyWeight;
    this.reprojectionOffset.value.set(cameraState.offset[0], cameraState.offset[1]);
    this.lastReprojectionOffset[0] = cameraState.offset[0];
    this.lastReprojectionOffset[1] = cameraState.offset[1];
    this.currentTextureNode.value = currentTexture;
    this.historyTextureNode.value = this.historyRead.texture;

    const previousTarget = this.renderer.getRenderTarget();
    try {
      this.renderer.setRenderTarget(this.historyWrite);
      this.renderer.render(this.scene, this.camera);
    } finally {
      this.renderer.setRenderTarget(previousTarget as THREE.WebGLRenderTarget | null);
    }

    const swap = this.historyRead;
    this.historyRead = this.historyWrite;
    this.historyWrite = swap;
    // Age accumulates under the ACTIVE cap (it records how many frames the
    // history holds); the weight formula above is what bounds a saturated age
    // on the frame the cap drops, so no history reset is required (D2).
    this.historyAge = Math.min(activeCap, this.historyAge + 1);
    this.valid = true;
    this.resolvedFrames += 1;
  }

  getResolvedTexture(): THREE.Texture | null {
    return this.policy.enabled && this.valid && this.historyRead !== null
      ? this.historyRead.texture
      : null;
  }

  reset(reason: TemporalResetReason): void {
    if (this.disposed) return;
    this.valid = false;
    this.historyAge = 0;
    this.lastResetReason = reason;
    this.recentResetReasons.push(reason);
    if (this.recentResetReasons.length > 16) this.recentResetReasons.shift();
    this.resetCount += 1;
    this.hasPreviousCamera = false;
    this.previousCamera = null;
    this.currentCamera = null;
    this.lastReprojectionOffset = [0, 0];
  }

  getJitter(): [number, number] {
    return [...this.currentJitter];
  }

  /**
   * R-08 (D7): non-copying jitter accessor for the per-frame present path.
   * Returns the internal tuple BY REFERENCE — callers must not mutate it.
   * (`beginFrame` replaces the tuple wholesale, so a held reference never
   * observes a half-written value.)
   */
  getJitterRef(): [number, number] {
    return this.currentJitter;
  }

  /** R-08 (D7): scalar enabled accessor — never build a snapshot for this. */
  isEnabled(): boolean {
    return this.policy.enabled && !this.disposed;
  }

  /**
   * R-07 (D6): stable identity of the temporal OUTPUT PAIR. resolve() swaps
   * read/write every frame, so a single texture id alternates and would force
   * a presentation-graph rebuild per frame; the unordered pair is constant.
   */
  outputPairKey(): string {
    if (this.historyRead === null || this.historyWrite === null) return '';
    const a = this.historyRead.texture.id;
    const b = this.historyWrite.texture.id;
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  getDebugSnapshot(): TemporalDebugSnapshot {
    return {
      enabled: this.policy.enabled,
      valid: this.valid,
      historyAge: this.historyAge,
      historyFrames: this.policy.historyFrames,
      interactionHistoryFrames: this.policy.interactionHistoryFrames ?? 1,
      activeHistoryCap: this.lastActiveHistoryCap,
      appliedHistoryWeight: this.lastAppliedHistoryWeight,
      jitterIndex: this.jitterIndex,
      jitter: [...this.currentJitter],
      reprojectionOffset: [...this.lastReprojectionOffset],
      lastResetReason: this.lastResetReason,
      recentResetReasons: [...this.recentResetReasons],
      resetCount: this.resetCount,
      resolvedFrames: this.resolvedFrames,
      targetSize:
        this.historyRead === null ? null : [this.historyRead.width, this.historyRead.height],
      allocatedTargetCount:
        (this.historyRead === null ? 0 : 1) + (this.historyWrite === null ? 0 : 1),
      previousCameraMatrix: this.previousCamera?.elements
        ? [...this.previousCamera.elements]
        : null,
      currentCameraMatrix: this.currentCamera?.elements ? [...this.currentCamera.elements] : null
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.historyRead !== null) this.releaseTarget(this.historyRead);
    if (this.historyWrite !== null) this.releaseTarget(this.historyWrite);
    this.historyRead = null;
    this.historyWrite = null;
    this.material.dispose();
    this.geometry.dispose();
    this.scene.remove(this.mesh);
  }

  private buildResolveGraph(): void {
    if (this.historyRead === null) return;
    this.currentTextureNode = texture(this.historyRead.texture);
    this.historyTextureNode = texture(this.historyRead.texture);
    const current = this.currentTextureNode;
    const history = this.historyTextureNode;
    const uv = screenUV;
    const currentSample = current.sample(uv);
    // The current-frame neighborhood is the clamp envelope. This is more
    // conservative than trusting history at a high-contrast edge, and keeps
    // critical curves/limbs from accumulating stale colors.
    const sample = (x: number, y: number): Node<'vec4'> =>
      current.sample(uv.add(this.texelSize.mul(vec2(x, y))));
    let neighborhoodMin: Node<'vec3'> = currentSample.rgb;
    let neighborhoodMax: Node<'vec3'> = currentSample.rgb;
    const offsets: Array<[number, number]> = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1]
    ];
    for (const [x, y] of offsets) {
      const neighbor = sample(x, y).rgb;
      neighborhoodMin = min(neighborhoodMin, neighbor) as Node<'vec3'>;
      neighborhoodMax = max(neighborhoodMax, neighbor) as Node<'vec3'>;
    }
    const historySample = history.sample(uv.add(this.reprojectionOffset)).rgb;
    const clampedHistory = clamp(historySample, neighborhoodMin, neighborhoodMax);
    const resolved = mix(currentSample.rgb, clampedHistory, this.historyWeight);
    this.material.colorNode = vec4(resolved, 1);
    this.material.needsUpdate = true;
  }

  private updateCameraState(camera: THREE.PerspectiveCamera): {
    offset: [number, number];
    confidence: number;
  } {
    camera.updateMatrixWorld();
    const matrix = scratchMatrix.copy(camera.matrixWorld);
    const forward = camera.getWorldDirection(scratchForward);
    const position = camera.getWorldPosition(scratchPosition);
    scratchOffset[0] = 0;
    scratchOffset[1] = 0;
    let confidence = 1;
    if (this.hasPreviousCamera) {
      const right = scratchRight.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
      const up = scratchUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      const deltaForward = scratchDeltaForward.copy(this.previousForward).sub(forward);
      scratchOffset[0] = deltaForward.dot(right) * 0.5;
      scratchOffset[1] = deltaForward.dot(up) * 0.5;
      const displacement = position.distanceTo(this.previousPosition);
      const facing = this.previousForward.dot(forward);
      if (displacement > CAMERA_CUT_DISTANCE || facing < CAMERA_CUT_DOT) {
        this.reset('camera-cut');
        scratchOffset[0] = 0;
        scratchOffset[1] = 0;
        confidence = 0;
      } else {
        confidence = THREE.MathUtils.clamp(facing, 0.08, 1);
      }
    }
    this.previousPosition.copy(position);
    this.previousForward.copy(forward);
    // Camera history matrices persist and are COPY-managed (never cloned per
    // frame); they are re-allocated only after a reset clears them (D7).
    if (this.previousCamera === null || this.currentCamera === null) {
      this.previousCamera = matrix.clone();
      this.currentCamera = matrix.clone();
    } else {
      this.previousCamera.copy(this.currentCamera);
      this.currentCamera.copy(matrix);
    }
    this.hasPreviousCamera = true;
    scratchCameraState.confidence = confidence;
    return scratchCameraState;
  }

  private createHistoryTarget(
    width: number,
    height: number,
    name: string
  ): THREE.WebGLRenderTarget {
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.NoColorSpace
    });
    target.texture.name = name;
    this.scope.track('renderTarget', target, () => target.dispose(), width * height * 8);
    return target;
  }

  private releaseTarget(target: THREE.WebGLRenderTarget): void {
    try {
      this.scope.release(target);
    } catch {
      target.dispose();
    }
  }
}
