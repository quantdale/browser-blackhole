import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type { Mesh, RenderTarget } from 'three';
import { VolumeService } from '../../src/renderer/shared/VolumeService.js';
import type { RendererLike, VolumeConfig } from '../../src/atlas/types.js';

/**
 * Dedicated runtime harness for VolumeService (Phase 15 leftover).
 * Covers node-safe surfaces: config validation, proxy construction for both
 * bound kinds, the half-resolution plumbing (sizing math, render-target
 * save/restore ownership, internal-scale clamping), density-callback contract
 * at graph build time, and disposal semantics. The march itself is GPU-side
 * and is validated by browser specs.
 */

const CENTER: [number, number, number] = [1, 2, 3];

function makeConfig(overrides: Partial<VolumeConfig> = {}): VolumeConfig {
  return {
    bounds: { kind: 'sphere', center: CENTER, radius: 4 },
    density: () => 0.5,
    baseMaxSteps: 16,
    halfResolution: false,
    earlyAlphaTermination: true,
    temporalJitter: false,
    ...overrides
  };
}

interface FakeRendererResult {
  renderer: RendererLike;
  calls: Array<{ op: string; arg: unknown }>;
}

function fakeRenderer(width: number, height: number, dpr: number): FakeRendererResult {
  const calls: FakeRendererResult['calls'] = [];
  const renderer = {
    getSize(v: THREE.Vector2): THREE.Vector2 {
      return v.set(width, height);
    },
    getPixelRatio(): number {
      return dpr;
    },
    getRenderTarget(): null {
      return null;
    },
    setRenderTarget(rt: unknown): void {
      calls.push({ op: 'setRenderTarget', arg: rt });
    },
    render(scene: unknown): void {
      calls.push({ op: 'render', arg: scene });
    }
  };
  return { renderer: renderer as unknown as RendererLike, calls };
}

function invokeOnBeforeRender(mesh: Mesh, fake: FakeRendererResult): void {
  // three.js onBeforeRender signature: (renderer, scene, camera, geometry,
  // material, group). The march hook reads only the renderer.
  mesh.onBeforeRender(
    fake.renderer as never,
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    mesh.geometry,
    mesh.material as THREE.Material,
    null as unknown as THREE.Group
  );
}

function capturedTarget(fake: FakeRendererResult): RenderTarget | null {
  const entry = fake.calls.find((c) => c.op === 'setRenderTarget');
  return entry ? (entry.arg as RenderTarget) : null;
}

describe('VolumeService configuration validation', () => {
  it('rejects invalid baseMaxSteps values', () => {
    const service = new VolumeService();
    expect(() => service.createVolume(makeConfig({ baseMaxSteps: 0 }))).toThrow(
      /invalid baseMaxSteps/
    );
    expect(() => service.createVolume(makeConfig({ baseMaxSteps: Number.NaN }))).toThrow(
      /invalid baseMaxSteps/
    );
    service.dispose();
  });

  it('refuses creation after service dispose', () => {
    const service = new VolumeService();
    service.dispose();
    expect(() => service.createVolume(makeConfig())).toThrow(/after dispose/);
  });

  it('defers density evaluation to shader-build time (no eager per-step JS calls)', () => {
    const service = new VolumeService();
    const density = vi.fn((_args: { pos: unknown; dir: unknown }) => 0.5);
    service.createVolume(makeConfig({ baseMaxSteps: 24, density }));
    // The march loop lives inside a TSL Fn: its body executes during shader
    // generation on the renderer (browser specs), NOT while the JS node graph
    // is constructed here. Guard the laziness contract: creating a volume
    // must never invoke user callbacks eagerly.
    expect(density).not.toHaveBeenCalled();
    service.dispose();
  });
});

