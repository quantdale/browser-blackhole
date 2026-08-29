import { describe, expect, it } from 'vitest';
import { PerspectiveCamera } from 'three';

import {
  CINEMATIC_DETAIL_BY_TIER,
  cinematicIntensity,
  cinematicSeed,
  createCinematicBackdrop
} from '../../src/renderer/shared/CinematicPrimitives';

describe('cinematic representation primitives', () => {
  it('keeps detail budgets ordered and bounded by the global quality tier', () => {
    expect(CINEMATIC_DETAIL_BY_TIER.low.backdropOctaves).toBeLessThan(
      CINEMATIC_DETAIL_BY_TIER.ultra.backdropOctaves
    );
    expect(CINEMATIC_DETAIL_BY_TIER.low.surfaceOctaves).toBeGreaterThanOrEqual(1);
    expect(CINEMATIC_DETAIL_BY_TIER.ultra.haloSegments.width).toBeLessThanOrEqual(48);
  });

  it('folds seeds deterministically without allowing non-finite values', () => {
    expect(cinematicSeed(42)).toBe(cinematicSeed(42));
    expect(cinematicSeed(42)).not.toBe(cinematicSeed(43));
    expect(Number.isFinite(cinematicSeed(Number.NaN))).toBe(true);
  });

  it('clamps presentation intensity while preserving an explicit zero', () => {
    expect(cinematicIntensity(0, 2)).toBe(0);
    expect(cinematicIntensity(-1)).toBe(0);
    expect(cinematicIntensity(100)).toBe(32);
    expect(cinematicIntensity(Number.NaN, 0.5)).toBe(0.5);
  });

  it('keeps the backdrop camera-safe and disposes its owned resources', () => {
    const backdrop = createCinematicBackdrop({ seed: 7, intensity: 0.25 });
    const camera = new PerspectiveCamera(60, 1, 0.05, 5_000);
    camera.position.set(0, 0, 700);
    backdrop.syncToCamera(camera);

    expect(backdrop.mesh.scale.x).toBeGreaterThan(camera.position.length());
    expect(backdrop.mesh.renderOrder).toBeLessThan(0);
    backdrop.dispose();
    expect(backdrop.geometry).toBeDefined();
  });
});
