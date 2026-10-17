/**
 * Shared shipped-LUT family resolution for unit tests (verification-gate-
 * integrity task 5.7). The old per-test `findShippedFamilyDir()` scanned
 * `public/luts/` with `readdirSync` and returned the first directory holding
 * a manifest — readdir ORDER dependent (V-14) and a DIFFERENT code path from
 * the product's `index.json` resolution (V-04). Both tests now resolve the
 * family exactly the way the product does: through `resolveLutFamilyFromIndex`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveLutFamilyFromIndex } from '../../../src/phenomena/black-hole/lut/discovery.js';

export function shippedLutRoot(): string {
  return join(process.cwd(), 'public', 'luts');
}

export function shippedFamilyDir(): string {
  const index: unknown = JSON.parse(readFileSync(join(shippedLutRoot(), 'index.json'), 'utf8'));
  const resolution = resolveLutFamilyFromIndex(index);
  if (!resolution.ok) {
    throw new Error(`shipped LUT index does not resolve: ${resolution.reason}`);
  }
  return join(shippedLutRoot(), resolution.familyDir);
}
