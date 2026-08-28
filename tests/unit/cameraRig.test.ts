import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three/webgpu';
import { CameraRig } from '../../src/renderer/shared/CameraRig.js';

/**
 * WS1 frame invalidation (openspec/changes/whole-atlas-performance-
 * optimization): `update()`'s boolean return is the CAMERA_CHANGED signal
 * host.frame() reads once per tick. These tests pin the exact contract: no
 * canvas/DOM required (CameraRig works headless when `canvas` is omitted),
 * a settled rig reports no change, an external mutation between updates is
 * still caught on the next update() call, and an in-flight arrival animation
 * keeps reporting change every tick until it actually finishes.
 */
describe('CameraRig.update(): CAMERA_CHANGED invalidation signal', () => {
  function rigWithCamera(): { rig: CameraRig; camera: PerspectiveCamera } {
    const rig = new CameraRig({});
    const camera = new PerspectiveCamera(60, 1, 0.05, 5000);
    rig.attach(camera);
    return { rig, camera };
  }

  it('a freshly attached, never-mutated rig reports no change', () => {
    const { rig } = rigWithCamera();
    // attach() already applied the adopted transform once; the next tick
    // with no further mutation must be quiet.
    expect(rig.update(0.016)).toBe(false);
  });

  it('setOrbit() dirties the NEXT update() call, not before', () => {
    const { rig } = rigWithCamera();
    rig.update(0.016); // settle from attach()
    rig.setOrbit(45, 90, 12);
    expect(rig.update(0.016)).toBe(true);
    expect(rig.update(0.016)).toBe(false); // consumed; nothing new since
  });

  it('setFov() dirties exactly one subsequent update()', () => {
    const { rig } = rigWithCamera();
    rig.update(0.016);
    rig.setFov(75);
    expect(rig.update(0.016)).toBe(true);
    expect(rig.update(0.016)).toBe(false);
  });

  it('an in-flight arrival animation reports change every tick until it finishes', () => {
    const { rig } = rigWithCamera();
    rig.update(0.016);
    rig.applyArrivalPreset(
      { position: [10, 0, 0], target: [0, 0, 0], fovDeg: 60 },
      1 /* seconds */
    );
    // Mid-flight: still easing, must keep reporting change.
    expect(rig.update(0.3)).toBe(true);
    expect(rig.update(0.3)).toBe(true);
    // Finishes exactly at 1s total elapsed.
    expect(rig.update(0.4)).toBe(true);
    // Settled: no more animation, no more external mutation.
    expect(rig.update(0.016)).toBe(false);
  });

  it('reduced motion collapses an arrival preset to an instant, single-tick change', () => {
    const { rig } = rigWithCamera();
    rig.setReducedMotion(true);
    rig.update(0.016);
    rig.applyArrivalPreset({ position: [10, 0, 0], target: [0, 0, 0], fovDeg: 60 }, 1);
    expect(rig.update(0.016)).toBe(true);
    expect(rig.update(0.016)).toBe(false);
  });

  it('setTarget() dirties exactly one subsequent update()', () => {
    const { rig } = rigWithCamera();
    rig.update(0.016);
    rig.setTarget(new Vector3(1, 2, 3));
    expect(rig.update(0.016)).toBe(true);
    expect(rig.update(0.016)).toBe(false);
  });
});

/**
 * Clip-range policy (phenomena-animation campaign). The host used to create the
 * camera with a fixed far plane of 5000 scene units, which rendered pure BLACK
 * for any destination that framed further out. The rig now derives the range
 * from the orbit distance — and must do so STATELESSLY: deriving it from the
 * live camera would ratchet the far plane upward for the rest of the session
 * after one visit to a large-scale scene.
 */
describe('CameraRig: clip range follows orbit distance without ratcheting', () => {
  const attachCamera = (): { rig: CameraRig; camera: PerspectiveCamera } => {
    const camera = new PerspectiveCamera(55, 1, 0.05, 5000);
    const rig = new CameraRig();
    rig.attach(camera);
    return { rig, camera };
  };

  it('keeps the authored range at close framing', () => {
    const { rig, camera } = attachCamera();
    rig.setOrbit(0, 90, 120);
    rig.update(0.016);
    expect(camera.far).toBe(5000);
    expect(camera.near).toBeCloseTo(0.05, 12);
  });

  it('extends the far plane for a distant framing', () => {
    const { rig, camera } = attachCamera();
    rig.setDistanceLimits(1, 100_000);
    rig.setOrbit(0, 90, 20_000);
    rig.update(0.016);
    expect(camera.far).toBeGreaterThan(20_000);
    expect(camera.near).toBeGreaterThan(0.05);
  });

  it('returns to the authored range when the framing comes back in', () => {
    const { rig, camera } = attachCamera();
    rig.setDistanceLimits(1, 100_000);
    rig.setOrbit(0, 90, 20_000);
    rig.update(0.016);
    const farAtDistance = camera.far;
    rig.setOrbit(0, 90, 120);
    rig.update(0.016);
    expect(camera.far).toBe(5000);
    expect(camera.far).toBeLessThan(farAtDistance);
    expect(camera.near).toBeCloseTo(0.05, 12);
  });

  it('distance limits clamp the live distance immediately', () => {
    const { rig } = attachCamera();
    rig.setOrbit(0, 90, 400);
    rig.setDistanceLimits(1, 100);
    expect(rig.getOrbit().distance).toBe(100);
    expect(rig.getDistanceLimits()).toEqual({ min: 1, max: 100 });
    // Invalid ranges are ignored rather than throwing (lifecycle-called).
    rig.setDistanceLimits(Number.NaN, 10);
    rig.setDistanceLimits(50, 10);
    expect(rig.getDistanceLimits()).toEqual({ min: 1, max: 100 });
  });
});
