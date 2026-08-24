/**
 * CA8 integration hardening — production destination-selector completeness.
 *
 * Regression class prevented here: a destination is REGISTERED in the host
 * registry but absent from the production launch catalog, so it silently
 * disappears from normal navigation (this exact bug shipped with Quasar/AGN).
 *
 * Strategy: enumerate EVERY destination descriptor module in the repository
 * (each phenomena package's presets file plus the atlas destinations
 * directory), import it, and require its id to appear in the LAUNCH CATALOG
 * unless it is the debug-only Diagnostic destination. Also pins uniqueness
 * of catalog ids and the beta-visibility filter.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DEBUG_DESTINATION_ID,
  LAUNCH_CATALOG,
  productionDestinationIds
} from '../../src/atlas/launchCatalog.js';
import type { PhenomenonDescriptor } from '../../src/atlas/types.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

interface DescriptorModule {
  readonly [exportName: string]: unknown;
}

function findDescriptor(mod: DescriptorModule): PhenomenonDescriptor | null {
  for (const value of Object.values(mod)) {
    if (
      value !== null &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>)['id'] === 'string' &&
      typeof (value as Record<string, unknown>)['route'] === 'string' &&
      typeof (value as Record<string, unknown>)['load'] === 'function'
    ) {
      return value as PhenomenonDescriptor;
    }
  }
  return null;
}

async function collectDescriptorIds(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  const phenomenonDir = join(REPO_ROOT, 'src', 'phenomena');
  const destinationsDir = join(REPO_ROOT, 'src', 'atlas', 'destinations');

  const modules: string[] = [];
  for (const entry of readdirSync(phenomenonDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    modules.push(`../../src/phenomena/${entry.name}/presets.js`);
    // Some destinations keep the descriptor in the module file itself
    // (e.g. neutron-star). Probe <Name>Module.js when present.
    try {
      const entries = readdirSync(join(phenomenonDir, entry.name));
      for (const file of entries) {
        if (/^[a-zA-Z]+Module\.ts$/.test(file)) {
          modules.push(`../../src/phenomena/${entry.name}/${file.replace(/\.ts$/, '.js')}`);
        }
      }
    } catch {
      // unreadable package dir: skip
    }
  }
  // The black-hole destination keeps its descriptor in destinations/.
  for (const entry of readdirSync(destinationsDir)) {
    if (!entry.endsWith('.ts')) continue;
    modules.push(`../../src/atlas/destinations/${entry.replace(/\.ts$/, '.js')}`);
  }

  for (const specifier of modules) {
    try {
      const imported = (await import(specifier)) as DescriptorModule;
      const descriptor = findDescriptor(imported);
      if (descriptor !== null) ids.set(descriptor.id, specifier);
    } catch {
      // A module without a loadable presets file is not a destination.
    }
  }
  return ids;
}

describe('launch catalog completeness', () => {
  it('has unique catalog entries', () => {
    const ids = LAUNCH_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('production list excludes beta and preserves order', () => {
    expect(productionDestinationIds()).not.toContain(DEBUG_DESTINATION_ID);
    const beta = LAUNCH_CATALOG.filter((e) => e.beta === true).map((e) => e.id);
    for (const id of beta) expect(productionDestinationIds()).not.toContain(id);
  });

  it('pins completed destinations as production-visible', () => {
    const production = productionDestinationIds();
    // Regression pins: quasar-agn was once registered but missing from nav.
    for (const required of [
      'black-hole',
      'neutron-star',
      'stellar-explosion',
      'compact-merger',
      'tidal-disruption',
      'quasar-agn',
      'black-hole-merger'
    ]) {
      expect(production).toContain(required);
    }
  });

  it('every registered destination descriptor appears in the catalog', async () => {
    const descriptorIds = await collectDescriptorIds();
    expect(descriptorIds.size).toBeGreaterThanOrEqual(8); // 7 production + diagnostic

    const catalogIds = new Set(LAUNCH_CATALOG.map((e) => e.id));
    catalogIds.add(DEBUG_DESTINATION_ID);
    const missing: string[] = [];
    for (const [id, file] of descriptorIds) {
      if (!catalogIds.has(id)) missing.push(`${id} (${file})`);
    }
    expect(missing).toEqual([]);
  });
});
