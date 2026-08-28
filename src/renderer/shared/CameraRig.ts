/**
 * Shared orbit camera rig for Cosmic Atlas.
 *
 * Implements {@link ICameraRig} from `src/atlas/types.ts` (host service
 * contract, implemented under `src/renderer/shared/`).
 *
 * Spec sources:
 * - docs/cosmic-atlas/ARCHITECTURE.md §6 "CameraRig" — orbit/free camera,
 *   destination arrival framing, transition departure/arrival transforms,
 *   reduced-motion mode.
 * - docs/UI_UX.md §2 "Camera interaction" — drag/touch orbit, wheel dolly,
 *   bounded radius, optional keyboard control. Per that section this rig is
 *   an interaction mechanism feeding observer/camera state, NOT a
 *   relativistic observer model.
 * - docs/UI_UX.md §5 "Parameter safety" — every angle/dolly/FOV input is
 *   bounded and validated; extreme values are clamped, never rejected
 *   silently.
 *
 * Implementation notes:
 * - Self-contained spherical-coordinate orbit built on `THREE.Spherical`;
 *   deliberately avoids `OrbitControls` so the WebGPU/TSL pipeline carries
 *   no three/examples dependency.
 * - Polar angle is clamped to [9°, 171°]; dolly distance to a configurable
 *   [min, max] (defaults [0.5, 500] scene units; r_g for compact objects).
 * - Arrival presets ease with smoothstep over `animateSeconds`; with
 *   reduced motion enabled they jump instantly.
 * - Pointer/wheel listeners are registered passive and never call
 *   `preventDefault()`; keyboard shortcuts call `preventDefault()` only for
 *   keys this rig consumes. All listeners are removed on `dispose()`.
 */

import { MathUtils, Spherical, Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import type { CameraArrivalPreset, ICameraRig } from '../../atlas/types';

// ---------------------------------------------------------------------------
// Tunables (docs/UI_UX.md §5 — bounded validated ranges)
// ---------------------------------------------------------------------------

/** Polar angle bounds in degrees; keeps the orbit away from the poles. */
const POLAR_MIN_DEG = 9;
const POLAR_MAX_DEG = 171;

/** Field-of-view bounds in degrees. */
const FOV_MIN_DEG = 10;
const FOV_MAX_DEG = 120;
const FOV_DEFAULT_DEG = 60;

/** Default dolly bounds in scene units. */
const DISTANCE_DEFAULT_MIN = 0.5;
const DISTANCE_DEFAULT_MAX = 500;

/**
 * Clip-range policy (see applyToCamera). `far` covers content out to several
 * times the orbit distance — enough for a scene whose extent is comparable to
 * the framing distance — and `near` scales with distance so depth precision
 * does not collapse when the view pulls far back, while never rising above the
 * authored floor at close range.
 */
const CLIP_FAR_DISTANCE_FACTOR = 8;
/** Authored default far plane; the clip range never goes below this. */
const CLIP_FAR_DEFAULT = 5000;
const CLIP_NEAR_DISTANCE_FACTOR = 1e-4;
const CLIP_NEAR_FLOOR = 0.05;

/** Dolly used in the pristine state before any camera/preset configures the rig. */
const DISTANCE_DEFAULT = 10;

/** Pointer-drag sensitivity in degrees per CSS pixel. */
const DRAG_DEGREES_PER_PIXEL = 0.25;

/** Exponential wheel-dolly sensitivity per (normalized) pixel of `deltaY`. */
const WHEEL_ZOOM_PER_PIXEL = 0.0015;

/** Multiplier applied to `deltaY` when `deltaMode` reports lines/pages. */
const WHEEL_DELTA_LINE_PIXELS = 16;
const WHEEL_DELTA_PAGE_PIXELS = 512;

/** Keyboard increments (docs/UI_UX.md §2 — keyboard control). */
const KEY_ORBIT_DEG = 5;
const KEY_ZOOM_FACTOR = 1.15;

/** Squared-length below which an interpolated up vector is treated as degenerate. */
const UP_EPSILON_SQ = 1e-12;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CameraRigOptions {
  /**
   * Canvas that receives pointer, wheel, and keyboard input. Focus and
   * `tabindex` management belong to the UI layer; this rig only listens.
   * Omit for headless/cinematic use without input binding.
   */
  canvas?: HTMLCanvasElement | null;
  /** Minimum orbit distance in scene units. Must satisfy `0 < min < max`. */
  minDistance?: number;
  /** Maximum orbit distance in scene units. Must satisfy `0 < min < max`. */
  maxDistance?: number;
}

/**
 * In-flight arrival animation. Endpoints are stored as `from + delta` pairs
 * so each `update()` is a single multiply-add; azimuth travels the shortest
 * arc so accumulated drag rotation never produces extra spins.
 */
interface OrbitAnimation {
  elapsedSeconds: number;
  durationSeconds: number;
  fromAzimuthDeg: number;
  deltaAzimuthDeg: number;
  fromPolarDeg: number;
  deltaPolarDeg: number;
  fromDistance: number;
  deltaDistance: number;
  fromFovDeg: number;
  deltaFovDeg: number;
  fromTarget: Vector3;
  deltaTarget: Vector3;
  fromUp: Vector3;
  deltaUp: Vector3;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Validates a numeric input, failing loudly on contract violations. */
function requireFinite(value: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`CameraRig: ${label} must be a finite number (got ${String(value)}).`);
  }
  return value;
}

