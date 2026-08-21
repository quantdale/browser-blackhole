/**
 * CameraController (M0-05): PerspectiveCamera + OrbitControls behind one
 * abstraction with a canonical basis export and a dispose lifecycle.
 *
 * The canonical basis (position/right/up/forward) is what the renderer maps
 * into shader uniforms; nothing else may read camera internals for shading.
 */

import { Matrix4, PerspectiveCamera, Vector3 } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Vec3 } from '../shaders/cameraRayMath.js';

export interface CameraBasis {
  position: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  tanHalfFovY: number;
  aspect: number;
}

export interface ObserverCameraInput {
  positionRg: Vec3;
  targetRg: Vec3;
  up: Vec3;
  fovYDeg: number;
}

/**
 * Extracts the canonical orthonormal basis from a world matrix.
 * Three.js cameras look down their local -Z, so forward = -column2.
 * Pure over plain arrays so it is unit-testable without a renderer.
 */
export function extractBasisFromMatrix(
  elements: ArrayLike<number>,
  position: { x: number; y: number; z: number },
  fovYDeg: number,
  aspect: number
): CameraBasis {
  const right: Vec3 = [elements[0] as number, elements[1] as number, elements[2] as number];
  const up: Vec3 = [elements[4] as number, elements[5] as number, elements[6] as number];
  const backZ: Vec3 = [elements[8] as number, elements[9] as number, elements[10] as number];
  const forward: Vec3 = [-backZ[0], -backZ[1], -backZ[2]];
  return {
    position: [position.x, position.y, position.z],
    right,
    up,
    forward,
    tanHalfFovY: Math.tan((fovYDeg * Math.PI) / 360),
    aspect
  };
}

export class CameraController {
  readonly camera: PerspectiveCamera;

  private readonly controls: OrbitControls;
  private readonly changeListeners = new Set<() => void>();
  private lastInputTimeMs = 0;
  private disposed = false;

  constructor(canvas: HTMLElement, initial: ObserverCameraInput) {
    this.camera = new PerspectiveCamera(initial.fovYDeg, 1, 0.1, 1e6);
    this.camera.position.set(...initial.positionRg);
    this.camera.up.set(...initial.up);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(...initial.targetRg);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.update();

    this.controls.addEventListener('change', this.handleChange);
    this.controls.addEventListener('start', this.handleStart);
  }

  private handleChange = (): void => {
    for (const listener of this.changeListeners) listener();
  };

  private handleStart = (): void => {
    this.lastInputTimeMs = performance.now();
  };

  /** Registers a change listener; returns an unsubscribe function. */
  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  /** Milliseconds since the last user interaction started on the controls. */
  msSinceLastInput(now: number): number {
    return now - this.lastInputTimeMs;
  }

  /**
   * Advances damping. Returns true when the camera transform changed this
   * frame (user interaction or settling damping).
   */
  update(deltaSeconds?: number): boolean {
    if (this.disposed) return false;
    return this.controls.update(deltaSeconds ?? null);
  }

  /** Canonical basis export; updates the world matrix first. */
  getBasis(): CameraBasis {
    this.camera.updateMatrixWorld();
    return extractBasisFromMatrix(
      this.camera.matrixWorld.elements,
      this.camera.position,
      this.camera.fov,
      this.camera.aspect
    );
  }

  /** Applies canonical observer state (preset load / reset view). */
  applyObserverState(state: ObserverCameraInput): void {
    this.camera.position.set(...state.positionRg);
    this.camera.up.set(...state.up);
    this.camera.fov = state.fovYDeg;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(...state.targetRg);
    this.controls.update();
  }

  setEnabled(enabled: boolean): void {
    this.controls.enabled = enabled;
  }

  /** Updates the perspective aspect ratio on container resize. */
  setAspect(aspect: number): void {
    if (!Number.isFinite(aspect) || aspect <= 0) return;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Removes listeners and control state; safe to call once. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.controls.removeEventListener('change', this.handleChange);
    this.controls.removeEventListener('start', this.handleStart);
    this.controls.dispose();
    this.changeListeners.clear();
  }
}

/** Helper used by tests to build a look-at world matrix without a renderer. */
export function lookAtMatrix(eye: Vec3, target: Vec3, up: Vec3): Matrix4 {
  const m = new Matrix4();
  const e = new Vector3(...eye);
  const t = new Vector3(...target);
  const u = new Vector3(...up);
  m.lookAt(e, t, u);
  return m;
}
