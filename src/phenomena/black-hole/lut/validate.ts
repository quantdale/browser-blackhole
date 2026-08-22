/**
 * Strict manifest validation (M8-02; mission §10 "checksum / validation").
 *
 * The runtime loader MUST reject: wrong schema, missing textures, wrong
 * dimensions, wrong encoding, wrong version, unsupported format, malformed
 * domains/checksums/paths. Every rejection is structured (machine-readable
 * reason + human detail) so the black-hole destination can report fallback
 * truthfully in debug diagnostics instead of rendering a plausible wrong
 * table (LUT_BACKEND_SPEC.md §15; SHADER_CONTRACTS §19).
 *
 * Checksum VERIFICATION against actual bytes lives in verifyAssetChecksum
 * (async — WebCrypto) and is invoked by the loader after fetching assets.
 * This module is synchronous and pure so unit tests cover every branch.
 */

import {
  KNOWN_LUT_FAMILIES,
  LUT_SCHEMA_VERSION,
  LUT_TEXTURE_FORMATS,
  lutFormatBytesPerPixel,
  lutFormatChannelCount,
  type LutAuxDomain,
  type LutManifest,
  type LutManifestRejectReason,
  type LutManifestValidation,
  type LutTextureDomain,
  type LutTextureEntry,
  type LutTrajectoryDomain
} from './types.js';

// ---------------------------------------------------------------------------
// Small structural helpers (no `any`, prototype-safe)
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

