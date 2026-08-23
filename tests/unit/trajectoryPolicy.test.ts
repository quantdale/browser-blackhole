/**
 * M8-09 — canonical trajectory-backend preference resolution tests.
 *
 * Covers: precedence (URL override > canonical preference > auto policy),
 * truthful fallback reasons, unavailable-asset handling, invalid override
 * parsing, and normalization of the atlas rendering domain value.
 */

import { describe, expect, it } from 'vitest';

import {
  LUT_AUTO_DEFAULT,
  parseTrajectoryUrlOverride,
  resolveTrajectoryBackend,
  TRAJECTORY_BACKEND_VALUES,
  type TrajectoryBackendRequest
} from '../../src/atlas/trajectoryPolicy.js';
import { createDefaultAtlasState, validateAtlasState } from '../../src/atlas/atlasState.js';

function base(overrides: Partial<TrajectoryBackendRequest>): TrajectoryBackendRequest {
  return {
    preference: 'auto',
    urlOverride: null,
    lutAssetsReady: true,
    lutUnavailableReason: null,
    autoDefaultLut: false,
    ...overrides
  };
}

describe('trajectory backend vocabulary', () => {
  it('declares the canonical preference vocabulary with auto first', () => {
    expect(TRAJECTORY_BACKEND_VALUES).toEqual(['auto', 'numerical', 'lut']);
  });

  it('keeps the shipped auto default aligned with the recorded M8-08 decision', () => {
    // Evidence trail: docs/LUT_BACKEND_ADR.md §11 (criterion, fixed before
    // measurement) and §12 (measured outcome). Reverting this flag requires
    // a documented reason in the same commit.
    expect(LUT_AUTO_DEFAULT).toBe(true);
  });
});

describe('resolveTrajectoryBackend precedence', () => {
  it('auto resolves to numerical while the auto gate is closed (assets ready)', () => {
    const r = resolveTrajectoryBackend(base({}));
    expect(r).toEqual({ requested: 'auto', effective: 'numerical', fallbackReason: null });
  });

  it('auto resolves to lut when the gate AND readiness both hold (M8-08 flipped)', () => {
    // Regression guard for the M8-08 decision: the gate is TRUE with recorded
    // benchmark evidence (docs/LUT_BACKEND_ADR.md §11/§12); readiness is
    // still required — auto with unavailable assets stays numerical.
    expect(LUT_AUTO_DEFAULT).toBe(true);
    const notReady = resolveTrajectoryBackend(
      base({ autoDefaultLut: LUT_AUTO_DEFAULT, lutAssetsReady: false })
    );
    expect(notReady.effective).toBe('numerical');
    expect(notReady.fallbackReason).toBeNull();
    const open = resolveTrajectoryBackend(base({ autoDefaultLut: LUT_AUTO_DEFAULT }));
    expect(open).toEqual({ requested: 'auto', effective: 'lut', fallbackReason: null });
  });

  it('canonical numerical is always honored', () => {
    const r = resolveTrajectoryBackend(base({ preference: 'numerical' }));
    expect(r.effective).toBe('numerical');
    expect(r.fallbackReason).toBeNull();
  });

  it('canonical lut runs when assets are ready and falls back truthfully when not', () => {
    const ok = resolveTrajectoryBackend(base({ preference: 'lut' }));
    expect(ok).toEqual({ requested: 'lut', effective: 'lut', fallbackReason: null });

    const missing = resolveTrajectoryBackend(
      base({
        preference: 'lut',
        lutAssetsReady: false,
        lutUnavailableReason: 'lut-assets-unavailable'
      })
    );
    expect(missing).toEqual({
      requested: 'lut',
      effective: 'numerical',
      fallbackReason: 'lut-assets-unavailable'
    });
  });

  it('a lut request on a non-filterable backend falls back with the capability reason', () => {
    const r = resolveTrajectoryBackend(
      base({
        preference: 'lut',
        lutAssetsReady: false,
        lutUnavailableReason: 'lut-format-not-filterable-on-backend'
      })
    );
    expect(r.fallbackReason).toBe('lut-format-not-filterable-on-backend');
  });

  it('an explicit url override beats the canonical preference in both directions', () => {
    const forcedNumerical = resolveTrajectoryBackend(
      base({ preference: 'lut', urlOverride: 'numerical' })
    );
    expect(forcedNumerical.requested).toBe('numerical');
    expect(forcedNumerical.effective).toBe('numerical');
    // Never silent: overriding a lut request with numerical exposes why.
    expect(forcedNumerical.fallbackReason).toBe('numerical-forced-by-url-override');

    const forcedLut = resolveTrajectoryBackend(
      base({ preference: 'numerical', urlOverride: 'lut' })
    );
    expect(forcedLut).toEqual({ requested: 'lut', effective: 'lut', fallbackReason: null });
  });

  it('url override auto restores policy resolution over a canonical lut request', () => {
    const r = resolveTrajectoryBackend(
      base({ preference: 'lut', urlOverride: 'auto', autoDefaultLut: false })
    );
    expect(r.requested).toBe('auto');
    expect(r.effective).toBe('numerical');
  });
});

describe('?trajectory= override parsing', () => {
  it('accepts exactly the documented values', () => {
    expect(parseTrajectoryUrlOverride('lut')).toBe('lut');
    expect(parseTrajectoryUrlOverride('numerical')).toBe('numerical');
    expect(parseTrajectoryUrlOverride('auto')).toBe('auto');
  });

  it('rejects absent and invalid values (never poisons state)', () => {
    expect(parseTrajectoryUrlOverride(null)).toBeNull();
    expect(parseTrajectoryUrlOverride(undefined)).toBeNull();
    expect(parseTrajectoryUrlOverride('')).toBeNull();
    expect(parseTrajectoryUrlOverride('LUT')).toBeNull();
    expect(parseTrajectoryUrlOverride('fastest')).toBeNull();
  });
});

describe('canonical state integration', () => {
  it('defaults the rendering trajectory backend to auto', () => {
    expect(createDefaultAtlasState().rendering.trajectoryBackend).toBe('auto');
  });

  it('normalizes invalid values back to auto (clamp-don-t-reject)', () => {
    const bad = validateAtlasState({ schemaVersion: 1, rendering: { trajectoryBackend: 'warp' } });
    expect(bad.rendering.trajectoryBackend).toBe('auto');
    const good = validateAtlasState({ schemaVersion: 1, rendering: { trajectoryBackend: 'lut' } });
    expect(good.rendering.trajectoryBackend).toBe('lut');
  });

  it('rejects non-v1 schemas entirely (existing migration policy)', () => {
    const rejected = validateAtlasState({
      schemaVersion: 2,
      rendering: { trajectoryBackend: 'lut' }
    });
    expect(rejected.rendering.trajectoryBackend).toBe('auto');
  });
});
