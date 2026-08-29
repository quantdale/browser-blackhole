/**
 * LensingService — shared gravitational-lensing capabilities.
 *
 * Spec sources:
 * - docs/cosmic-atlas/RENDERING_SERVICES.md §8 (LensingService)
 * - docs/NUMERICAL_METHODS.md (geodesic conventions the black-hole path follows)
 * - docs/SHADER_CONTRACTS.md §1-2 (TSL boundaries, canonical GPU parameter groups)
 * - src/atlas/types.ts (ILensingService, LensingPassParams, TslDensityFn)
 *
 * Two deliberately distinct backends are exposed (RENDERING_SERVICES.md §8
 * forbids presenting one generic lens-distortion function as valid for all
 * cases):
 *
 * 1. createBlackHoleLensingPass — full Schwarzschild backwards-ray-tracing
 *    pass. The physics lives in the TSL integrator owned by the black-hole
 *    phenomenon module (src/phenomena/black-hole/schwarzschildIntegrator.ts,
 *    implemented per docs/NUMERICAL_METHODS.md); this service only wraps the
 *    returned node material on a fullscreen triangle mesh and forwards
 *    uniform-state updates and disposal.
 *
 * 2. createThinLensDisplacement — reduced weak-field thin-lens deflection
 *    for non-black-hole destinations (lensing lab, AGN). It is NOT a
 *    substitute for backend 1.
 */

import * as THREE from 'three';
import type { Node } from 'three/webgpu';
import { add, cos, div, dot, length, max, min, mul, normalize, sin, sub, vec3 } from 'three/tsl';
import type {
  ILensingService,
  KerrLensingParams,
  LensingPassParams,
  TslDensityFn
} from '../../atlas/types';
import { createLensingMaterial } from '../../phenomena/black-hole/schwarzschildIntegrator';
import { createKerrLensingMaterial } from '../../phenomena/black-hole/kerr/kerrIntegrator.js';
import {
  createLutLensingMaterial,
  type LutLensingMaterial
} from '../../phenomena/black-hole/lut/lensingGpu.js';
import type { LutGpuResources } from '../../phenomena/black-hole/lut/textures.js';

/** Handle shape returned by createBlackHoleLensingPass (mirrors ILensingService). */
interface BlackHoleLensingPassHandle {
  object3d(): THREE.Mesh;
  setUniformsFromState(state: Record<string, unknown>): void;
  setEnvironmentDetail(detail: number): void;
  dispose(): void;
}

/**
 * Disclosure for the reduced thin-lens model. UI surfaces exposing it must
 * present this string so the approximation is never mistaken for the full
 * Schwarzschild path (RENDERING_SERVICES.md §8).
 */
export const THIN_LENS_DISCLOSURE =
  'Reduced thin-lens approximation: one-sided weak-field deflection ' +
  'alpha = 2*r_g/b per sample, not a full strong-field geodesic trace.';

/**
 * Impact-parameter floor (in r_g scene units) guarding the 1/b singularity
 * of the thin-lens formula. Numerical guard, not physics.
 */
const THIN_LENS_MIN_B = 1e-4;

/**
 * Upper bound on the applied deflection angle (radians). Beyond pi/2 the
 * rotation would overshoot the lens direction; weak-field use cases stay
 * orders of magnitude below this. Numerical guard, not physics.
 */
const THIN_LENS_MAX_ALPHA = Math.PI / 2;

/**
 * Fullscreen triangle geometry: three clip-space vertices covering the
 * viewport with a single draw call (AGENTS.md "Rendering": prefer a single
 * full-screen triangle). The integrator material maps positionLocal to
 * clip space directly; frustum culling is disabled on the wrapping mesh.
 */
function createFullscreenTriangleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Escape radius (r_g) at which a traced ray is declared to have reached the
 * background. Mirrors the value blackHoleDestination uses so both consumers
 * agree on where the background begins.
 */
const DEFAULT_ESCAPE_RADIUS_RG = 32;

/**
 * Per-frame camera/uniform state for a lensing pass.
 *
 * A pass created by this service renders a FULLSCREEN triangle and derives
 * every ray from its uniforms, so a pass that is never fed the live camera
 * produces a constant-colour frame — which is exactly what the Quasar/AGN
 * INNER zone did before the phenomena-animation campaign: it created a
 * `createBlackHoleLensingPass` and never called `setUniformsFromState`, so the
 * "DIRECT GR reuse" view was a flat wash.
 *
 * `blackHoleDestination` keeps its own richer builder (observer-frame legs,
 * LUT/Kerr debug gates); this is the minimal camera+disk state every other
 * consumer needs.
 */