function isHex64(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

function fail(
  reason: LutManifestRejectReason,
  detail: string
): { readonly ok: false; readonly reason: LutManifestRejectReason; readonly detail: string } {
  return { ok: false, reason, detail };
}

// ---------------------------------------------------------------------------
// Texture entry validation
// ---------------------------------------------------------------------------

const TRAJECTORY_CHANNEL_KEYS = ['r'] as const;
const AUX_CHANNEL_KEYS = ['nR', 'nT', 'psiExit', 'psiApsis'] as const;

/** Hard dimension caps keep a hostile manifest from allocating gigabytes. */
export const LUT_MAX_TEXTURE_DIM = 8192;

function validateChannels(
  channels: unknown,
  requiredKeys: readonly string[]
): { ok: true } | { ok: false; detail: string } {
  if (!isRecord(channels)) return { ok: false, detail: 'channels must be an object' };
  for (const key of requiredKeys) {
    const idx = channels[key];
    if (!Number.isInteger(idx) || typeof idx !== 'number' || (idx as number) < 0) {
      return { ok: false, detail: `channel '${key}' must be a non-negative integer index` };
    }
  }
  return { ok: true };
}

function validateAxisMapping(raw: unknown): { ok: true } | { ok: false; detail: string } {
  if (!isRecord(raw)) return { ok: false, detail: 'axis mapping must be an object' };
  const ub = raw['uBreakpoints'];
  const xk = raw['xKnots'];
  if (
    !Array.isArray(ub) ||
    ub.length !== 4 ||
    !ub.every(isFiniteNumber) ||
    !(ub[0] === 0 && ub[3] === 1 && (ub[1] as number) > 0 && (ub[2] as number) > (ub[1] as number))
  ) {
    return {
      ok: false,
      detail: `uBreakpoints must be [0,a,b,1] increasing, got ${JSON.stringify(ub)}`
    };
  }
  if (
    !Array.isArray(xk) ||
    xk.length !== 4 ||
    !xk.every(isFiniteNumber) ||
    !(
      xk[0] === 0 &&
      (xk[1] as number) > 0 &&
      (xk[2] as number) > (xk[1] as number) &&
      (xk[3] as number) > (xk[2] as number)
    )
  ) {
    return {
      ok: false,
      detail: `xKnots must be [0,...] strictly increasing, got ${JSON.stringify(xk)}`
    };
  }
  // Critical-region contract: the middle knot pair must straddle x = 1.
  if (!((xk[1] as number) < 1 && (xk[2] as number) > 1)) {
    return { ok: false, detail: 'xKnots must straddle criticality (xLow < 1 < xHigh)' };
  }
  return { ok: true };
}

function validateDomain(
  raw: unknown,
  textureId: string
): { ok: true } | { ok: false; detail: string } {
  if (!isRecord(raw)) return { ok: false, detail: `${textureId}: domain must be an object` };
  const kind = raw['kind'];
  if (kind !== 'trajectory' && kind !== 'aux') {
    return { ok: false, detail: `${textureId}: domain.kind must be 'trajectory'|'aux'` };
  }
  const axis = validateAxisMapping(raw['axisX']);
  if (!axis.ok) return { ok: false, detail: `${textureId}: ${axis.detail}` };
  if (kind === 'trajectory') {
    const psiMax = raw['psiMax'];
    if (!isFiniteNumber(psiMax) || psiMax <= 0 || psiMax > Math.PI * 16) {
      return {
        ok: false,
        detail: `${textureId}: psiMax must be finite in (0, 16*pi], got ${String(psiMax)}`
      };
    }
  }
  return { ok: true };
}

function validateTextureEntry(
  raw: unknown
): { ok: true; value: LutTextureEntry } | { ok: false; detail: string } {
  if (!isRecord(raw)) return { ok: false, detail: 'texture entry must be an object' };

  const id = raw['id'];
  if (id !== 'trajectory' && id !== 'aux') {
    return { ok: false, detail: `texture id must be 'trajectory'|'aux', got ${String(id)}` };
  }

  const file = raw['file'];
  if (!isNonEmptyString(file)) return { ok: false, detail: `${id}: missing file` };
  if (file.includes('..') || file.includes('\\') || file.startsWith('/')) {
    return { ok: false, detail: `${id}: unsafe asset path '${file}'` };
  }

  const width = raw['width'];
  const height = raw['height'];
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    (width as number) <= 0 ||
    (height as number) <= 0 ||
    (width as number) > LUT_MAX_TEXTURE_DIM ||
    (height as number) > LUT_MAX_TEXTURE_DIM
  ) {
    return {
      ok: false,
      detail: `${id}: dimensions must be integers in (0, ${LUT_MAX_TEXTURE_DIM}], got ${String(width)}x${String(height)}`
    };
  }

  const format = raw['format'];
  if (typeof format !== 'string' || !LUT_TEXTURE_FORMATS.includes(format as never)) {
    return {
      ok: false,
      detail: `${id}: unsupported format ${String(format)} (supported: ${LUT_TEXTURE_FORMATS.join(',')})`
    };
  }
  const fmt = format as LutTextureEntry['format'];

  const interpolation = raw['interpolation'];
  if (interpolation !== 'bilinear' && interpolation !== 'nearest') {
    return { ok: false, detail: `${id}: interpolation must be 'bilinear'|'nearest'` };
  }

  const domainCheck = validateDomain(raw['domain'], id);
  if (!domainCheck.ok) return domainCheck;
  const domain = raw['domain'] as LutTextureDomain;
  if (domain.kind !== id) {
    return { ok: false, detail: `${id}: domain.kind (${domain.kind}) must match texture id` };
  }

  const channelKeys = id === 'trajectory' ? TRAJECTORY_CHANNEL_KEYS : AUX_CHANNEL_KEYS;
  const channelCount = lutFormatChannelCount(fmt);
  const channelCheck = validateChannels(raw['channels'], channelKeys);
  if (!channelCheck.ok) return { ok: false, detail: `${id}: ${channelCheck.detail}` };
  const channels = raw['channels'] as Record<string, unknown>;
  for (const key of channelKeys) {
    const idx = channels[key] as number;
    if (!Number.isInteger(idx) || idx < 0 || idx >= channelCount) {
      return {
        ok: false,
        detail: `${id}: channel '${key}' index ${String(idx)} out of range for ${fmt} (${channelCount} channels)`
      };
    }
  }

  const sha256 = raw['sha256'];
  if (!isHex64(sha256))
    return { ok: false, detail: `${id}: sha256 must be 64 lowercase hex chars` };

  const byteLength = raw['byteLength'];
  const expectedBytes = (width as number) * (height as number) * lutFormatBytesPerPixel(fmt);
  if (!Number.isInteger(byteLength) || (byteLength as number) !== expectedBytes) {
    return {
      ok: false,
      detail: `${id}: byteLength ${String(byteLength)} != width*height*format (${expectedBytes})`
    };
  }

  return {
    ok: true,
    value: {
      id,
      file: file,
      width: width as number,
      height: height as number,
      format: fmt,
      interpolation: interpolation as LutTextureEntry['interpolation'],
      domain: domain as LutTrajectoryDomain | LutAuxDomain,
      channels: Object.fromEntries(channelKeys.map((k) => [k, channels[k] as number])),
      sha256: sha256,
      byteLength: byteLength as number
    }
  };
}