/** Shortest signed delta in degrees from `fromDeg` to `toDeg`, in [-180, 180]. */
function shortestArcDeltaDeg(fromDeg: number, toDeg: number): number {
  let delta = (toDeg - fromDeg) % 360;
  if (delta > 180) delta -= 360;
  else if (delta < -180) delta += 360;
  return delta;
}

/** Hermite smoothstep easing on a clamped [0, 1] progress value. */
function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// ---------------------------------------------------------------------------
// CameraRig
// ---------------------------------------------------------------------------

/**
 * Orbit camera controller. State lives entirely in spherical coordinates
 * (azimuth/polar in degrees, distance in scene units) around a target point;
 * the attached `PerspectiveCamera` is written to from `update()` whenever the
 * state changed. One rig drives one camera at a time.
 */
export class CameraRig implements ICameraRig {
  private camera: PerspectiveCamera | null = null;
  private readonly canvas: HTMLCanvasElement | null;
  private minDistance: number;
  private maxDistance: number;

  // Orbit state (degrees / scene units).
  private azimuthDeg = 0;
  private polarDeg = 90;
  private distance = DISTANCE_DEFAULT;
  private fovDeg = FOV_DEFAULT_DEG;
  private readonly target = new Vector3(0, 0, 0);
  private readonly up = new Vector3(0, 1, 0);

  private controlsEnabled = true;
  private reducedMotion = false;
  /** True once any explicit state mutation happened (presets, setters, input). */
  private configured = false;
  private dirty = false;
  private animation: OrbitAnimation | null = null;

  private dragPointerId: number | null = null;
  private lastDragX = 0;
  private lastDragY = 0;

  private readonly scratchSpherical = new Spherical();
  private readonly scratchVector = new Vector3();

  constructor(options: CameraRigOptions = {}) {
    this.canvas = options.canvas ?? null;
    const min = requireFinite(options.minDistance ?? DISTANCE_DEFAULT_MIN, 'options.minDistance');
    const max = requireFinite(options.maxDistance ?? DISTANCE_DEFAULT_MAX, 'options.maxDistance');
    if (!(min > 0) || !(max > min)) {
      throw new RangeError(
        `CameraRig: distance bounds must satisfy 0 < minDistance < maxDistance (got [${min}, ${max}]).`
      );
    }
    this.minDistance = min;
    this.maxDistance = max;

    if (this.canvas !== null) {
      // Passive per contract; the rig never calls preventDefault() here, so
      // page scrolling/gesture handling stays under the browser's control.
      this.canvas.addEventListener('pointerdown', this.onPointerDown, { passive: true });
      this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
      this.canvas.addEventListener('pointerup', this.onPointerUp, { passive: true });
      this.canvas.addEventListener('pointercancel', this.onPointerCancel, { passive: true });
      this.canvas.addEventListener('wheel', this.onWheel, { passive: true });
      // Keyboard is intentionally NOT passive: handled keys preventDefault()
      // so arrow-key focus scrolling does not fight the camera nudge.
      this.canvas.addEventListener('keydown', this.onKeyDown);
    }
  }

