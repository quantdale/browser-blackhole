/**
 * Unit tests for the M5 canonical Atlas product state additions
 * (experience mode / debug domain / dynamic-resolution flag and the
 * `mode=` share-link parameter).
 *
 * Spec sources:
 * - campaign brief sections 4/5 (canonical product state, experience modes);
 * - docs/cosmic-atlas/STATE_AND_ROUTES.md §6 (every public value passes one
 *   normalizer) and §9 (share links carry a compact subset only).
 */

import { describe, expect, it } from 'vitest';

import {
  CAMERA_FOV_DEG_RANGE,
  createDefaultAtlasState,
  DEFAULT_ACTIVE_DESTINATION,
  EXPERIENCE_MODE_VALUES,
  parseFromUrl,
  RENDER_SCALE_OVERRIDE_RANGE,
  serializeForUrl,
  validateAtlasState
} from '../../src/atlas/atlasState.js';

describe('M5 experience/debug state domains', () => {
  it('declares the canonical experience-mode vocabulary', () => {
    expect(EXPERIENCE_MODE_VALUES).toEqual(['scientific', 'cinematic', 'debug']);
    expect(DEFAULT_ACTIVE_DESTINATION).toBe('black-hole');
  });
  it('defaults to Scientific mode with diagnostics disabled', () => {
    const state = createDefaultAtlasState();
    expect(state.experience.mode).toBe('scientific');
    expect(state.debug.diagnosticsEnabled).toBe(false);
    expect(state.rendering.dynamicResolution).toBe(true);
    expect(state.rendering.renderScaleOverride).toBeNull();
  });

  it('normalizes invalid mode values back to scientific', () => {
    const state = validateAtlasState({ schemaVersion: 1, experience: { mode: 'holodeck' } });
    expect(state.experience.mode).toBe('scientific');
  });

  it('preserves valid cinematic/debug modes', () => {
    expect(
      validateAtlasState({ schemaVersion: 1, experience: { mode: 'cinematic' } }).experience.mode
    ).toBe('cinematic');
    expect(
      validateAtlasState({ schemaVersion: 1, experience: { mode: 'debug' } }).experience.mode
    ).toBe('debug');
  });

  it('normalizes the debug domain defensively', () => {
    expect(
      validateAtlasState({ schemaVersion: 1, debug: { diagnosticsEnabled: true } }).debug
        .diagnosticsEnabled
    ).toBe(true);
    expect(
      validateAtlasState({ schemaVersion: 1, debug: { diagnosticsEnabled: 'yes' } }).debug
        .diagnosticsEnabled
    ).toBe(false);
    expect(validateAtlasState({ schemaVersion: 1, debug: null }).debug.diagnosticsEnabled).toBe(
      false
    );
  });

  it('normalizes dynamicResolution as a boolean with default true', () => {
    expect(
      validateAtlasState({ schemaVersion: 1, rendering: { dynamicResolution: false } }).rendering
        .dynamicResolution
    ).toBe(false);
    expect(
      validateAtlasState({ schemaVersion: 1, rendering: { dynamicResolution: 7 } }).rendering
        .dynamicResolution
    ).toBe(true);
  });

  it('clamps renderScaleOverride into the documented range', () => {
    // Clamp-don't-reject: out-of-range values clamp to the nearest bound.
    const tooSmall = validateAtlasState({
      schemaVersion: 1,
      rendering: { renderScaleOverride: 0.01 }
    });
    expect(tooSmall.rendering.renderScaleOverride).toBeCloseTo(RENDER_SCALE_OVERRIDE_RANGE.min);
    const valid = validateAtlasState({
      schemaVersion: 1,
      rendering: { renderScaleOverride: 0.75 }
    });
    expect(valid.rendering.renderScaleOverride).toBeCloseTo(0.75);
    // Non-finite values collapse to null (governor-managed resolution).
    const invalid = validateAtlasState({
      schemaVersion: 1,
      rendering: { renderScaleOverride: 'high' }
    });
    expect(invalid.rendering.renderScaleOverride).toBeNull();
  });

  it('clamps camera fov into the documented display range', () => {
    const clamped = validateAtlasState({ schemaVersion: 1, camera: { fovDeg: 999 } });
    expect(clamped.camera.fovDeg).toBe(CAMERA_FOV_DEG_RANGE.max);
  });

  it('round-trips experience.mode through the share-link serializer', () => {
    const cinematic = createDefaultAtlasState();
    cinematic.experience.mode = 'cinematic';
    const serialized = serializeForUrl(cinematic);
    expect(serialized).toContain('mode=cinematic');
    const parsed = parseFromUrl(serialized);
    expect(parsed.experience?.mode).toBe('cinematic');

    // Scientific is the default and must be omitted from share links.
    const scientific = serializeForUrl(createDefaultAtlasState());
    expect(scientific).not.toContain('mode=');

    // Invalid mode in a share link collapses back to the default.
    const bad = parseFromUrl('v=1&mode=warp');
    expect(bad.experience?.mode).toBe('scientific');
  });

  it('round-trips the trajectory backend through the share-link serializer', () => {
    // Non-default preference must appear in share links as tb=.
    const lutState = createDefaultAtlasState();
    lutState.rendering.trajectoryBackend = 'lut';
    const serialized = serializeForUrl(lutState);
    expect(serialized).toContain('tb=lut');
    const parsed = parseFromUrl(serialized);
    expect(parsed.rendering?.trajectoryBackend).toBe('lut');

    // Auto is the default and must be omitted from share links.
    const auto = serializeForUrl(createDefaultAtlasState());
    expect(auto).not.toContain('tb=');

    // Invalid values in a share link collapse back to auto.
    const bad = parseFromUrl('v=1&tb=warp');
    expect(bad.rendering?.trajectoryBackend).toBe('auto');
  });

  it('keeps quality and trajectory share keys independent (complete sections)', () => {
    const parsed = parseFromUrl('v=1&tb=numerical');
    expect(parsed.rendering?.qualityMode).toBe('auto');
    expect(parsed.rendering?.trajectoryBackend).toBe('numerical');

    const qOnly = parseFromUrl('v=1&q=high');
    expect(qOnly.rendering?.qualityMode).toBe('high');
    expect(qOnly.rendering?.trajectoryBackend).toBe('auto');
  });

  it('rejects non-v1 schemas entirely (no silent migration)', () => {
    const defaults = createDefaultAtlasState();
    const rejected = validateAtlasState({
      schemaVersion: 2,
      experience: { mode: 'cinematic' }
    });
    expect(rejected.experience).toEqual(defaults.experience);
  });
});