export function lensingCameraUniformState(
  camera: THREE.PerspectiveCamera,
  params: {
    massRg: number;
    diskEnabled: boolean;
    diskInnerRg: number;
    diskOuterRg: number;
    escapeRadiusRg?: number;
    backgroundIntensity?: number;
    centerRg?: [number, number, number];
    temporalJitterNdc?: [number, number];
  }
): Record<string, unknown> {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const right = new THREE.Vector3(e[0] ?? 0, e[1] ?? 0, e[2] ?? 0).normalize();
  const up = new THREE.Vector3(e[4] ?? 0, e[5] ?? 0, e[6] ?? 0).normalize();
  const forward = new THREE.Vector3(-(e[8] ?? 0), -(e[9] ?? 0), -(e[10] ?? 0)).normalize();
  const aspect = camera.aspect;
  return {
    cameraPositionRg: [camera.position.x, camera.position.y, camera.position.z],
    cameraRight: [right.x, right.y, right.z],
    cameraUp: [up.x, up.y, up.z],
    cameraForward: [forward.x, forward.y, forward.z],
    tanHalfFovY: Math.tan((camera.fov * Math.PI) / 360),
    aspect: Number.isFinite(aspect) && aspect > 0 ? aspect : 1,
    massRg: params.massRg,
    centerRg: params.centerRg ?? [0, 0, 0],
    diskEnabled: params.diskEnabled,
    diskInnerRg: params.diskInnerRg,
    diskOuterRg: params.diskOuterRg,
    escapeRadiusRg: params.escapeRadiusRg ?? DEFAULT_ESCAPE_RADIUS_RG,
    backgroundIntensity: params.backgroundIntensity ?? 1,
    temporalJitterNdc: params.temporalJitterNdc ?? [0, 0]
  };
}

export class LensingService implements ILensingService {
  /** Live passes, so dispose() releases every created GPU resource. */
  private readonly passes: BlackHoleLensingPassHandle[] = [];
  private environmentDetail = 0;

  /**
   * Full Schwarzschild backwards-ray-tracing pass (black-hole destination).
   *
   * Delegates the geodesic integrator to the black-hole phenomenon module's
   * TSL material factory (docs/NUMERICAL_METHODS.md governs its numerics),
   * wraps the returned NodeMaterial on a fullscreen triangle Mesh, and
   * exposes passthrough uniform-state updates and disposal. Created passes
   * are tracked; LensingService.dispose() disposes any still alive.
   */
  createBlackHoleLensingPass(params: LensingPassParams): {
    object3d(): THREE.Mesh;
    setUniformsFromState(state: Record<string, unknown>): void;
    dispose(): void;
  } {
    const delegate = createLensingMaterial(params);
    return this.wrapLensingHandle(delegate.material, delegate, params);
  }

  /**
   * Full KERR numerical backwards-ray-tracing pass (M9-03..05). Delegates
   * the geodesic integrator to the kerr module's TSL material factory
   * (docs/KERR_BACKEND_ADR.md governs its conventions), wraps the returned
   * NodeMaterial on a fullscreen triangle Mesh, and forwards uniform-state
   * updates and disposal. Created passes are tracked like the others.
   */
  createKerrLensingPass(params: KerrLensingParams): {
    object3d(): THREE.Mesh;
    setUniformsFromState(state: Record<string, unknown>): void;
    dispose(): void;
  } {
    const delegate = createKerrLensingMaterial(params);
    return this.wrapLensingHandle(delegate.material, delegate, params);
  }

  /**
   * LUT-accelerated variant of the black-hole pass (M8-06). Same uniform
   * contract; trajectory queries resolve from validated GPU textures with
   * inline numerical fallback for out-of-domain rays.
   */
  createBlackHoleLutPass(
    params: LensingPassParams,
    lut: {
      resources: LutGpuResources;
      storedSpanRad: number;
      bCriticalRg: number;
      hybridBandHalfWidthX: number;
    }
  ): {
    object3d(): THREE.Mesh;
    setUniformsFromState(state: Record<string, unknown>): void;
    dispose(): void;
    lutMaterial(): LutLensingMaterial;
  } {
    const delegate = createLutLensingMaterial({
      ...params,
      trajectoryTexture: lut.resources.trajectoryTexture,
      auxTexture: lut.resources.auxTexture,
      storedSpanRad: lut.storedSpanRad,
      bCriticalRg: lut.bCriticalRg,
      hybridBandHalfWidthX: lut.hybridBandHalfWidthX
    });
    const wrapped = this.wrapLensingHandle(delegate.material, delegate, params);
    return {
      ...wrapped,
      lutMaterial: () => delegate
    };
  }

