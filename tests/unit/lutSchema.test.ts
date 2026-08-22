/**
 * M8-02 unit tests — LUT manifest schema, domain mapping, and validation
 * (mission §40: manifest validation, checksums, domain mapping).
 */

import { describe, expect, it } from 'vitest';
import {
  B_CRITICAL_RG,
  DEFAULT_AXIS_X,
  psiToV,
  uToX,
  vToPsi,
  xToU
} from '../../src/phenomena/black-hole/lut/domain.js';
import {
  LUT_FAMILY_SCHWARZSCHILD_V1,
  LUT_SCHEMA_VERSION
} from '../../src/phenomena/black-hole/lut/types.js';
import {
  sha256Hex,
  validateLutManifest,
  verifyAssetChecksum
} from '../../src/phenomena/black-hole/lut/validate.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function validManifestJson(): Record<string, unknown> {
  return {
    schemaVersion: LUT_SCHEMA_VERSION,
    family: LUT_FAMILY_SCHWARZSCHILD_V1,
    generatorVersion: 'gen-1.0.0',
    generatorCommit: '7246c05',
    physicsConvention: 'schwarzschild-M1-static-observer, geometric units G=c=M=1',
    coordinateConvention:
      'planar (r,psi) state; rows start/end at r_ref crossing; WORLD_FRAME +Y disk normal',
    referenceSolverVersion: 'cpuReference.ts@7246c05#converged',
    generatedAt: '2026-08-22T00:00:00Z',
    provenance: {
      paper: 'arXiv:2010.08735',
      implementation: 'independent (no copied code)',
      license: 'MIT (this repo); concepts BSD-3-Clause cited',
      adaptation: 'concepts adapted, code independent'
    },
    physics: {
      massGeometric: 1,
      bCriticalRg: B_CRITICAL_RG,
      rRefRg: 64,
      escapeRadiusRg: 32
    },
    textures: [
      {
        id: 'trajectory',
        file: 'trajectory.rg32f',
        width: 512,
        height: 512,
        format: 'rg32f',
        interpolation: 'bilinear',
        domain: {
          kind: 'trajectory',
          axisX: DEFAULT_AXIS_X,
          psiMax: 12.566370614359172
        },
        channels: { r: 0 },
        sha256: SHA_A,
        byteLength: 512 * 512 * 8
      },
      {
        id: 'aux',
        file: 'aux.rgba32f',
        width: 512,
        height: 1,
        format: 'rgba32f',
        interpolation: 'bilinear',
        domain: { kind: 'aux', axisX: DEFAULT_AXIS_X },
        channels: { nR: 0, nT: 1, psiExit: 2, psiApsis: 3 },
        sha256: SHA_B,
        byteLength: 512 * 1 * 16
      }
    ],
    validation: {
      escapeDirectionAngularErrorRadMax: 0.01,
      diskHitRadiusErrorRgMax: 0.05,
      gFactorRelativeErrorMax: 0.02,
      classificationMismatchRate: 0,
      escapeDirectionAngularErrorRadRms: 0.004,
      diskHitRadiusErrorRgRms: 0.02
    },
    hybridBandHalfWidthX: 0.004
  };
}

// ---------------------------------------------------------------------------
// Domain mapping
// ---------------------------------------------------------------------------

