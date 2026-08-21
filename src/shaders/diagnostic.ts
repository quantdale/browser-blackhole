/**
 * Full-screen triangle diagnostic pass (M0-04).
 *
 * One triangle covers clip space (no quad seam); the vertex stage synthesizes
 * clip-space positions directly, so the pass is independent of any camera
 * transform. The fragment stage reconstructs the world-space camera ray from
 * the interpolated NDC and the canonical camera-basis uniforms, then maps the
 * unit direction to RGB (dir * 0.5 + 0.5).
 *
 * Deterministic: same camera basis + NDC => same color. A screenshot proves
 * full coverage, aspect handling, and camera-axis orientation (playbook
 * section 2.3). No black-hole physics here by design.
 *
 * NDC convention matches src/shaders/cameraRayMath.ts (+x right, +y up).
 */

import {
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  NodeMaterial,
  Scene,
  Vector3
} from 'three/webgpu';
import { attribute, float, normalize, select, uniform, varying, vec4 } from 'three/tsl';
import type { Vec3 } from './cameraRayMath.js';

export interface DiagnosticUniformBlock {
  /** Observer position in r_g (plumbed per docs/SHADER_CONTRACTS.md section 2). */
  cameraPositionRg: { value: Vector3 };
  cameraRight: { value: Vector3 };
  cameraUp: { value: Vector3 };
  cameraForward: { value: Vector3 };
  tanHalfFovY: { value: number };
  aspect: { value: number };
  /**
   * Debug view selector (M1-05): 0 = direction gradient ('diagnostic'),
   * 1 = flat clear color ('off'). Scalar so the CPU side stays trivial.
   */
  viewOff: { value: number };
}

export interface DiagnosticPass {
  scene: Scene;
  mesh: Mesh;
  material: NodeMaterial;
  uniforms: DiagnosticUniformBlock;
  dispose(): void;
}

function vec3Uniform(): { value: Vector3 } {
  return { value: new Vector3() };
}

export function createDiagnosticPass(): DiagnosticPass {
  // Scalar uniform NODES are created first and exposed through the block so
  // that later `block.field.value = x` writes reach the shader: passing
  // `uniform(block.scalar.value)` would snapshot the number instead of
  // referencing it (Vector3 uniforms are fine either way — they are objects).
  const uTanHalfFovY = uniform(1);
  const uAspect = uniform(1);
  const uViewOff = uniform(0);

  const uniforms: DiagnosticUniformBlock = {
    cameraPositionRg: vec3Uniform(),
    cameraRight: vec3Uniform(),
    cameraUp: vec3Uniform(),
    cameraForward: vec3Uniform(),
    tanHalfFovY: uTanHalfFovY,
    aspect: uAspect,
    viewOff: uViewOff
  };

  const uRight = uniform(uniforms.cameraRight.value);
  const uUp = uniform(uniforms.cameraUp.value);
  const uForward = uniform(uniforms.cameraForward.value);

  const positionAttr = attribute<'vec3'>('position', 'vec3');

  const material = new NodeMaterial();
  // Full-screen triangle: clip-space positions straight from the attribute.
  material.vertexNode = vec4(positionAttr.xy, float(0), float(1));
  // Scalar varyings keep the fragment stage free of swizzle typing.
  const vX = varying(positionAttr.x);
  const vY = varying(positionAttr.y);
  const dir = normalize(
    uForward.add(uRight.mul(vX.mul(uTanHalfFovY).mul(uAspect))).add(uUp.mul(vY.mul(uTanHalfFovY)))
  );
  const color = dir.mul(0.5).add(0.5);
  // 'off' renders the flat clear color (black) until a real background
  // (starfield) arrives in a later packet; the pass still covers the frame so
  // coverage/aspect invariants stay testable in both modes.
  material.fragmentNode = select(
    uViewOff.lessThan(0.5),
    vec4(color, float(1)),
    vec4(float(0), float(0), float(0), float(1))
  );

  const geometry = new BufferGeometry();
  geometry.setAttribute(
    'position',
    new Float32BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3)
  );

  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;

  const scene = new Scene();
  scene.add(mesh);

  return {
    scene,
    mesh,
    material,
    uniforms,
    dispose(): void {
      geometry.dispose();
      material.dispose();
      scene.remove(mesh);
    }
  };
}

/** Maps canonical camera basis values into the diagnostic uniform block. */
export function applyBasisToDiagnosticUniforms(
  pass: DiagnosticPass,
  basis: {
    position: Vec3;
    right: Vec3;
    up: Vec3;
    forward: Vec3;
    tanHalfFovY: number;
    aspect: number;
  }
): void {
  pass.uniforms.cameraPositionRg.value.set(...basis.position);
  pass.uniforms.cameraRight.value.set(...basis.right);
  pass.uniforms.cameraUp.value.set(...basis.up);
  pass.uniforms.cameraForward.value.set(...basis.forward);
  pass.uniforms.tanHalfFovY.value = basis.tanHalfFovY;
  pass.uniforms.aspect.value = basis.aspect;
}

/**
 * Maps the canonical `debug.viewMode` (docs/STATE_SCHEMA.md section 8) onto
 * the shader-side selector: 'diagnostic' -> direction gradient, 'off' -> flat
 * clear color. Mirrors the CPU contract in src/app/state.ts.
 */
export function applyViewModeToDiagnosticUniforms(
  pass: DiagnosticPass,
  viewMode: 'diagnostic' | 'off'
): void {
  pass.uniforms.viewOff.value = viewMode === 'off' ? 1 : 0;
}
