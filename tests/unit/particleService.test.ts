import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { InstancedBufferGeometry } from 'three';
import { ParticleService, mulberry32 } from '../../src/renderer/shared/ParticleService.js';
import type { ParticleSystemConfig, ParticleSystemHandle } from '../../src/atlas/types.js';

/**
 * Dedicated runtime harness for ParticleService (Phase 15 leftover).
 * Exercises the documented CPU fallback path end to end in node: deterministic
 * seeding, integration/clamping, respawn recycling, emitter shape sampling,
 * population scaling, config validation, and disposal ownership. The compute
 * path needs a WebGPU device and is covered by browser specs instead.
 */

function makeConfig(overrides: Partial<ParticleSystemConfig> = {}): ParticleSystemConfig {
  return {
    capacity: 64,
    // Non-zero default speed so the shared config exercises real motion; tests
    // that need stationary particles override it explicitly.
    emitters: [{ kind: 'point', origin: [0, 0, 0], speed: 3 }],
    lifetimeSeconds: [10, 20],
    sizePx: [1, 2],
    colorRamp: [
      { t: 0, color: [1, 0, 0], alpha: 1 },
      { t: 1, color: [0, 0, 1], alpha: 0 }
    ],
    blending: 'additive',
    seed: 42,
    preferCompute: false,
    ...overrides
  };
}

interface Snapshot {
  pos: Float32Array;
  life: Float32Array;
}

function snapshot(handle: ParticleSystemHandle): Snapshot {
  // The handle contract exposes a plain Object3D (the render mesh); particle
  // state lives in instanced attributes on its geometry.
  const geo = (handle.object3d() as unknown as { geometry: InstancedBufferGeometry }).geometry;
  return {
    pos: geo.getAttribute('aParticlePos').array as Float32Array,
    life: geo.getAttribute('aParticleLife').array as Float32Array
  };
}

let warnings: string[];

beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mulberry32 PRNG', () => {
  it('reproduces identical sequences from the same seed', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqB).toEqual(seqA);
  });

  it('produces floats in [0, 1) and diverges across seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    let differ = false;
    for (let i = 0; i < 64; i++) {
      const x = a();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      if (x !== b()) differ = true;
    }
    expect(differ).toBe(true);
  });
});

describe('ParticleService CPU path selection', () => {
  it('falls back to the CPU path with a warning when preferCompute has no renderer', () => {
    const service = new ParticleService({ computeAvailable: true, renderer: null });
    const system = service.createSystem(makeConfig({ preferCompute: true }));
    expect(warnings.some((w) => w.includes('preferCompute'))).toBe(true);
    expect(system.getDebugSnapshot()).toMatchObject({
      updatePath: 'cpu',
      computeAvailable: false
    });
    service.dispose();
  });

  it('mirrors the computeAvailable capability flag', () => {
    expect(new ParticleService({ computeAvailable: false }).computeAvailable).toBe(false);
    expect(new ParticleService({ computeAvailable: true }).computeAvailable).toBe(true);
  });
});