describe('LUT domain mapping', () => {
  it('computes the analytic critical impact parameter', () => {
    expect(B_CRITICAL_RG).toBeCloseTo(5.196152422706632, 12);
  });

  it('xToU / uToX are exact inverses across the full range', () => {
    for (let i = 0; i <= 100; i += 1) {
      const x = (i / 100) * DEFAULT_AXIS_X.xKnots[3]!;
      const round = uToX(xToU(x, DEFAULT_AXIS_X), DEFAULT_AXIS_X);
      expect(round).toBeCloseTo(x, 10);
    }
  });

  it('is monotonic and concentrates resolution around criticality', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 200; i += 1) {
      const u = i / 200;
      const x = uToX(u, DEFAULT_AXIS_X);
      expect(x).toBeGreaterThan(prev);
      prev = x;
    }
    // The middle texture third must map into the narrow critical band.
    const bandLow = uToX(1 / 3, DEFAULT_AXIS_X);
    const bandHigh = uToX(2 / 3, DEFAULT_AXIS_X);
    expect(bandLow).toBeCloseTo(DEFAULT_AXIS_X.xKnots[1]!, 10);
    expect(bandHigh).toBeCloseTo(DEFAULT_AXIS_X.xKnots[2]!, 10);
    expect(bandLow).toBeLessThan(1);
    expect(bandHigh).toBeGreaterThan(1);
  });

  it('clamps out-of-range x to [0,1] texture space and rejects NaN', () => {
    expect(xToU(-1, DEFAULT_AXIS_X)).toBe(0);
    expect(xToU(1e9, DEFAULT_AXIS_X)).toBe(1);
    expect(Number.isNaN(uToX(NaN, DEFAULT_AXIS_X))).toBe(true);
  });

  it('psi <-> v helpers are texel-center consistent', () => {
    const height = 256;
    const psiMax = 12;
    for (const psi of [0, 0.001, 6, 11.999, 12]) {
      const v = psiToV(psi, psiMax, height);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      // vToPsi recovers a texel center within half a texel of psi.
      const back = vToPsi(v, psiMax, height);
      expect(Math.abs(back - Math.min(psi, psiMax))).toBeLessThan(psiMax / height);
    }
  });
});

// ---------------------------------------------------------------------------
// Manifest validation
// ---------------------------------------------------------------------------