  // -------------------------------------------------------------------------
  // ICameraRig
  // -------------------------------------------------------------------------

  attach(camera: PerspectiveCamera): void {
    this.camera = camera;
    if (!this.configured) {
      // Adopt the incoming camera transform as the initial orbit so attaching
      // never clobbers framing the kernel established before this call.
      const offset = this.scratchVector.copy(camera.position).sub(this.target);
      this.scratchSpherical.setFromVector3(offset);
      this.azimuthDeg = MathUtils.radToDeg(this.scratchSpherical.theta);
      this.polarDeg = clamp(
        MathUtils.radToDeg(this.scratchSpherical.phi),
        POLAR_MIN_DEG,
        POLAR_MAX_DEG
      );
      this.distance = clamp(
        this.scratchSpherical.radius > 0 ? this.scratchSpherical.radius : this.distance,
        this.minDistance,
        this.maxDistance
      );
      this.fovDeg = clamp(
        Number.isFinite(camera.fov) ? camera.fov : this.fovDeg,
        FOV_MIN_DEG,
        FOV_MAX_DEG
      );
      if (camera.up.lengthSq() > UP_EPSILON_SQ) {
        this.up.copy(camera.up).normalize();
      }
    }
    this.applyToCamera();
  }

  applyArrivalPreset(preset: CameraArrivalPreset, animateSeconds: number): void {
    const toTarget = new Vector3(
      requireFinite(preset.target[0], 'preset.target[0]'),
      requireFinite(preset.target[1], 'preset.target[1]'),
      requireFinite(preset.target[2], 'preset.target[2]')
    );
    const toPosition = new Vector3(
      requireFinite(preset.position[0], 'preset.position[0]'),
      requireFinite(preset.position[1], 'preset.position[1]'),
      requireFinite(preset.position[2], 'preset.position[2]')
    );
    let toUp: Vector3;
    if (preset.up !== undefined) {
      toUp = new Vector3(
        requireFinite(preset.up[0], 'preset.up[0]'),
        requireFinite(preset.up[1], 'preset.up[1]'),
        requireFinite(preset.up[2], 'preset.up[2]')
      );
      if (toUp.lengthSq() > UP_EPSILON_SQ) toUp.normalize();
      else toUp.copy(this.up);
    } else {
      toUp = this.up.clone();
    }
    const toFov = clamp(
      preset.fovDeg !== undefined ? requireFinite(preset.fovDeg, 'preset.fovDeg') : this.fovDeg,
      FOV_MIN_DEG,
      FOV_MAX_DEG
    );

    // Convert the world-space framing into orbit coordinates. Out-of-range
    // preset geometry is clamped into the safe envelope (docs/UI_UX.md §5).
    const offset = toPosition.sub(toTarget);
    const spherical = new Spherical().setFromVector3(offset);
    const toAzimuth = MathUtils.radToDeg(spherical.theta);
    const toPolar = clamp(MathUtils.radToDeg(spherical.phi), POLAR_MIN_DEG, POLAR_MAX_DEG);
    const toDistance = clamp(spherical.radius, this.minDistance, this.maxDistance);

    this.configured = true;

    // Non-finite or non-positive durations jump instantly; Infinity would
    // otherwise produce an animation whose progress never leaves zero.
    if (this.reducedMotion || !Number.isFinite(animateSeconds) || !(animateSeconds > 0)) {
      this.animation = null;
      this.azimuthDeg = toAzimuth;
      this.polarDeg = toPolar;
      this.distance = toDistance;
      this.fovDeg = toFov;
      this.target.copy(toTarget);
      this.up.copy(toUp);
      this.dirty = true;
      return;
    }

    const fromAzimuth = this.azimuthDeg;
    this.animation = {
      elapsedSeconds: 0,
      durationSeconds: animateSeconds,
      fromAzimuthDeg: fromAzimuth,
      deltaAzimuthDeg: shortestArcDeltaDeg(fromAzimuth, toAzimuth),
      fromPolarDeg: this.polarDeg,
      deltaPolarDeg: toPolar - this.polarDeg,
      fromDistance: this.distance,
      deltaDistance: toDistance - this.distance,
      fromFovDeg: this.fovDeg,
      deltaFovDeg: toFov - this.fovDeg,
      fromTarget: this.target.clone(),
      deltaTarget: toTarget.sub(this.target),
      fromUp: this.up.clone(),
      deltaUp: toUp.sub(this.up)
    };
    this.dirty = true;
  }

