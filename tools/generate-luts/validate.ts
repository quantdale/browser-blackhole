/**
 * LUT family validator CLI (M8-03, BH-162): loads a generated family
 * directory (manifest.json + assets), structurally validates the manifest
 * against the wire schema, and verifies every asset checksum against the
 * actual bytes on disk. Exit code 0 = valid; 1 = any rejection.
 *
 * Usage: npm run lut:validate -- public/luts/<family-dir>
 */

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  validateLutManifest,
  verifyAssetChecksum
} from '../../src/phenomena/black-hole/lut/validate.js';

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (dir === undefined || dir.length === 0) {
    console.error('[lut:validate] usage: lut:validate <public/luts/<family-dir>>');
    process.exitCode = 1;
    return;
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
  } catch (error) {
    console.error(`[lut:validate] cannot read manifest.json: ${String(error)}`);
    process.exitCode = 1;
    return;
  }

  const result = validateLutManifest(rawManifest);
  if (!result.ok) {
    console.error(`[lut:validate] REJECTED (${result.reason}): ${result.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log('[lut:validate] manifest structure OK');

  for (const texture of result.manifest.textures) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(path.join(dir, texture.file)));
    } catch (error) {
      console.error(`[lut:validate] missing asset ${texture.file}: ${String(error)}`);
      process.exitCode = 1;
      return;
    }
    if (bytes.byteLength !== texture.byteLength) {
      console.error(
        `[lut:validate] ${texture.file}: byteLength ${bytes.byteLength} != manifest ${texture.byteLength}`
      );
      process.exitCode = 1;
      return;
    }
    if (!(await verifyAssetChecksum(bytes, texture.sha256))) {
      console.error(`[lut:validate] ${texture.file}: SHA-256 MISMATCH`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `[lut:validate] ${texture.file}: ${bytes.byteLength} bytes, sha256 OK (${texture.format} ${texture.width}x${texture.height})`
    );
  }

  console.log(
    `[lut:validate] family '${result.manifest.family}' @ commit ${result.manifest.generatorCommit}: VALID`
  );
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) void main();