describe('VolumeService proxy construction', () => {
  it('builds a sphere proxy centered on the bounds with presentation state', () => {
    const service = new VolumeService();
    const volume = service.createVolume(
      makeConfig({ bounds: { kind: 'sphere', center: CENTER, radius: 4 } })
    );
    const mesh = volume.object3d() as Mesh;
    expect(mesh.position).toEqual(new THREE.Vector3(...CENTER));
    expect((mesh.geometry as THREE.SphereGeometry).parameters.radius).toBe(4);
    expect(mesh.frustumCulled).toBe(false);
    expect(mesh.renderOrder).toBe(10);
    expect(mesh.name).toBe('VolumeProxy');

    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.premultipliedAlpha).toBe(true);
    expect(material.blending).toBe(THREE.NormalBlending);
    expect(material.side).toBe(THREE.BackSide);

    // Full-resolution path performs no nested render hook work.
    const fake = fakeRenderer(800, 600, 2);
    invokeOnBeforeRender(mesh, fake);
    expect(fake.calls).toEqual([]);
    service.dispose();
  });

  it('builds a box proxy with full-extent dimensions', () => {
    const service = new VolumeService();
    const he: [number, number, number] = [2, 5, 8];
    const volume = service.createVolume(
      makeConfig({
        bounds: { kind: 'box', center: [-1, -2, -3], halfExtents: he },
        baseMaxSteps: 8
      })
    );
    const mesh = volume.object3d() as Mesh;
    const params = (mesh.geometry as THREE.BoxGeometry).parameters;
    expect(params.width).toBe(4);
    expect(params.height).toBe(10);
    expect(params.depth).toBe(16);
    expect(mesh.position).toEqual(new THREE.Vector3(-1, -2, -3));
    service.dispose();
  });
});

describe('VolumeService half-resolution path', () => {
  it('sizes the internal target from viewport, DPR, and shared scale, restoring bindings', () => {
    const service = new VolumeService();
    const volume = service.createVolume(makeConfig({ halfResolution: true }));
    const mesh = volume.object3d() as Mesh;

    const fake = fakeRenderer(800, 600, 2); // default internal scale 0.5
    invokeOnBeforeRender(mesh, fake);

    // w = floor(800 * 2 * 0.5 * 0.5) = 400, h = floor(600 * 2 * 0.5 * 0.5) = 300.
    const target = capturedTarget(fake);
    expect(target).not.toBeNull();
    expect(target!.width).toBe(400);
    expect(target!.height).toBe(300);
    expect(target!.texture.type).toBe(THREE.HalfFloatType);
    expect(target!.texture.colorSpace).toBe(THREE.NoColorSpace);
    expect((mesh.material as THREE.MeshBasicMaterial).side).toBe(THREE.DoubleSide);

    // Ownership contract: bind private target -> march -> restore previous.
    expect(fake.calls.map((c) => c.op)).toEqual(['setRenderTarget', 'render', 'setRenderTarget']);
    expect(fake.calls[0]!.arg).toBe(target);
    expect(fake.calls[2]!.arg).toBeNull();

    const renderedScene = fake.calls[1]!.arg as THREE.Scene;
    expect(renderedScene.children).toHaveLength(1);

    service.dispose();
  });

  it('permits an explicitly LDR-safe half-resolution volume to use RGBA8', () => {
    const service = new VolumeService();
    const volume = service.createVolume(
      makeConfig({ halfResolution: true, hdrIntermediate: false })
    );
    const target = volume.getIntermediateRenderTargetForTest?.();
    expect(target).not.toBeNull();
    expect(target!.texture.type).toBe(THREE.UnsignedByteType);
    expect(volume.getDebugSnapshot?.()).toMatchObject({
      intermediateFormat: 'rgba8',
      hdrIntermediate: false,
      intermediateBytesPerPixel: 4
    });
    service.dispose();
  });

  it('clamps the shared internal scale into [0.1, 1]', () => {
    const service = new VolumeService({ dprCap: 2 });
    const volume = service.createVolume(makeConfig({ halfResolution: true }));
    const mesh = volume.object3d() as Mesh;

    service.setInternalScale(50); // clamps to 1
    let fake = fakeRenderer(800, 600, 2);
    invokeOnBeforeRender(mesh, fake);
    expect(capturedTarget(fake)!.width).toBe(800); // floor(800*2*1*0.5)
    expect(capturedTarget(fake)!.height).toBe(600);

    service.setInternalScale(0.001); // clamps to 0.1
    fake = fakeRenderer(800, 600, 2);
    invokeOnBeforeRender(mesh, fake);
    expect(capturedTarget(fake)!.width).toBe(80); // floor(800*2*0.1*0.5)
    expect(capturedTarget(fake)!.height).toBe(60);

    service.dispose();
  });

  it('keeps a minimum 2x2 target for tiny viewports', () => {
    const service = new VolumeService();
    const volume = service.createVolume(makeConfig({ halfResolution: true }));
    const mesh = volume.object3d() as Mesh;
    const fake = fakeRenderer(1, 1, 0.1);
    invokeOnBeforeRender(mesh, fake);
    const target = capturedTarget(fake)!;
    expect(target.width).toBeGreaterThanOrEqual(2);
    expect(target.height).toBeGreaterThanOrEqual(2);
    service.dispose();
  });
});