  captureTransform(): CameraArrivalPreset {
    this.scratchSpherical.set(
      this.distance,
      MathUtils.degToRad(this.polarDeg),
      MathUtils.degToRad(this.azimuthDeg)
    );
    const position = this.scratchVector.setFromSpherical(this.scratchSpherical).add(this.target);
    return {
      position: [position.x, position.y, position.z],
      target: [this.target.x, this.target.y, this.target.z],
      up: [this.up.x, this.up.y, this.up.z],
      fovDeg: this.fovDeg
    };
  }

  /**
   * Replace the orbit-distance limits (scene units).
   *
   * The default range is [0.5, 500], which silently CLAMPED any destination
   * whose scene is larger than that: the Quasar/AGN galactic zone asks for
   * 760-2400 units and a tidal disruption's debris arcs reach thousands, so
   * both were pinned at 500 and framed the wrong thing. A destination declares
   * its own range in `enter()`; the limits also bound wheel zoom, so the viewer
   * gets a range that matches the scene they are looking at.
   *
   * Applied immediately to the current distance. Invalid or inverted ranges are
   * ignored rather than throwing: this is called from destination lifecycle
   * code on every navigation.
   */
  setDistanceLimits(minDistance: number, maxDistance: number): void {
    if (!Number.isFinite(minDistance) || !Number.isFinite(maxDistance)) return;
    if (!(minDistance > 0) || !(maxDistance > minDistance)) return;
    this.minDistance = minDistance;
    this.maxDistance = maxDistance;
    const clamped = clamp(this.distance, this.minDistance, this.maxDistance);
    if (clamped !== this.distance) {
      this.distance = clamped;
      this.dirty = true;
    }
  }

  /** Current orbit-distance limits (scene units). */
  getDistanceLimits(): { min: number; max: number } {
    return { min: this.minDistance, max: this.maxDistance };
  }

  setOrbit(azimuthDeg: number, polarDeg: number, distance: number): void {
    this.cancelAnimation();
    this.configured = true;
    this.azimuthDeg = requireFinite(azimuthDeg, 'azimuthDeg');
    this.polarDeg = clamp(requireFinite(polarDeg, 'polarDeg'), POLAR_MIN_DEG, POLAR_MAX_DEG);
    this.distance = clamp(requireFinite(distance, 'distance'), this.minDistance, this.maxDistance);
    this.dirty = true;
  }

  /**
   * True while an arrival/preset ease is still interpolating. Consumers that
   * want to take over the camera (see AutoFramer) must wait for this to clear:
   * `setOrbit` cancels the in-flight animation.
   */
  isAnimating(): boolean {
    return this.animation !== null;
  }

  getOrbit(): { azimuthDeg: number; polarDeg: number; distance: number } {
    return {
      azimuthDeg: this.azimuthDeg,
      polarDeg: this.polarDeg,
      distance: this.distance
    };
  }

  setTarget(target: Vector3): void {
    this.cancelAnimation();
    this.configured = true;
    this.target.set(
      requireFinite(target.x, 'target.x'),
      requireFinite(target.y, 'target.y'),
      requireFinite(target.z, 'target.z')
    );
    this.dirty = true;
  }

  setFov(fovDeg: number): void {
    this.cancelAnimation();
    this.configured = true;
    this.fovDeg = clamp(requireFinite(fovDeg, 'fovDeg'), FOV_MIN_DEG, FOV_MAX_DEG);
    this.dirty = true;
  }

  setControlsEnabled(enabled: boolean): void {
    this.controlsEnabled = enabled;
    if (!enabled) this.endDrag();
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
    // Reduced motion also collapses any in-flight arrival to its endpoint.
    if (reduced && this.animation !== null) this.finishAnimation();
  }