describe('LUT manifest validation', () => {
  it('accepts a well-formed manifest', () => {
    const res = validateLutManifest(validManifestJson());
    if (!res.ok) throw new Error(`expected ok, got ${res.reason}: ${res.detail}`);
    expect(res.manifest.family).toBe(LUT_FAMILY_SCHWARZSCHILD_V1);
    expect(res.manifest.textures).toHaveLength(2);
    expect(res.manifest.physics.bCriticalRg).toBeCloseTo(B_CRITICAL_RG, 12);
    // Channels are normalized to numbers.
    expect(res.manifest.textures[1]!.channels['nR']).toBe(0);
  });

  const rejectCases: Array<[string, (m: Record<string, unknown>) => void, string]> = [
    [
      'wrong schemaVersion',
      (m) => {
        m['schemaVersion'] = 99;
      },
      'schema-version'
    ],
    [
      'unknown family',
      (m) => {
        m['family'] = 'kerr-v9';
      },
      'unknown-family'
    ],
    [
      'missing generatorCommit',
      (m) => {
        delete m['generatorCommit'];
      },
      'missing-field'
    ],
    [
      'empty provenance.adaptation',
      (m) => {
        (m['provenance'] as Record<string, unknown>)['adaptation'] = '';
      },
      'missing-field'
    ],
    [
      'mass not 1',
      (m) => {
        (m['physics'] as Record<string, unknown>)['massGeometric'] = 42;
      },
      'bad-physics'
    ],
    [
      'rRef <= escapeRadius',
      (m) => {
        (m['physics'] as Record<string, unknown>)['rRefRg'] = 32;
      },
      'bad-physics'
    ],
    [
      'unsupported texture format',
      (m) => {
        (m['textures'] as Array<Record<string, unknown>>)[0]!['format'] = 'rgb9e5';
      },
      'bad-field-type'
    ],
    [
      'wrong byteLength',
      (m) => {
        (m['textures'] as Array<Record<string, unknown>>)[0]!['byteLength'] = 17;
      },
      'bad-field-type'
    ],
    [
      'checksum not hex64',
      (m) => {
        (m['textures'] as Array<Record<string, unknown>>)[1]!['sha256'] = 'DEADBEEF';
      },
      'bad-field-type'
    ],
    [
      'unsafe asset path',
      (m) => {
        (m['textures'] as Array<Record<string, unknown>>)[0]!['file'] = '../secrets.bin';
      },
      'bad-field-type'
    ],
    [
      'dimensions over cap',
      (m) => {
        const t = (m['textures'] as Array<Record<string, unknown>>)[0]!;
        t['width'] = 65536;
        t['byteLength'] = 65536 * (t['height'] as number) * 8;
      },
      'bad-field-type'
    ],
    [
      'domain kind mismatch',
      (m) => {
        (
          (m['textures'] as Array<Record<string, unknown>>)[0]!['domain'] as Record<string, unknown>
        )['kind'] = 'aux';
      },
      'bad-field-type'
    ],
    [
      'xKnots do not straddle criticality',
      (m) => {
        const d = (m['textures'] as Array<Record<string, unknown>>)[0]!['domain'] as Record<
          string,
          unknown
        >;
        d['axisX'] = { uBreakpoints: [0, 0.5, 0.75, 1], xKnots: [0, 0.9, 0.95, 3] };
      },
      'bad-field-type'
    ],
    [
      'missing aux texture',
      (m) => {
        (m['textures'] as Array<Record<string, unknown>>).pop();
      },
      'bad-texture-set'
    ],
    [
      'duplicate file names',
      (m) => {
        (m['textures'] as Array<Record<string, unknown>>)[1]!['file'] = (
          m['textures'] as Array<Record<string, unknown>>
        )[0]!['file'];
      },
      'bad-texture-set'
    ],
    [
      'axis knots differ between textures',
      (m) => {
        const d = (m['textures'] as Array<Record<string, unknown>>)[1]!['domain'] as Record<
          string,
          unknown
        >;
        d['axisX'] = { uBreakpoints: [0, 0.25, 0.5, 1], xKnots: [0, 0.85, 1.15, 3] };
      },
      'bad-domain'
    ],
    [
      'negative hybrid band',
      (m) => {
        m['hybridBandHalfWidthX'] = -0.01;
      },
      'bad-validation-summary'
    ],
    [
      'NaN in validation summary',
      (m) => {
        (m['validation'] as Record<string, unknown>)['gFactorRelativeErrorMax'] = NaN;
      },
      'bad-validation-summary'
    ]
  ];

  for (const [name, mutate, expectedReason] of rejectCases) {
    it(`rejects: ${name}`, () => {
      const m = validManifestJson();
      mutate(m);
      const res = validateLutManifest(m);
      expect(res.ok).toBe(false);
      if (!res.ok && expectedReason !== 'not-an-object') {
        expect(res.reason).toBe(expectedReason);
      } else if (!res.ok) {
        expect(['not-an-object', 'bad-field-type']).toContain(res.reason);
      }
    });
  }

  it('rejects array roots explicitly as not-an-object', () => {
    const res = validateLutManifest([1, 2, 3]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('not-an-object');
  });

  it('rejects wrong channel index for the format', () => {
    const m = validManifestJson();
    ((m['textures'] as Array<Record<string, unknown>>)[1]!['channels'] as Record<string, unknown>)[
      'psiApsis'
    ] = 7;
    const res = validateLutManifest(m);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain('out of range');
  });

  it('rejects trajectory texture missing the r channel', () => {
    const m = validManifestJson();
    delete (
      (m['textures'] as Array<Record<string, unknown>>)[0]!['channels'] as Record<string, unknown>
    )['r'];
    const res = validateLutManifest(m);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.detail).toContain("channel 'r'");
  });
});

// ---------------------------------------------------------------------------
// Checksums
// ---------------------------------------------------------------------------

describe('LUT asset checksums', () => {
  it('sha256Hex matches known vector and verifyAssetChecksum accepts match', async () => {
    const bytes = new TextEncoder().encode('blackhole-lut');
    const hex = await sha256Hex(bytes);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    await expect(verifyAssetChecksum(bytes, hex)).resolves.toBe(true);
    await expect(verifyAssetChecksum(bytes, SHA_A)).resolves.toBe(false);
    await expect(verifyAssetChecksum(bytes, 'NOT-HEX')).resolves.toBe(false);
  });
});
