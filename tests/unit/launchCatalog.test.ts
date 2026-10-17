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

import { existsSync, readdirSync } from 'node:fs';
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

async function collectDescriptorIds(): Promise<{
  ids: Map<string, string>;
  failures: string[];
}> {
  const ids = new Map<string, string>();
  const failures: string[] = [];
  const phenomenonDir = join(REPO_ROOT, 'src', 'phenomena');
  const destinationsDir = join(REPO_ROOT, 'src', 'atlas', 'destinations');

  const modules: string[] = [];
  for (const entry of readdirSync(phenomenonDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    // V-11: existence-gated discovery — a package without a presets file
    // (e.g. black-hole, whose descriptor lives in destinations/, or shared)
    // is simply not a descriptor package. Only files that EXIST are imported,
    // so an import failure of an existing file is a real failure and cannot
    // hide in the same catch as a missing file.
    const presetsPath = join(phenomenonDir, entry.name, 'presets.ts');
    if (existsSync(presetsPath)) {
      modules.push(`../../src/phenomena/${entry.name}/presets.js`);
    }
    // WS3 split destinations keep the descriptor in descriptor.ts (e.g.
    // neutron-star) with the heavy module importing it back.
    const descriptorPath = join(phenomenonDir, entry.name, 'descriptor.ts');
    if (existsSync(descriptorPath)) {
      modules.push(`../../src/phenomena/${entry.name}/descriptor.js`);
    }
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
      // unreadable package dir: the scan reports the directory itself below
      failures.push(`${entry.name}: package directory unreadable`);
    }
  }
  // The black-hole destination keeps its descriptor in destinations/.
  for (const entry of readdirSync(destinationsDir)) {
    if (!entry.endsWith('.ts')) continue;
    modules.push(`../../src/atlas/destinations/${entry.replace(/\.ts$/, '.js')}`);
  }

  for (const specifier of modules) {
    // V-11: import failures are COLLECTED, never swallowed — a partial
    // import must fail the gate, not quietly shrink the discovered set.
    try {
      const imported = (await import(specifier)) as DescriptorModule;
      const descriptor = findDescriptor(imported);
      if (descriptor !== null) ids.set(descriptor.id, specifier);
    } catch (error) {
      failures.push(`${specifier}: ${String(error).slice(0, 160)}`);
    }
  }
  return { ids, failures };
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

  // V-17 (docs/MASTER_PLAN.md): this row sequentially imports every
  // phenomenon presets/module and destination file, transitively loading the
  // 1 MB `three/webgpu` graph in one test. Measured 1.8 s standalone but
  // 5.0 s under full-suite parallel load, i.e. right on Vitest's 5000 ms
  // default — the audit recorded 2-of-3 full-suite failures from exactly this.
  // The timeout is declared proportionate to that work; no assertion, subject
  // or threshold is weakened. `verification-gate-integrity` (V-17) owns the
  // structural fix (splitting the heavy graph out of this row).
  it('every registered destination descriptor appears in the catalog', async () => {
    const { ids: descriptorIds, failures } = await collectDescriptorIds();
    // V-11: a swallowed import must not pass silently.
    expect(failures, 'every discovered module file must import cleanly').toEqual([]);

    // 7.6: completeness is derived from the AUTHORITATIVE registry in both
    // directions — no floor that a partial import could still satisfy.
    const catalogIds = new Set(LAUNCH_CATALOG.map((e) => e.id));
    catalogIds.add(DEBUG_DESTINATION_ID);
    const missing: string[] = [];
    for (const [id, file] of descriptorIds) {
      if (!catalogIds.has(id)) missing.push(`${id} (${file})`);
    }
    expect(missing, 'every discovered descriptor must be in the catalog').toEqual([]);
    const undiscovered = [...catalogIds].filter((id) => !descriptorIds.has(id));
    expect(
      undiscovered,
      'every catalog entry must be discoverable (incomplete discovery must fail)'
    ).toEqual([]);
    expect(descriptorIds.size, 'the discovered set must cover the catalog').toBeGreaterThanOrEqual(
      catalogIds.size
    );
  }, 30_000);
});
