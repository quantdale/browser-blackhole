/**
 * Cinematic disk atmosphere is a path-length factor, not a new redshift.
 * Scale 0 must be exactly 1 so Scientific mode can stay on the existing color.
 */
import { describe, expect, it } from 'vitest';

import {
  DISK_ATMOSPHERE_DISCLOSURE,
  diskAtmosphereFactor
} from '../../src/phenomena/black-hole/accretionDisk.js';

describe('cinematic disk atmosphere factor', () => {
  it('is exactly 1 when the scale is off', () => {
    expect(diskAtmosphereFactor(0.2, 0)).toBe(1);
    expect(diskAtmosphereFactor(1, -1)).toBe(1);
    expect(diskAtmosphereFactor(Number.NaN, 0)).toBe(1);
  });

  it('does not brighten a face-on crossing and does brighten a graze', () => {
    expect(diskAtmosphereFactor(1, 1)).toBeCloseTo(1, 8);
    const grazing = diskAtmosphereFactor(0.12, 1);
    expect(grazing).toBeGreaterThan(1.5);
    expect(grazing).toBeLessThanOrEqual(1 + 1.6);
  });

  it('does not claim a new redshift', () => {
    expect(DISK_ATMOSPHERE_DISCLOSURE).toContain('does not recompute redshift');
    expect(DISK_ATMOSPHERE_DISCLOSURE).toContain('Scientific');
  });
});