  private wrapLensingHandle(
    material: THREE.Material,
    delegate: {
      setUniformsFromState(state: Record<string, unknown>): void;
      setEnvironmentDetail?(detail: number): void;
      dispose(): void;
    },
    _params: LensingPassParams
  ) {
    const geometry = createFullscreenTriangleGeometry();
    const mesh: THREE.Mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.name = 'black-hole-lensing-pass';

    let disposed = false;
    const handle = {
      object3d: () => mesh,
      setUniformsFromState: (state: Record<string, unknown>) => {
        delegate.setUniformsFromState(state);
      },
      setEnvironmentDetail: (detail: number) => {
        delegate.setEnvironmentDetail?.(detail);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        const index = this.passes.indexOf(handle as BlackHoleLensingPassHandle);
        if (index >= 0) this.passes.splice(index, 1);
        geometry.dispose();
        delegate.dispose();
      }
    };
    this.passes.push(handle as BlackHoleLensingPassHandle);
    return handle;
  }

  /** Apply the bounded cinematic environment contribution to every live pass. */
  setEnvironmentDetail(detail: number): void {
    const value = Number.isFinite(detail) ? Math.min(1, Math.max(0, detail)) : 0;
    this.environmentDetail = value;
    for (const pass of this.passes) pass.setEnvironmentDetail(value);
  }

  getDebugSnapshot(): Record<string, unknown> {
    return {
      environmentDetail: this.environmentDetail,
      livePassCount: this.passes.length,
      environmentLayer: 'cinematic-diffuse+dense-stars+dust'
    };
  }

  /**
   * Reduced thin-lens displacement for non-black-hole destinations
   * (lensing lab, AGN). Returns a TSL density-fn-shaped callback evaluated
   * per sample position inside a march or ray graph.
   *
   * Model (weak-field point-mass lens, geometric units r_g = GM/c^2):
   * the total Einstein deflection is alpha_total = 4 r_g / b; this fn
   * applies the one-sided half contribution alpha = (2 r_g / b) scaled by
   * `impactParameterScale`, where b is the impact parameter of the sample
   * relative to a lens fixed at the world origin. Given (pos, dir) it
   * returns the DEFLECTED unit direction: dir rotated by alpha toward the
   * lens within the plane spanned by dir and the lensward perpendicular,
   * i.e. normalize(dir*cos(alpha) + towardLens*sin(alpha)).
   *
   * Approximation disclosure: see THIN_LENS_DISCLOSURE. This is a reduced
   * educational/visual model — it must not weaken or replace the full
   * backwards-ray-traced black-hole pass (RENDERING_SERVICES.md §8), and
   * it ignores capture, photon-sphere, and strong-field amplification.
   */
  createThinLensDisplacement(massRg: number, impactParameterScale: number): TslDensityFn {
    // Bake constants into the JS closure; they become literal WGSL constants.
    const twoMassRg = 2 * massRg;
    const scale = impactParameterScale;

    return ({ pos, dir }) => {
      // Contract inputs are TSL vec3 nodes typed `unknown` in types.ts;
      // cast once at this boundary and build pure node math below.
      const posNode = vec3(pos as Node<'vec3'>);
      const dirNode = vec3(dir as Node<'vec3'>);

      // Impact-parameter vector: component of pos perpendicular to dir.
      const alongDir = dot(dirNode, posNode);
      const perp = sub(posNode, mul(dirNode, alongDir));

      // alpha = (2 r_g / b) * scale, guarded against b -> 0 and alpha -> pi/2.
      const b = max(length(perp), THIN_LENS_MIN_B);
      const alpha = min(div(twoMassRg, b), THIN_LENS_MAX_ALPHA);
      const scaledAlpha = mul(alpha, scale);

      const towardLens = normalize(mul(perp, -1));

      // Exact in-plane rotation of dir toward the lens (dir ⟂ towardLens).
      return normalize(add(mul(dirNode, cos(scaledAlpha)), mul(towardLens, sin(scaledAlpha))));
    };
  }

  /** Dispose every still-live lensing pass created by this service. */
  dispose(): void {
    for (const handle of this.passes.slice()) {
      handle.dispose();
    }
    this.passes.length = 0;
  }
}
