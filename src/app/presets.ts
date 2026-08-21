/**
 * Versioned state presets (docs/STATE_SCHEMA.md section 12).
 * Presets are partial state snapshots merged over canonical defaults and then
 * run through the same `normalizeAppState` boundary as everything else.
 */

import { DEFAULT_STATE, SCHEMA_VERSION, normalizeAppState, type AppState } from './state.js';

export interface Preset {
  id: string;
  name: string;
  description: string;
  schemaVersion: number;
  state: Partial<AppState>;
  tags: string[];
  expectedBackend?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merges a partial preset over the defaults (arrays are replaced, not merged). */
export function mergePresetOverDefaults(partial: Partial<AppState>): Record<string, unknown> {
  const merge = (base: unknown, override: unknown): unknown => {
    if (!isPlainObject(base) || !isPlainObject(override)) {
      return override === undefined ? base : override;
    }
    const out: Record<string, unknown> = { ...base };
    for (const key of Object.keys(override)) {
      out[key] = merge(base[key], override[key]);
    }
    return out;
  };
  return merge(DEFAULT_STATE, partial) as Record<string, unknown>;
}

/**
 * Loads a preset into a fully normalized state. Rejects the whole payload on
 * any validation failure so callers can fall back to defaults
 * (docs/FAILURE_RECOVERY.md section 11).
 */
export function loadPreset(preset: Preset): ReturnType<typeof normalizeAppState> {
  if (preset.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      code: 'SCHEMA_VERSION_UNSUPPORTED',
      reason: `preset "${preset.id}": unsupported schemaVersion ${String(preset.schemaVersion)}`
    };
  }
  return normalizeAppState(mergePresetOverDefaults(preset.state));
}

/** The M0 diagnostic preset: canonical defaults render the diagnostic frame. */
export const DIAGNOSTIC_PRESET: Preset = {
  id: 'm0-diagnostic',
  name: 'M0 Diagnostic',
  description:
    'Deterministic full-screen diagnostic frame. Color encodes the reconstructed camera ray direction; no black-hole physics is rendered yet.',
  schemaVersion: SCHEMA_VERSION,
  state: {},
  tags: ['diagnostic', 'm0']
};

/** Registry of built-in presets, keyed by id. */
export const BUILTIN_PRESETS: readonly Preset[] = [DIAGNOSTIC_PRESET];

export function findPreset(id: string): Preset | undefined {
  return BUILTIN_PRESETS.find((p) => p.id === id);
}