// ---------------------------------------------------------------------------
// Whole-manifest validation
// ---------------------------------------------------------------------------

/**
 * Validates an untrusted parsed JSON value as a {@link LutManifest}.
 * Returns a discriminated result; NEVER throws on bad input.
 */
export function validateLutManifest(raw: unknown): LutManifestValidation {
  if (!isRecord(raw)) return fail('not-an-object', 'manifest root must be a JSON object');

  if (raw['schemaVersion'] !== LUT_SCHEMA_VERSION) {
    return fail('schema-version', `schemaVersion must be exactly ${LUT_SCHEMA_VERSION}`);
  }
  const family = raw['family'];
  if (!isNonEmptyString(family)) return fail('missing-field', 'family must be a non-empty string');
  if (!KNOWN_LUT_FAMILIES.includes(family)) {
    return fail(
      'unknown-family',
      `family '${family}' not supported (known: ${KNOWN_LUT_FAMILIES.join(',')})`
    );
  }

  const requiredStrings: Array<[string, unknown]> = [
    ['generatorVersion', raw['generatorVersion']],
    ['generatorCommit', raw['generatorCommit']],
    ['physicsConvention', raw['physicsConvention']],
    ['coordinateConvention', raw['coordinateConvention']],
    ['referenceSolverVersion', raw['referenceSolverVersion']],
    ['generatedAt', raw['generatedAt']]
  ];
  for (const [name, value] of requiredStrings) {
    if (!isNonEmptyString(value))
      return fail('missing-field', `${name} must be a non-empty string`);
  }

  const prov = raw['provenance'];
  if (!isRecord(prov)) return fail('bad-field-type', 'provenance must be an object');
  for (const key of ['paper', 'implementation', 'license', 'adaptation']) {
    if (!isNonEmptyString(prov[key])) {
      return fail('missing-field', `provenance.${key} must be a non-empty string`);
    }
  }

  const physics = raw['physics'];
  if (!isRecord(physics)) return fail('bad-field-type', 'physics must be an object');
  if (physics['massGeometric'] !== 1) {
    return fail(
      'bad-physics',
      `tables are generated at massGeometric=1, got ${String(physics['massGeometric'])}`
    );
  }
  for (const key of ['bCriticalRg', 'rRefRg', 'escapeRadiusRg']) {
    const v = physics[key];
    if (!isFiniteNumber(v) || (v as number) <= 0) {
      return fail('bad-physics', `physics.${key} must be a positive finite number`);
    }
  }
  if ((physics['rRefRg'] as number) <= (physics['escapeRadiusRg'] as number)) {
    return fail('bad-physics', 'rRefRg must exceed escapeRadiusRg');
  }

  const texturesRaw = raw['textures'];
  if (!Array.isArray(texturesRaw)) return fail('bad-field-type', 'textures must be an array');
  const entries: LutTextureEntry[] = [];
  for (const t of texturesRaw) {
    const res = validateTextureEntry(t);
    if (!res.ok) return fail(res.ok === false ? 'bad-field-type' : 'bad-field-type', res.detail);
    entries.push(res.value);
  }
  const ids = new Set(entries.map((e) => e.id));
  if (ids.size !== entries.length || !ids.has('trajectory') || !ids.has('aux')) {
    return fail(
      'bad-texture-set',
      'textures must contain exactly one trajectory and one aux entry'
    );
  }
  const files = new Set(entries.map((e) => e.file));
  if (files.size !== entries.length) {
    return fail('bad-texture-set', 'texture asset files must be unique');
  }
  const traj = entries.find((e) => e.id === 'trajectory');
  const aux = entries.find((e) => e.id === 'aux');
  if (traj === undefined || aux === undefined) {
    return fail(
      'bad-texture-set',
      'textures must contain exactly one trajectory and one aux entry'
    );
  }
  const tx = (traj.domain as LutTrajectoryDomain).axisX;
  const ax = (aux.domain as LutAuxDomain).axisX;
  if (JSON.stringify(tx) !== JSON.stringify(ax)) {
    return fail('bad-domain', 'trajectory and aux textures must share identical axisX knots');
  }

  const hybridBand = raw['hybridBandHalfWidthX'];
  if (!isFiniteNumber(hybridBand) || (hybridBand as number) < 0) {
    return fail(
      'bad-validation-summary',
      'hybridBandHalfWidthX must be a non-negative finite number'
    );
  }

  const validation = raw['validation'];
  if (!isRecord(validation)) return fail('bad-validation-summary', 'validation must be an object');
  const numericSummaryKeys = [
    'escapeDirectionAngularErrorRadMax',
    'diskHitRadiusErrorRgMax',
    'gFactorRelativeErrorMax',
    'classificationMismatchRate',
    'escapeDirectionAngularErrorRadRms',
    'diskHitRadiusErrorRgRms'
  ] as const;
  for (const key of numericSummaryKeys) {
    const v = validation[key];
    if (!isFiniteNumber(v) || (v as number) < 0) {
      return fail(
        'bad-validation-summary',
        `validation.${key} must be a non-negative finite number`
      );
    }
  }

  return {
    ok: true,
    manifest: {
      schemaVersion: LUT_SCHEMA_VERSION,
      family: family,
      generatorVersion: raw['generatorVersion'] as string,
      generatorCommit: raw['generatorCommit'] as string,
      physicsConvention: raw['physicsConvention'] as string,
      coordinateConvention: raw['coordinateConvention'] as string,
      referenceSolverVersion: raw['referenceSolverVersion'] as string,
      generatedAt: raw['generatedAt'] as string,
      provenance: {
        paper: prov['paper'] as string,
        implementation: prov['implementation'] as string,
        license: prov['license'] as string,
        adaptation: prov['adaptation'] as string
      },
      physics: {
        massGeometric: 1,
        bCriticalRg: physics['bCriticalRg'] as number,
        rRefRg: physics['rRefRg'] as number,
        escapeRadiusRg: physics['escapeRadiusRg'] as number
      },
      textures: entries,
      validation: Object.fromEntries(
        numericSummaryKeys.map((k) => [k, validation[k]])
      ) as unknown as LutManifest['validation'],
      hybridBandHalfWidthX: hybridBand as number
    }
  };
}

// ---------------------------------------------------------------------------
// Asset checksum verification
// ---------------------------------------------------------------------------

/**
 * SHA-256 of raw bytes via WebCrypto (available in Node >= 15 and all
 * browsers). Lowercase hex, comparable to manifest fields.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** True when the fetched asset bytes match the manifest checksum field. */
export async function verifyAssetChecksum(
  bytes: Uint8Array,
  expectedHex: string
): Promise<boolean> {
  if (!isHex64(expectedHex)) return false;
  return (await sha256Hex(bytes)) === expectedHex;
}
