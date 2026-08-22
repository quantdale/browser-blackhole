/**
 * Schwarzschild LUT manifest types and constants (M8-02, BH-162 schema half).
 *
 * Spec sources:
 * - docs/LUT_BACKEND_SPEC.md §5 (manifest requirements), §16 (cache/versioning)
 * - docs/SHADER_CONTRACTS.md §19 (LutManifest resource contract — this module
 *   is the concrete v1 realization of that sketch; the renderer must reject
 *   incompatible manifests instead of sampling a plausible wrong table)
 * - docs/LUT_BACKEND_ADR.md §4 (what each table physically means), §9
 *   (precision assumptions recorded per family)
 *
 * OWNERSHIP: this file is the single source of truth for the wire format.
 * The offline generator (tools/generate-luts) WRITES it, the runtime loader
 * VALIDATES against it, and neither may reinterpret field meanings locally.
 *
 * Versioning/cache contract: assets live under an immutable directory whose
 * name embeds the manifest content hash (`/luts/<family>-<hash>/...`), so a
 * new decoder can never be paired with stale browser-cached tables
 * (LUT_BACKEND_SPEC.md §16). Manifests are machine-written only; hand edits
 * fail checksum/schema validation by construction.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

/** Wire/schema version. Bump on ANY breaking change to these types. */
export const LUT_SCHEMA_VERSION = 1;

/**
 * First LUT family: non-rotating (Schwarzschild) trajectory tables generated
 * from the repository CPU reference solver (docs/LUT_BACKEND_ADR.md §1/§4).
 */
export const LUT_FAMILY_SCHWARZSCHILD_V1 = 'schwarzschild-v1';

/** Known families the loader accepts. Unknown families are rejected. */
export const KNOWN_LUT_FAMILIES: readonly string[] = [LUT_FAMILY_SCHWARZSCHILD_V1];

// ---------------------------------------------------------------------------
// Texture encoding vocabulary
// ---------------------------------------------------------------------------

/**
 * Sampled texture formats the runtime knows how to create and sample.
 * Values match GPUTextureFormat / internalformat spellings shared by WebGPU
 * and WebGL2 semantics ('rg16f' etc.). Whether a format is FILTERABLE in the
 * active backend is a capability check, not part of the schema.
 */
export type LutTextureFormat = 'r16f' | 'rg16f' | 'rgba16f' | 'r32f' | 'rg32f' | 'rgba32f';

export const LUT_TEXTURE_FORMATS: readonly LutTextureFormat[] = [
  'r16f',
  'rg16f',
  'rgba16f',
  'r32f',
  'rg32f',
  'rgba32f'
];

/** Interpolation used when the table was VALIDATED (must match at runtime). */
export type LutInterpolation = 'bilinear' | 'nearest';

/** Byte length of one texel for a supported format. */
export function lutFormatBytesPerPixel(format: LutTextureFormat): number {
  switch (format) {
    case 'r16f':
      return 2;
    case 'rg16f':
      return 4;
    case 'rgba16f':
      return 8;
    case 'r32f':
      return 4;
    case 'rg32f':
      return 8;
    case 'rgba32f':
      return 16;
  }
}

/** Channel count for a supported format. */
export function lutFormatChannelCount(format: LutTextureFormat): number {
  switch (format) {
    case 'r16f':
    case 'r32f':
      return 1;
    case 'rg16f':
    case 'rg32f':
      return 2;
    case 'rgba16f':
    case 'rgba32f':
      return 4;
  }
}

// ---------------------------------------------------------------------------
// Domain description
// ---------------------------------------------------------------------------

/**
 * Piecewise-linear breakpoints of the normalized impact-parameter axis.
 *
 * `x = b / b_c` is the PHYSICAL coordinate (b_c = 3*sqrt(3)*M, ADR §6);
 * `u in [0,1]` is the texture coordinate. The mapping concentrates table
 * resolution around criticality: the middle segment `[u1,u2)` covers the
 * narrow physical band `[xLow, xHigh]` straddling `x = 1`. Both generator
 * and sampler invert these EXACT functions; the values travel inside the
 * manifest so a regenerated family with different breakpoints is never
 * decoded with stale assumptions.
 */
export interface LutAxisMapping {
  /** Texture-space breakpoints, strictly increasing, first=0, last=1. */
  uBreakpoints: [number, number, number, number];
  /** Physical x values at the same knots, strictly increasing, xLow < 1 < xHigh. */
  xKnots: [number, number, number, number];
}

/**
 * Trajectory-table axis description (ADR §4): columns index `x = b/b_c`
 * through {@link LutAxisMapping}; rows index accumulated in-plane azimuth
 * `psi` UNIFORMLY over `[0, psiMax]` (uniform psi aligns with the physics:
 * equatorial-plane crossing candidates are equally spaced in psi).
 */