describe('ParticleSystem CPU integration', () => {
  it('moves particles along constant velocity: equal displacement per unit time', () => {
    const service = new ParticleService({ computeAvailable: false });
    const system = service.createSystem(
      makeConfig({ emitters: [{ kind: 'point', origin: [0, 0, 0], speed: 10 }] })
    );
    const p0 = snapshot(system).pos.slice();
    system.update(0.1);
    const p1 = snapshot(system).pos.slice();
    system.update(0.2);
    const p2 = snapshot(system).pos;

    // Per-second displacement must match between the two intervals.
    for (let i = 0; i < 4; i++) {
      const rate1 = (p1[i]! - p0[i]!) / 0.1;
      const rate2 = (p2[i]! - p1[i]!) / 0.2;
      if (rate1 === 0 && rate2 === 0) continue;
      expect(rate2).toBeCloseTo(rate1, 4);
    }
    service.dispose();
  });

  it('spawns point-emitter particles at the emitter origin with |v| = speed', () => {
    const service = new ParticleService({ computeAvailable: false });
    const origin: [number, number, number] = [3, -1, 5];
    const system = service.createSystem(
      makeConfig({
        capacity: 32,
        emitters: [{ kind: 'point', origin, speed: 7 }]
      })
    );
    const { pos, life } = snapshot(system);
    for (let i = 0; i < 32; i++) {
      expect(pos[i * 4]).toBe(origin[0]);
      expect(pos[i * 4 + 1]).toBe(origin[1]);
      expect(pos[i * 4 + 2]).toBe(origin[2]);
      // Lifetime drawn from [min, max].
      expect(life[i * 4 + 1]).toBeGreaterThanOrEqual(10);
      expect(life[i * 4 + 1]).toBeLessThanOrEqual(20);
    }
    // One small step: displacement magnitude per second equals speed.
    system.update(0.01);
    const moved = snapshot(system).pos;
    const speeds = new Set<number>();
    for (let i = 0; i < 32; i++) {
      const dx = moved[i * 4]! - origin[0];
      const dy = moved[i * 4 + 1]! - origin[1];
      const dz = moved[i * 4 + 2]! - origin[2];
      speeds.add(Math.round(Math.hypot(dx, dy, dz) / 0.01));
    }
    expect([...speeds]).toEqual([7]);
    service.dispose();
  });

  it('samples emitter shapes inside their bounds', () => {
    const service = new ParticleService({ computeAvailable: false });
    const o: [number, number, number] = [0, 0, 0];

    const box = service.createSystem(
      makeConfig({
        capacity: 32,
        emitters: [{ kind: 'volume-box', origin: o, extent: [2, 4, 6] }]
      })
    );
    const boxPos = snapshot(box).pos;
    for (let i = 0; i < 32; i++) {
      expect(Math.abs(boxPos[i * 4]!)).toBeLessThanOrEqual(1);
      expect(Math.abs(boxPos[i * 4 + 1]!)).toBeLessThanOrEqual(2);
      expect(Math.abs(boxPos[i * 4 + 2]!)).toBeLessThanOrEqual(3);
    }

    const shell = service.createSystem(
      makeConfig({
        capacity: 32,
        emitters: [{ kind: 'sphere-shell', origin: o, radius: 3 }]
      })
    );
    const shellPos = snapshot(shell).pos;
    for (let i = 0; i < 32; i++) {
      const r = Math.hypot(shellPos[i * 4]!, shellPos[i * 4 + 1]!, shellPos[i * 4 + 2]!);
      expect(r).toBeCloseTo(3, 5);
    }

    const disc = service.createSystem(
      makeConfig({
        capacity: 32,
        emitters: [{ kind: 'disc', origin: o, radius: 2, normal: [0, 0, 1] }]
      })
    );
    const discPos = snapshot(disc).pos;
    for (let i = 0; i < 32; i++) {
      const radial = Math.hypot(discPos[i * 4]!, discPos[i * 4 + 1]!);
      expect(radial).toBeLessThanOrEqual(2);
      expect(discPos[i * 4 + 2]!).toBeCloseTo(0, 5);
    }
    service.dispose();
  });

  it('recycles expired particles at age zero and keeps lifetimes bounded', () => {
    const service = new ParticleService({ computeAvailable: false });
    const origin: [number, number, number] = [5, -2, 7];
    const system = service.createSystem(
      makeConfig({
        capacity: 8,
        emitters: [{ kind: 'point', origin, speed: 0 }],
        lifetimeSeconds: [0.05, 0.05]
      })
    );
    const dt = 0.02;
    let sawRespawnAtOrigin = false;
    for (let frame = 0; frame < 40 && !sawRespawnAtOrigin; frame++) {
      system.update(dt);
      const { pos, life } = snapshot(system);
      for (let i = 0; i < 8; i++) {
        const atOrigin =
          pos[i * 4] === origin[0] && pos[i * 4 + 1] === origin[1] && pos[i * 4 + 2] === origin[2];
        if (atOrigin && life[i * 4] === 0) {
          expect(life[i * 4 + 1]).toBeCloseTo(0.05, 6);
          sawRespawnAtOrigin = true;
          break;
        }
      }
    }
    expect(sawRespawnAtOrigin).toBe(true);
    service.dispose();
  });

  it('clamps pathological dt to the documented 0.25 s guard', () => {
    const service = new ParticleService({ computeAvailable: false });
    const a = service.createSystem(makeConfig({ seed: 9 }));
    const b = service.createSystem(makeConfig({ seed: 9 }));
    a.update(100); // tab-restore spike
    b.update(0.25);
    expect(snapshot(a)).toEqual(snapshot(b));

    const before = snapshot(a).pos.slice();
    a.update(-5); // negative dt clamps to a no-op
    a.update(0);
    expect(snapshot(a).pos).toEqual(before);
    service.dispose();
  });

  it('reproduces identical state from identical (seed, frame sequence)', () => {
    const service = new ParticleService({ computeAvailable: false });
    const a = service.createSystem(makeConfig({ seed: 1234 }));
    const b = service.createSystem(makeConfig({ seed: 1234 }));
    for (let i = 0; i < 30; i++) {
      a.update(1 / 60);
      b.update(1 / 60);
    }
    expect(snapshot(a)).toEqual(snapshot(b));

    const c = service.createSystem(makeConfig({ seed: 5678 }));
    for (let i = 0; i < 30; i++) {
      c.update(1 / 60);
    }
    const aState = snapshot(a);
    const cState = snapshot(c);
    expect(cState.pos).not.toEqual(aState.pos);
    service.dispose();
  });

  it('reset(seed) restores a reproducible steady-state population', () => {
    const service = new ParticleService({ computeAvailable: false });
    const system = service.createSystem(makeConfig({ seed: 11 }));
    const pristine = JSON.stringify(Array.from(snapshot(system).pos));
    for (let i = 0; i < 10; i++) system.update(0.05);
    expect(JSON.stringify(Array.from(snapshot(system).pos))).not.toBe(pristine);
    system.reset(11);
    expect(JSON.stringify(Array.from(snapshot(system).pos))).toBe(pristine);
    service.dispose();
  });
});