  /**
   * Advance any in-flight arrival animation and (re)apply the orbit state to
   * the camera when dirty. Returns whether this call changed the camera
   * transform — the whole-atlas performance campaign's host-owned frame
   * invalidation (src/atlas/host.ts) uses this as its CAMERA_CHANGED signal,
   * so every external mutator (setOrbit/setFov/pointer & wheel handlers/
   * applyArrivalPreset) must keep going through the `dirty` flag consumed
   * here rather than writing the camera directly.
   */
  update(dtSeconds: number): boolean {
    const dt = Number.isFinite(dtSeconds) ? Math.max(0, dtSeconds) : 0;
    const animation = this.animation;
    if (animation !== null) {
      animation.elapsedSeconds = Math.min(animation.elapsedSeconds + dt, animation.durationSeconds);
      const t =
        animation.durationSeconds > 0 ? animation.elapsedSeconds / animation.durationSeconds : 1;
      const s = smoothstep(t);

      this.azimuthDeg = animation.fromAzimuthDeg + animation.deltaAzimuthDeg * s;
      this.polarDeg = clamp(
        animation.fromPolarDeg + animation.deltaPolarDeg * s,
        POLAR_MIN_DEG,
        POLAR_MAX_DEG
      );
      this.distance = clamp(
        animation.fromDistance + animation.deltaDistance * s,
        this.minDistance,
        this.maxDistance
      );
      this.fovDeg = clamp(
        animation.fromFovDeg + animation.deltaFovDeg * s,
        FOV_MIN_DEG,
        FOV_MAX_DEG
      );
      this.target.copy(animation.fromTarget).addScaledVector(animation.deltaTarget, s);
      this.up.copy(animation.fromUp).addScaledVector(animation.deltaUp, s);
      if (this.up.lengthSq() > UP_EPSILON_SQ) this.up.normalize();
      else this.up.copy(animation.fromUp);

      if (animation.elapsedSeconds >= animation.durationSeconds) {
        this.finishAnimation();
      }
      this.dirty = true;
    }

    const changed = this.dirty;
    if (changed) {
      this.applyToCamera();
      this.dirty = false;
    }
    return changed;
  }