export interface LutTrajectoryDomain {
  kind: 'trajectory';
  axisX: LutAxisMapping;
  /** Maximum accumulated azimuth stored per row (radians, > 0). */
  psiMax: number;
}

/** Per-row auxiliary texel layout (one texel per column, height 1). */
export interface LutAuxDomain {
  kind: 'aux';
  axisX: LutAxisMapping;
}

export type LutTextureDomain = LutTrajectoryDomain | LutAuxDomain;

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/** One shipped binary texture asset + how to interpret it. */
export interface LutTextureEntry {
  /** Stable logical id; the loader binds by id, not by file order. */
  id: 'trajectory' | 'aux';
  /** Asset path RELATIVE to the manifest file. No '..'; no absolute paths. */
  file: string;
  width: number;
  height: number;
  format: LutTextureFormat;
  interpolation: LutInterpolation;
  domain: LutTextureDomain;
  /**
   * Channel semantic map: channel index -> meaning. Meanings are fixed per
   * texture id (see docs/LUT_BACKEND_ADR.md §4):
   * - trajectory: 0 = r(psi; x) in r_g.
   * - aux:        0 = nR, 1 = nT (terminal tetrad direction components),
   *               2 = psiExit (rad), 3 = psiApsis (rad).
   */
  channels: Record<string, number>;
  /** SHA-256 of the raw asset bytes, lowercase hex (64 chars). */
  sha256: string;
  byteLength: number;
}

/** Quantity-keyed error summary from the generator's validation pass. */
export interface LutValidationSummary {
  /** Each value: max absolute error of the quantity over the test corpus. */
  escapeDirectionAngularErrorRadMax: number;
  diskHitRadiusErrorRgMax: number;
  gFactorRelativeErrorMax: number;
  classificationMismatchRate: number;
  /** RMS variants where computed. */
  escapeDirectionAngularErrorRadRms: number;
  diskHitRadiusErrorRgRms: number;
}

/** Provenance block required for every shipped family (ASSET_PROVENANCE §7). */
export interface LutProvenance {
  paper: string;
  implementation: string;
  license: string;
  /** What was concept-adapted vs independently implemented. */
  adaptation: string;
}

/** Complete, self-describing manifest for one immutable LUT family version. */
export interface LutManifest {
  schemaVersion: typeof LUT_SCHEMA_VERSION;
  family: string;
  generatorVersion: string;
  /** Git commit of the generator/reference solver that produced the data. */
  generatorCommit: string;
  /** e.g. "schwarzschild-M1-static-observer, geometric units G=c=M=1". */
  physicsConvention: string;
  /** Coordinate/frame statement the sampler relies on (ADR §2). */
  coordinateConvention: string;
  /** Reference solver identity ("cpuReference.ts@<commit>#<convergence>"). */
  referenceSolverVersion: string;
  /** ISO-8601 generation timestamp (identity metadata, not parsed further). */
  generatedAt: string;
  provenance: LutProvenance;
  /** Physics scalars binding the tables to the renderer's unit system. */
  physics: {
    /** Geometric mass parameter; tables are generated at M = 1. */
    massGeometric: number;
    /** Critical impact parameter b_c = 3*sqrt(3)*M used by the generator. */
    bCriticalRg: number;
    /** Reference sphere radius where rows start/end (r_g, ADR §4). */
    rRefRg: number;
    /** Escape radius the validation corpus assumed (r_g). */
    escapeRadiusRg: number;
  };
  textures: LutTextureEntry[];
  validation: LutValidationSummary;
  /**
   * Half-width (in x = b/b_c units) of the band around x = 1 inside which
   * winding may exceed the tabulated budget; rays landing here route to the
   * NUMERICAL backend (explicit hybrid rule, ADR §6). Measured at generation.
   */
  hybridBandHalfWidthX: number;
}

// ---------------------------------------------------------------------------
// Structured rejection reasons
// ---------------------------------------------------------------------------

/** Machine-readable failure taxonomy for manifest validation (mission §10). */
export type LutManifestRejectReason =
  | 'not-an-object'
  | 'schema-version'
  | 'unknown-family'
  | 'missing-field'
  | 'bad-field-type'
  | 'bad-texture-set'
  | 'bad-dimensions'
  | 'bad-format'
  | 'bad-domain'
  | 'bad-checksum-field'
  | 'unsafe-path'
  | 'bad-physics'
  | 'bad-validation-summary';

export type LutManifestValidation =
  | { readonly ok: true; readonly manifest: LutManifest }
  | { readonly ok: false; readonly reason: LutManifestRejectReason; readonly detail: string };