describe('ParticleSystem configuration validation', () => {
  it('rejects invalid capacity and empty emitter lists', () => {
    const service = new ParticleService({ computeAvailable: false });
    expect(() => service.createSystem(makeConfig({ capacity: 0 }))).toThrow(/invalid capacity/);
    expect(() => service.createSystem(makeConfig({ capacity: Number.NaN }))).toThrow(
      /invalid capacity/
    );
    expect(() => service.createSystem(makeConfig({ emitters: [] }))).toThrow(
      /at least one emitter/
    );
    service.dispose();
  });

  it('warns and truncates emitter lists beyond MAX_EMITTERS instead of failing', () => {
    const service = new ParticleService({ computeAvailable: false });
    const many = Array.from({ length: 9 }, (_, i) => ({
      kind: 'point' as const,
      origin: [i, 0, 0] as [number, number, number]
    }));
    const system = service.createSystem(makeConfig({ emitters: many }));
    expect(warnings.some((w) => w.includes('only the first'))).toBe(true);
    expect(system.capacity).toBe(64);
    service.dispose();
  });
});

describe('ParticleSystem population scaling and debug metadata', () => {
  it('throttles instanceCount and clamps the scale into [0, 1]', () => {
    const service = new ParticleService({ computeAvailable: false });
    const system = service.createSystem(makeConfig({ capacity: 100 }));
    const geo = (system.object3d() as unknown as { geometry: InstancedBufferGeometry }).geometry;
    expect(geo.instanceCount).toBe(100);

    system.setPopulationScale(0.5);
    expect(geo.instanceCount).toBe(50);
    expect(system.getDebugSnapshot().drawnCount).toBe(50);

    system.setPopulationScale(0);
    expect(geo.instanceCount).toBe(0);
    system.setPopulationScale(5);
    expect(geo.instanceCount).toBe(100);
    system.setPopulationScale(-1);
    expect(geo.instanceCount).toBe(0);
    service.dispose();
  });

  it('reports buffer accounting and blending in the debug snapshot', () => {
    const service = new ParticleService({ computeAvailable: false });
    const system = service.createSystem(makeConfig({ capacity: 10, blending: 'normal' }));
    expect(system.getDebugSnapshot()).toMatchObject({
      capacity: 10,
      drawnCount: 10,
      bufferBytes: 480,
      updatePath: 'cpu',
      computeAvailable: false,
      blending: 'normal'
    });
    service.dispose();
  });
});

describe('ParticleService lifecycle and disposal ownership', () => {
  it('freezes handles after disposal and disposes each geometry exactly once', () => {
    const service = new ParticleService({ computeAvailable: false });
    const a = service.createSystem(makeConfig());
    const b = service.createSystem(makeConfig());

    let disposeEvents = 0;
    const onDispose = (): void => {
      disposeEvents += 1;
    };
    // Disposal ownership is exercised through the geometry: handle.dispose()
    // releases the instanced attributes via BufferGeometry.dispose(), which is
    // where three.js dispatches its 'dispose' event.
    for (const handle of [a, b]) {
      (
        handle.object3d() as unknown as {
          geometry: { addEventListener(type: 'dispose', fn: () => void): void };
        }
      ).geometry.addEventListener('dispose', onDispose);
    }

    const frozen = snapshot(a).pos.slice();
    a.dispose();
    a.dispose(); // idempotent
    a.update(0.5); // no-op after dispose
    expect(snapshot(a).pos).toEqual(frozen);

    service.dispose();
    expect(disposeEvents).toBe(2); // b disposed by the service; a not double-disposed

    expect(() => service.createSystem(makeConfig())).toThrow(/after dispose/);
    service.dispose(); // second service dispose is idempotent
  });
});