describe('VolumeService lifecycle and disposal ownership', () => {
  it('no-ops handle mutations after disposal and neutralizes the nested render hook', () => {
    const service = new VolumeService();
    const volume = service.createVolume(makeConfig({ halfResolution: true }));
    const mesh = volume.object3d() as Mesh;

    let disposeEvents = 0;
    mesh.geometry.addEventListener('dispose', () => {
      disposeEvents += 1;
    });

    volume.dispose();
    volume.dispose(); // idempotent

    volume.setVisible(false); // no-op after dispose
    expect(mesh.visible).toBe(true);

    const fake = fakeRenderer(800, 600, 2);
    invokeOnBeforeRender(mesh, fake);
    expect(fake.calls).toEqual([]); // nested march hook is disarmed

    expect(disposeEvents).toBe(1);
    service.dispose(); // must not double-dispose the already-disposed handle
    expect(disposeEvents).toBe(1);
  });

  it('service dispose claims every still-live volume exactly once', () => {
    const service = new VolumeService();
    const handles = [
      service.createVolume(makeConfig({ baseMaxSteps: 4 })),
      service.createVolume(
        makeConfig({ bounds: { kind: 'box', center: [0, 0, 0], halfExtents: [1, 1, 1] } })
      )
    ];
    let disposeEvents = 0;
    for (const handle of handles) {
      // BufferGeometry.dispose() (called by handle dispose) is where three.js
      // dispatches its 'dispose' event; Object3D itself never fires one.
      const mesh = handle.object3d() as unknown as {
        geometry: { addEventListener(type: 'dispose', fn: () => void): void };
      };
      mesh.geometry.addEventListener('dispose', () => {
        disposeEvents += 1;
      });
    }
    service.dispose();
    expect(disposeEvents).toBe(handles.length);
  });

  it('applies setStepScale and setVisible before disposal without error', () => {
    const service = new VolumeService();
    const volume = service.createVolume(makeConfig());
    volume.setStepScale(2); // finer steps
    volume.setStepScale(0.000001); // clamped internally, no throw
    volume.setVisible(false);
    expect(volume.object3d().visible).toBe(false);
    service.dispose();
  });

  it('reports the active march budget independently from the render proxy', () => {
    const service = new VolumeService();
    const volume = service.createVolume(makeConfig({ baseMaxSteps: 80 }));
    expect(volume.getDebugSnapshot?.()).toMatchObject({
      baseMaxSteps: 80,
      activeSteps: 80,
      visible: true
    });
    volume.setStepScale(0.5);
    expect(volume.getDebugSnapshot?.()).toMatchObject({ activeSteps: 40 });
    service.dispose();
  });
});
