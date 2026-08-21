import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATE,
  Invalidation,
  SCHEMA_VERSION,
  STATE_RANGES,
  classifyStateChange,
  normalizeAppState,
  type AppState
} from '../../src/app/state.js';

function base(): AppStateLike {
  return structuredClone(DEFAULT_STATE) as unknown as AppStateLike;
}

type AppStateLike = Record<string, unknown> & { schemaVersion: number };

function setLeaf(path: string[], value: unknown): Record<string, unknown> {
  const state = base();
  let node = state as Record<string, unknown>;
  for (const key of path.slice(0, -1)) {
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1] as string] = value;
  return state;
}

describe('normalizeAppState: defaults', () => {
  it('normalizes the canonical defaults into a renderable valid state', () => {
    const result = normalizeAppState(structuredClone(DEFAULT_STATE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(result.state.disk.outerRadiusRg).toBeGreaterThan(result.state.disk.innerRadiusRg);
    // Direction vectors come out unit length.
    const len = Math.hypot(...result.state.observer.up);
    expect(len).toBeCloseTo(1, 12);
  });

  it('is idempotent: normalizing a normalized state changes nothing', () => {
    const once = normalizeAppState(structuredClone(DEFAULT_STATE));
    if (!once.ok) throw new Error('expected ok');
    const twice = normalizeAppState(structuredClone(once.state));
    expect(twice.ok).toBe(true);
    if (!twice.ok) return;
    expect(twice.state).toEqual(once.state);
  });

  it('rejects non-object payloads', () => {
    for (const bad of [null, undefined, 42, 'state', []]) {
      const result = normalizeAppState(bad);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('STATE_INVALID');
    }
  });

  it('fails closed on unknown/future schema versions', () => {
    const result = normalizeAppState({ ...base(), schemaVersion: SCHEMA_VERSION + 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SCHEMA_VERSION_UNSUPPORTED');
  });
});

describe('normalizeAppState: finite-number rejection', () => {
  it('rejects NaN/Infinity wherever they appear', () => {
    const cases: Array<[string[], number]> = [
      [['blackHole', 'massSolar'], Number.NaN],
      [['blackHole', 'massSolar'], Number.POSITIVE_INFINITY],
      [['observer', 'fovYDeg'], Number.NaN],
      [['disk', 'innerRadiusRg'], Number.NEGATIVE_INFINITY],
      [['visual', 'exposureEv'], Number.NaN],
      [['rendering', 'maxSteps'], Number.POSITIVE_INFINITY],
      [['observer', 'simulationTime'], Number.NaN]
    ];
    for (const [path, value] of cases) {
      const result = normalizeAppState(setLeaf(path, value));
      expect(result.ok, `path ${path.join('.')} should reject ${value}`).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe('STATE_INVALID');
    }
  });

  it('rejects wrong types instead of coercing', () => {
    const result = normalizeAppState(setLeaf(['visual', 'bloomEnabled'], 'yes'));
    expect(result.ok).toBe(false);
  });

  it('rejects unknown enum values', () => {
    const metric = normalizeAppState(setLeaf(['blackHole', 'metric'], 'reissner-nordstrom'));
    expect(metric.ok).toBe(false);
    const tone = normalizeAppState(setLeaf(['visual', 'toneMapping'], 'neon'));
    expect(tone.ok).toBe(false);
  });
});

describe('normalizeAppState: clamps and repairs', () => {
  it('clamps FOV into the documented usable range', () => {
    const low = normalizeAppState(setLeaf(['observer', 'fovYDeg'], 1));
    const high = normalizeAppState(setLeaf(['observer', 'fovYDeg'], 500));
    expect(low.ok && high.ok).toBe(true);
    if (!low.ok || !high.ok) return;
    expect(low.state.observer.fovYDeg).toBe(STATE_RANGES.fovYDeg.min);
    expect(high.state.observer.fovYDeg).toBe(STATE_RANGES.fovYDeg.max);
  });

  it('rejects zero/negative mass and clamps above the documented maximum', () => {
    const zero = normalizeAppState(setLeaf(['blackHole', 'massSolar'], 0));
    const negative = normalizeAppState(setLeaf(['blackHole', 'massSolar'], -5));
    expect(zero.ok).toBe(false);
    expect(negative.ok).toBe(false);
    const huge = normalizeAppState(setLeaf(['blackHole', 'massSolar'], 1e20));
    expect(huge.ok).toBe(true);
    if (!huge.ok) return;
    expect(huge.state.blackHole.massSolar).toBe(STATE_RANGES.massSolar.max);
  });

  it('repairs inverted disk radii deterministically', () => {
    const result = normalizeAppState(
      setLeaf(['disk', 'outerRadiusRg'], 3) // below default inner radius 6
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.disk.outerRadiusRg).toBeGreaterThanOrEqual(
      result.state.disk.innerRadiusRg + STATE_RANGES.minDiskRadialExtent
    );
  });

  it('repairs inverted integrator step bounds deterministically', () => {
    const result = normalizeAppState(setLeaf(['rendering', 'minStep'], 0.9));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.rendering.minStep).toBeLessThan(result.state.rendering.maxStep);
  });

  it('forces effective spin to 0 for Schwarzschild and clamps Kerr spin', () => {
    const schw = normalizeAppState(setLeaf(['blackHole', 'spin'], 0.9));
    expect(schw.ok && schw.state.blackHole.spin === 0).toBe(true);
    const kerr = normalizeAppState({
      ...setLeaf(['blackHole', 'spin'], 2),
      blackHole: { ...(base()['blackHole'] as Record<string, unknown>), metric: 'kerr', spin: 2 }
    });
    expect(kerr.ok).toBe(true);
    if (!kerr.ok) return;
    expect(Math.abs(kerr.state.blackHole.spin)).toBeLessThanOrEqual(STATE_RANGES.absSpin);
  });

  it('truncates the disk seed to an integer deterministically', () => {
    const result = normalizeAppState(setLeaf(['disk', 'seed'], 1337.75));
    expect(result.ok && result.state.disk.seed === 1337).toBe(true);
  });
});

describe('normalizeAppState: vectors and camera geometry', () => {
  it('normalizes direction vectors to unit length', () => {
    const result = normalizeAppState(setLeaf(['blackHole', 'spinAxis'], [0, 0, 17]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.blackHole.spinAxis[2]).toBeCloseTo(1, 12);
  });

  it('rejects zero-length direction vectors', () => {
    for (const path of [
      ['blackHole', 'spinAxis'],
      ['disk', 'normal'],
      ['observer', 'up']
    ]) {
      const result = normalizeAppState(setLeaf(path, [0, 0, 0]));
      expect(result.ok, `${path.join('.')} zero vector must reject`).toBe(false);
    }
  });

  it('rejects coincident observer position/target (zero forward)', () => {
    const state = base();
    state['observer'] = {
      ...(state['observer'] as Record<string, unknown>),
      positionRg: [4, 4, 4],
      targetRg: [4, 4, 4]
    };
    expect(normalizeAppState(state).ok).toBe(false);
  });

  it('rejects up parallel to the view direction', () => {
    const state = base();
    state['observer'] = {
      ...(state['observer'] as Record<string, unknown>),
      positionRg: [0, 0, 30],
      targetRg: [0, 0, 0], // forward is -z; up +z is parallel
      up: [0, 0, 1]
    };
    expect(normalizeAppState(state).ok).toBe(false);
  });
});

describe('classifyStateChange: invalidation classification', () => {
  function changed(path: string[], value: unknown): { prev: AppState; next: AppState } {
    const prev = normalizeAppState(base());
    const next = normalizeAppState(setLeaf(path, value));
    if (!prev.ok) throw new Error('prev fixture must normalize');
    if (!next.ok) throw new Error('next fixture must normalize');
    return { prev: prev.state, next: next.state };
  }

  function maskFor(path: string[], value: unknown): Invalidation {
    const { prev, next } = changed(path, value);
    return classifyStateChange(prev, next);
  }

  it('returns None for identical states', () => {
    const prev = normalizeAppState(base());
    const next = normalizeAppState(base());
    expect(prev.ok && next.ok && classifyStateChange(prev.state, next.state)).toBe(
      Invalidation.None
    );
  });

  it('classifies every control family per the documented examples', () => {
    // exposure -> Post
    expect(maskFor(['visual', 'exposureEv'], 1)).toBe(Invalidation.Post);
    // tone mapping -> Post
    expect(maskFor(['visual', 'toneMapping'], 'aces')).toBe(Invalidation.Post);
    // disk temperature scale -> Radiance
    expect(maskFor(['disk', 'temperatureScale'], 2)).toBe(Invalidation.Radiance);
    // disk inner radius -> Geometry | Radiance
    expect(maskFor(['disk', 'innerRadiusRg'], 8)).toBe(
      Invalidation.Geometry | Invalidation.Radiance
    );
    // camera fov -> Camera | Geometry
    expect(maskFor(['observer', 'fovYDeg'], 90)).toBe(Invalidation.Camera | Invalidation.Geometry);
    // integration steps -> Geometry
    expect(maskFor(['rendering', 'maxSteps'], 1024)).toBe(Invalidation.Geometry);
    // backend preference -> Backend | Geometry
    expect(maskFor(['rendering', 'backendPreference'], 'numerical')).toBe(
      Invalidation.Backend | Invalidation.Geometry
    );
    // lensing toggle -> Geometry | Radiance
    expect(maskFor(['relativity', 'lensing'], false)).toBe(
      Invalidation.Geometry | Invalidation.Radiance
    );
    // mass in normalized mode -> UI-only (None)
    expect(maskFor(['blackHole', 'massSolar'], 1e7)).toBe(Invalidation.None);
    // resolution-only knobs -> None
    expect(maskFor(['rendering', 'renderScale'], 0.75)).toBe(Invalidation.None);
    expect(maskFor(['rendering', 'maxEffectiveDpr'], 1)).toBe(Invalidation.None);
    // debug overlay -> None
    expect(maskFor(['debug', 'overlay'], true)).toBe(Invalidation.None);
  });

  it('combines masks across multiple changed fields', () => {
    const state = base();
    state['visual'] = { ...(state['visual'] as Record<string, unknown>), exposureEv: 2 };
    state['rendering'] = { ...(state['rendering'] as Record<string, unknown>), maxSteps: 256 };
    const prev = normalizeAppState(base());
    const next = normalizeAppState(state);
    if (!prev.ok || !next.ok) throw new Error('fixtures must normalize');
    expect(classifyStateChange(prev.state, next.state)).toBe(
      Invalidation.Post | Invalidation.Geometry
    );
  });
});