  dispose(): void {
    const canvas = this.canvas;
    if (canvas !== null) {
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointercancel', this.onPointerCancel);
      canvas.removeEventListener('wheel', this.onWheel);
      canvas.removeEventListener('keydown', this.onKeyDown);
    }
    this.endDrag();
    this.animation = null;
    this.camera = null;
    this.controlsEnabled = false;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Writes the current orbit state onto the attached camera (single write point). */
  private applyToCamera(): void {
    const camera = this.camera;
    if (camera === null) return;
    this.scratchSpherical.set(
      this.distance,
      MathUtils.degToRad(this.polarDeg),
      MathUtils.degToRad(this.azimuthDeg)
    );
    camera.position
      .copy(this.target)
      .add(this.scratchVector.setFromSpherical(this.scratchSpherical));
    camera.up.copy(this.up);
    camera.lookAt(this.target);
    camera.fov = this.fovDeg;

    // Clip range follows the orbit distance. The host creates the camera with a
    // fixed [0.05, 5000] range, which silently BLACKED OUT any view that had to
    // pull back further than 5000 scene units: a tidal disruption follows its
    // debris out to tens of thousands of units, and every frame beyond the far
    // plane rendered empty. The far plane only ever grows (never below the
    // authored default), and the near plane only grows with distance, so no
    // currently-visible near content starts clipping.
    // Compare against the CONSTANT default, never the live camera: reading
    // camera.far would make this a ratchet that only ever grows, so one visit
    // to a large-scale destination would leave every later destination with a
    // vastly oversized depth range for the rest of the session.
    const far = Math.max(CLIP_FAR_DEFAULT, this.distance * CLIP_FAR_DISTANCE_FACTOR);
    const near = Math.max(CLIP_NEAR_FLOOR, this.distance * CLIP_NEAR_DISTANCE_FACTOR);
    if (far !== camera.far || near !== camera.near) {
      camera.far = far;
      camera.near = near;
    }
    camera.updateProjectionMatrix();
  }

  /** Drops any in-flight animation, keeping the currently interpolated state. */
  private cancelAnimation(): void {
    this.animation = null;
  }

  /** Snaps the in-flight animation to its exact endpoint and clears it. */
  private finishAnimation(): void {
    const animation = this.animation;
    if (animation === null) return;
    this.azimuthDeg = animation.fromAzimuthDeg + animation.deltaAzimuthDeg;
    this.polarDeg = clamp(
      animation.fromPolarDeg + animation.deltaPolarDeg,
      POLAR_MIN_DEG,
      POLAR_MAX_DEG
    );
    this.distance = clamp(
      animation.fromDistance + animation.deltaDistance,
      this.minDistance,
      this.maxDistance
    );
    this.fovDeg = clamp(animation.fromFovDeg + animation.deltaFovDeg, FOV_MIN_DEG, FOV_MAX_DEG);
    this.target.copy(animation.fromTarget).add(animation.deltaTarget);
    this.up.copy(animation.fromUp).add(animation.deltaUp);
    if (this.up.lengthSq() > UP_EPSILON_SQ) this.up.normalize();
    else this.up.copy(animation.fromUp);
    this.animation = null;
    this.dirty = true;
  }

  private endDrag(): void {
    this.dragPointerId = null;
  }

  private nudgeOrbit(deltaAzimuthDeg: number, deltaPolarDeg: number): void {
    this.cancelAnimation();
    this.configured = true;
    this.azimuthDeg += deltaAzimuthDeg;
    this.polarDeg = clamp(this.polarDeg + deltaPolarDeg, POLAR_MIN_DEG, POLAR_MAX_DEG);
    this.dirty = true;
  }

  private zoomBy(factor: number): void {
    this.cancelAnimation();
    this.configured = true;
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Input handlers (bound in constructor, removed in dispose())
  // -------------------------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.controlsEnabled || this.dragPointerId !== null) return;
    if (!event.isPrimary || event.button !== 0) return;
    this.dragPointerId = event.pointerId;
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
    // User input takes ownership from any in-flight arrival animation.
    this.cancelAnimation();
    this.configured = true;
    try {
      this.canvas?.setPointerCapture(event.pointerId);
    } catch {
      // Pointer already went away; drag simply ends at the next move/up.
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.controlsEnabled) return;
    if (this.dragPointerId === null || event.pointerId !== this.dragPointerId) return;
    const deltaX = event.clientX - this.lastDragX;
    const deltaY = event.clientY - this.lastDragY;
    this.lastDragX = event.clientX;
    this.lastDragY = event.clientY;
    // Matches the OrbitControls feel: drag right orbits left, drag down
    // raises the camera toward the north pole.
    this.azimuthDeg -= deltaX * DRAG_DEGREES_PER_PIXEL;
    this.polarDeg = clamp(
      this.polarDeg - deltaY * DRAG_DEGREES_PER_PIXEL,
      POLAR_MIN_DEG,
      POLAR_MAX_DEG
    );
    this.dirty = true;
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.dragPointerId !== null && event.pointerId === this.dragPointerId) {
      this.endDrag();
    }
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (this.dragPointerId !== null && event.pointerId === this.dragPointerId) {
      this.endDrag();
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    if (!this.controlsEnabled) return;
    const deltaY =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? event.deltaY * WHEEL_DELTA_LINE_PIXELS
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? event.deltaY * WHEEL_DELTA_PAGE_PIXELS
          : event.deltaY;
    if (!Number.isFinite(deltaY) || deltaY === 0) return;
    // Scroll down (positive deltaY) dollies out; exponential keeps the zoom
    // perceptually uniform across the clamped distance range.
    this.zoomBy(Math.exp(deltaY * WHEEL_ZOOM_PER_PIXEL));
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!this.controlsEnabled) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    let handled = true;
    switch (event.key) {
      case 'ArrowLeft':
        this.nudgeOrbit(-KEY_ORBIT_DEG, 0);
        break;
      case 'ArrowRight':
        this.nudgeOrbit(KEY_ORBIT_DEG, 0);
        break;
      case 'ArrowUp':
        this.nudgeOrbit(0, -KEY_ORBIT_DEG);
        break;
      case 'ArrowDown':
        this.nudgeOrbit(0, KEY_ORBIT_DEG);
        break;
      case '+':
      case '=':
        this.zoomBy(1 / KEY_ZOOM_FACTOR);
        break;
      case '-':
      case '_':
        this.zoomBy(KEY_ZOOM_FACTOR);
        break;
      default:
        handled = false;
        break;
    }
    if (handled) event.preventDefault();
  };
}
