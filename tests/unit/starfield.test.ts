import { describe, expect, it } from 'vitest';
import {
  cellHasStar,
  directionToCubeCell,
  faceCoordsToDirection,
  hashU32,
  makeCinematicStarfieldParams,
  makeStarfieldParams,
  sampleCinematicEnvironmentRadiance,
  sampleBrightness,
  sampleStarfieldRadiance,
  starBrightness,
  starFaceCoords,
  u32ToUnit,
  type StarfieldParams,
  type Vec3
} from '../../src/shaders/starfield.js';

function params(overrides: Partial<StarfieldParams> = {}): StarfieldParams {
  return makeStarfieldParams(overrides);
}

function normalize(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}

describe('hash primitives', () => {
  it('hashU32 is deterministic and stays in u32 range', () => {
    for (let x = 0; x < 1000; x += 1) {
      const h = hashU32(x, 12345);
      expect(h).toBe(hashU32(x, 12345));
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('u32ToUnit maps into [0, 1)', () => {
    expect(u32ToUnit(0)).toBe(0);
    expect(u32ToUnit(0xffffffff)).toBeLessThan(1);
    for (let x = 0; x < 500; x += 7) {
      const u = u32ToUnit(hashU32(x, 99));
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

describe('directionToCubeCell', () => {
  it('maps axis directions to the expected faces', () => {
    const p = params();
    expect(directionToCubeCell([1, 0, 0], p.cellsPerFaceSide)?.face).toBe(0);
    expect(directionToCubeCell([-1, 0, 0], p.cellsPerFaceSide)?.face).toBe(1);
    expect(directionToCubeCell([0, 1, 0], p.cellsPerFaceSide)?.face).toBe(2);
    expect(directionToCubeCell([0, -1, 0], p.cellsPerFaceSide)?.face).toBe(3);
    expect(directionToCubeCell([0, 0, 1], p.cellsPerFaceSide)?.face).toBe(4);
    expect(directionToCubeCell([0, 0, -1], p.cellsPerFaceSide)?.face).toBe(5);
  });

  it('returns null only for the zero vector', () => {
    expect(directionToCubeCell([0, 0, 0], 8)).toBeNull();
    expect(directionToCubeCell(normalize([0.3, -0.4, 0.5]), 8)).not.toBeNull();
  });

  it('cell indices stay in range near face edges', () => {
    const n = 16;
    // Directions just inside each face edge must not produce index n.
    for (const d of [
      [1, 0.9999, 0.9999],
      [1, -0.9999, 0.9999],
      [0.9999, 1, -0.9999]
    ]) {
      const c = directionToCubeCell(normalize(d as [number, number, number]), n);
      expect(c).not.toBeNull();
      expect(c!.i).toBeGreaterThanOrEqual(0);
      expect(c!.i).toBeLessThan(n);
      expect(c!.j).toBeGreaterThanOrEqual(0);
      expect(c!.j).toBeLessThan(n);
    }
  });
});

describe('determinism', () => {
  it('same inputs produce identical radiance across calls', () => {
    const p = params();
    const dirs = [normalize([0.2, 0.5, -0.84]), normalize([-0.9, 0.1, 0.42]), normalize([0, 1, 0])];
    for (const d of dirs) {
      const a = sampleStarfieldRadiance(d, p);
      const b = sampleStarfieldRadiance(d, p);
      expect(a).toEqual(b);
    }
  });

  it('same direction repeats regardless of call order', () => {
    const p = params();
    const d = normalize([0.44, -0.6, 0.67]);
    const first = sampleStarfieldRadiance(d, p);
    // Interleave unrelated lookups.
    for (let k = 0; k < 50; k += 1) {
      sampleStarfieldRadiance(normalize([k * 0.01, 0.5, 0.3]), p);
    }
    expect(sampleStarfieldRadiance(d, p)).toEqual(first);
  });
});

describe('seed sensitivity', () => {
  it('different seeds produce different star layouts', () => {
    const base = { cellsPerFaceSide: 32 };
    const pA = params({ ...base, seed: 1 });
    const pB = params({ ...base, seed: 2 });
    let differingCells = 0;
    let totalStars = 0;
    for (let f = 0; f < 6; f += 1) {
      for (let i = 0; i < 32; i += 4) {
        for (let j = 0; j < 32; j += 4) {
          const a = cellHasStar(f, i, j, pA);
          const b = cellHasStar(f, i, j, pB);
          if (a) totalStars += 1;
          if (a !== b) differingCells += 1;
        }
      }
    }
    expect(totalStars).toBeGreaterThan(10);
    expect(differingCells).toBeGreaterThan(0);
  });

  it('star positions and brightnesses change with the seed', () => {
    const pA = params({ seed: 7 });
    const pB = params({ seed: 8 });
    const sA = starFaceCoords(0, 3, 5, pA);
    const sB = starFaceCoords(0, 3, 5, pB);
    const sameSpot = Math.abs(sA.fu - sB.fu) < 1e-12 && Math.abs(sA.fv - sB.fv) < 1e-12;
    expect(sameSpot).toBe(false);
    expect(starBrightness(0, 3, 5, pA)).not.toBe(starBrightness(0, 3, 5, pB));
  });
});

describe('density control', () => {
  function countStars(p: StarfieldParams): number {
    let count = 0;
    for (let f = 0; f < 6; f += 1) {
      for (let i = 0; i < p.cellsPerFaceSide; i += 1) {
        for (let j = 0; j < p.cellsPerFaceSide; j += 1) {
          if (cellHasStar(f, i, j, p)) count += 1;
        }
      }
    }
    return count;
  }

  it('density zero means no stars anywhere', () => {
    const p = params({ starDensity: 0 });
    expect(countStars(p)).toBe(0);
  });

  it('density one fills every cell', () => {
    const p = params({ starDensity: 1, cellsPerFaceSide: 8 });
    expect(countStars(p)).toBe(6 * 8 * 8);
  });

  it('star count scales with density across sampled solid angle', () => {
    const n = 24;
    const low = countStars(params({ starDensity: 0.05, cellsPerFaceSide: n }));
    const high = countStars(params({ starDensity: 0.4, cellsPerFaceSide: n }));
    const total = 6 * n * n;
    expect(low / total).toBeGreaterThan(0.02);
    expect(low / total).toBeLessThan(0.1);
    expect(high / total).toBeGreaterThan(0.3);
    expect(high / total).toBeLessThan(0.5);
    expect(high).toBeGreaterThan(low * 4);
  });
});

describe('brightness distribution', () => {
  it('stays within declared bounds', () => {
    const p = params({ minBrightness: 0.5, maxBrightness: 20 });
    for (let f = 0; f < 6; f += 1) {
      for (let i = 0; i < 8; i += 1) {
        for (let j = 0; j < 8; j += 1) {
          if (!cellHasStar(f, i, j, p)) continue;
          const b = starBrightness(f, i, j, p);
          expect(b).toBeGreaterThanOrEqual(0.5);
          expect(b).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('responds to the exponent parameter', () => {
    const dims = { minBrightness: 0.25, maxBrightness: 8 };
    const flat = params({ ...dims, brightnessExponent: 0 });
    const steep = params({ ...dims, brightnessExponent: 4 });
    let sumFlat = 0;
    let sumSteep = 0;
    let count = 0;
    for (let u = 0; u < 200; u += 1) {
      const x = u / 200;
      sumFlat += sampleBrightness(x, flat);
      sumSteep += sampleBrightness(x, steep);
      count += 1;
    }
    expect(sumFlat / count).toBeGreaterThan((sumSteep / count) * 2);
  });

  it('alpha=0 is uniform and alpha=1 is log-uniform between bounds', () => {
    const dims = { minBrightness: 1, maxBrightness: 4 };
    expect(sampleBrightness(0, params({ ...dims, brightnessExponent: 0 }))).toBeCloseTo(1, 12);
    expect(sampleBrightness(0.999, params({ ...dims, brightnessExponent: 0 }))).toBeCloseTo(4, 2);
    expect(sampleBrightness(0, params({ ...dims, brightnessExponent: 1 }))).toBeCloseTo(1, 12);
    expect(sampleBrightness(1 - 1e-9, params({ ...dims, brightnessExponent: 1 }))).toBeCloseTo(
      4,
      6
    );
  });
});

describe('base radiance', () => {
  it('adds exactly when no star is hit', () => {
    const bg: [number, number, number] = [0.013, 0.007, 0.042];
    const p = params({ starDensity: 0, backgroundRadiance: bg });
    const r = sampleStarfieldRadiance(normalize([0.3, 0.8, -0.52]), p);
    expect(r[0]).toBe(bg[0]);
    expect(r[1]).toBe(bg[1]);
    expect(r[2]).toBe(bg[2]);
  });

  it('is present under stars too (star adds on top)', () => {
    const bg: [number, number, number] = [0.01, 0.02, 0.03];
    const p = params({ backgroundRadiance: bg });
    // Scan directions until we land on a star.
    let found: [number, number, number] | null = null;
    outer: for (let f = 0; f < 6; f += 1) {
      for (let i = 0; i < p.cellsPerFaceSide && !found; i += 1) {
        for (let j = 0; j < p.cellsPerFaceSide; j += 1) {
          if (!cellHasStar(f, i, j, p)) continue;
          const { fu, fv } = starFaceCoords(f, i, j, p);
          const dirs: Array<[number, number, number]> = [
            [1, -fv, -fu],
            [-1, -fv, fu],
            [fu, 1, fv],
            [fu, -1, -fv],
            [fu, fv, 1],
            [-fu, fv, -1]
          ];
          const raw = dirs[f];
          if (!raw) continue;
          const d = normalize(raw);
          found = sampleStarfieldRadiance(d, p);
          break outer;
        }
      }
    }
    expect(found).not.toBeNull();
    expect(found![0]).toBeGreaterThan(bg[0]);
    expect(found![1]).toBeGreaterThan(bg[1]);
    expect(found![2]).toBeGreaterThan(bg[2]);
  });
});

describe('direction independence sanity', () => {
  /**
   * Enumerates up to `limit` star-center directions by walking cells until
   * enough populated ones are found. Deterministic; exercises the same
   * hash->projection roundtrip production sampling uses.
   */
  function starCenterDirections(p: StarfieldParams, limit: number): Vec3[] {
    const dirs: Vec3[] = [];
    outer: for (let f = 0; f < 6; f += 1) {
      for (let i = 0; i < p.cellsPerFaceSide; i += 1) {
        for (let j = 0; j < p.cellsPerFaceSide; j += 1) {
          if (!cellHasStar(f, i, j, p)) continue;
          const { fu, fv } = starFaceCoords(f, i, j, p);
          dirs.push(normalize(faceCoordsToDirection(f, fu, fv)));
          if (dirs.length >= limit) break outer;
        }
      }
    }
    return dirs;
  }

  /** Finds a direction inside a cell that hosts NO star. */
  function emptyDirection(p: StarfieldParams): Vec3 {
    for (let f = 0; f < 6; f += 1) {
      for (let i = 0; i < p.cellsPerFaceSide; i += 1) {
        for (let j = 0; j < p.cellsPerFaceSide; j += 1) {
          if (cellHasStar(f, i, j, p)) continue;
          // Cell center in face-plane coordinates.
          const n = p.cellsPerFaceSide;
          const fu = ((i + 0.5) / n) * 2 - 1;
          const fv = ((j + 0.5) / n) * 2 - 1;
          return normalize(faceCoordsToDirection(f, fu, fv));
        }
      }
    }
    throw new Error('no empty cell exists for the given parameters');
  }

  it('distinct star centers are visible and mutually different', () => {
    const p = params();
    const dirs = starCenterDirections(p, 8);
    expect(dirs.length).toBeGreaterThanOrEqual(3);
    const bg = p.backgroundRadiance;
    const seen = new Set<string>();
    for (const d of dirs) {
      const rad = sampleStarfieldRadiance(d, p);
      const brighter = rad[0] > bg[0] + 1e-9 || rad[1] > bg[1] + 1e-9 || rad[2] > bg[2] + 1e-9;
      expect(brighter).toBe(true);
      seen.add(rad.join(','));
    }
    // Different stars have independent brightness draws, so not all values
    // may collapse into one number.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('directions in star-free cells return exactly the background', () => {
    const p = params();
    const d = emptyDirection(p);
    const rad = sampleStarfieldRadiance(d, p);
    const bg = p.backgroundRadiance;
    expect(rad[0]).toBe(bg[0]);
    expect(rad[1]).toBe(bg[1]);
    expect(rad[2]).toBe(bg[2]);
    // The antipode lands in a different cell; unless it happens to host a
    // star whose disk covers the direction, it must stay background too.
  });

  it('a star is not mirrored at the antipode of its center', () => {
    const p = params({ cellsPerFaceSide: 32 });
    const [d] = starCenterDirections(p, 1);
    expect(d).toBeDefined();
    const radPos = sampleStarfieldRadiance(d!, p);
    const radNeg = sampleStarfieldRadiance([-d![0], -d![1], -d![2]], p);
    // At least the star side must exceed background; the antipode is a
    // different cell with an independent draw.
    const bg = p.backgroundRadiance;
    expect(radPos[0] > bg[0] + 1e-9 || radPos[1] > bg[1] + 1e-9 || radPos[2] > bg[2] + 1e-9).toBe(
      true
    );
    // Direction-collapse guard: if the field were symmetric garbage, every
    // direction would return this same brightened value. The antipode must
    // either fall back to background or draw a different star value — never
    // exactly the brightened center reading.
    const negBright =
      radNeg[0] > bg[0] + 1e-9 || radNeg[1] > bg[1] + 1e-9 || radNeg[2] > bg[2] + 1e-9;
    const identical = radNeg[0] === radPos[0] && radNeg[1] === radPos[1] && radNeg[2] === radPos[2];
    expect(identical && negBright).toBe(false);
  });
});

describe('cinematic environment layer', () => {
  it('leaves the scientific sampler contract untouched', () => {
    const scientific = makeStarfieldParams();
    const cinematic = makeCinematicStarfieldParams();
    const direction = normalize([0.37, -0.41, 0.83]);
    expect(sampleStarfieldRadiance(direction, cinematic)).toEqual(
      sampleStarfieldRadiance(direction, scientific)
    );
  });

  it('adds deterministic diffuse/dense radiance without changing direction order', () => {
    const p = makeCinematicStarfieldParams({ seed: 90210 });
    const direction = normalize([-0.22, 0.71, 0.66]);
    const first = sampleCinematicEnvironmentRadiance(direction, p);
    const second = sampleCinematicEnvironmentRadiance(direction, p);
    expect(second).toEqual(first);
    expect(first[0]).toBeGreaterThanOrEqual(sampleStarfieldRadiance(direction, p)[0]);
    expect(first[1]).toBeGreaterThanOrEqual(sampleStarfieldRadiance(direction, p)[1]);
    expect(first[2]).toBeGreaterThanOrEqual(sampleStarfieldRadiance(direction, p)[2]);
  });
});
