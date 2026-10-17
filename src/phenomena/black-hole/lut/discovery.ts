/**
 * Shipped-LUT discovery — the PURE resolution core shared by the product and
 * its tests (verification-gate-integrity D5/V-04).
 *
 * Before this module existed, the product resolved `public/luts/index.json`
 * inline (every failure a silent `null`) while the tests scanned
 * `public/luts/` for the first directory holding a manifest — a DIFFERENT,
 * readdir-order-dependent code path (V-14) that could never notice the
 * shipped index pointing at a non-existent family (negative test 1.1: the
 * whole suite stayed green against a broken index). Both sides now resolve
 * through these functions, and every rejection carries a reason.
 */

/** A directory name INSIDE the luts root (never a path). */
export type LutIndexResolution = { ok: true; familyDir: string } | { ok: false; reason: string };

/**
 * The shared unsafe-asset-path rule (all three loaders agree: LUT validate,
 * black-hole-merger, galaxy-collision). A manifest-controlled filename must
 * never escape its asset directory.
 */
export function isUnsafeAssetPath(file: string): boolean {
  return file.includes('..') || file.includes('\\') || file.startsWith('/');
}

/**
 * Resolve the `schwarzschild-v1` family directory from a parsed
 * `public/luts/index.json` document. Pure: no I/O, no filesystem.
 */
export function resolveLutFamilyFromIndex(index: unknown): LutIndexResolution {
  if (typeof index !== 'object' || index === null || Array.isArray(index)) {
    return { ok: false, reason: 'lut-index: document must be a JSON object' };
  }
  const familyDir = (index as Record<string, unknown>)['schwarzschild-v1'];
  if (familyDir === undefined || familyDir === null) {
    return { ok: false, reason: "lut-index: missing 'schwarzschild-v1' entry" };
  }
  if (typeof familyDir !== 'string' || familyDir.length === 0) {
    return { ok: false, reason: 'lut-index: family directory must be a non-empty string' };
  }
  if (isUnsafeAssetPath(familyDir) || familyDir.includes('/')) {
    return {
      ok: false,
      reason: `lut-index: unsafe family directory '${familyDir}'`
    };
  }
  return { ok: true, familyDir };
}
