/**
 * Unit tests for the route/share preset-key agreement (U-15).
 *
 * `serializeForUrl` writes the compact share key `p`; `parseRoute` canonically
 * reads `?preset=` (buildRoute's key). The two used to mismatch, so a
 * serialised preset was unreadable by the route layer. Both parsers now
 * accept both keys; these rows pin the alias in each direction.
 */

import { describe, expect, it } from 'vitest';

import {
  parseFromUrl,
  serializeForUrl,
  createDefaultAtlasState
} from '../../src/atlas/atlasState.js';
import { buildRoute, parseRoute } from '../../src/atlas/routes.js';

describe('preset key agreement (U-15)', () => {
  it('parseRoute reads the compact share key `p`', () => {
    const parsed = parseRoute('/atlas/black-hole', '?v=1&d=black-hole&p=cinematic-orbit');
    expect(parsed.destination).toBe('black-hole');
    expect(parsed.preset).toBe('cinematic-orbit');
  });

  it('parseRoute still prefers the canonical `preset` key when both are present', () => {
    const parsed = parseRoute('/atlas/black-hole', '?preset=canonical&p=alias');
    expect(parsed.preset).toBe('canonical');
  });

  it('parseFromUrl reads the route key `preset` as an alias', () => {
    const parsed = parseFromUrl('v=1&d=black-hole&preset=cinematic-orbit');
    expect(parsed.atlas?.activePreset).toBe('cinematic-orbit');
  });

  it('a serialised share string is readable by the route parser', () => {
    const state = createDefaultAtlasState('black-hole');
    state.atlas.activePreset = 'face-on-disk';
    const serialized = serializeForUrl(state);
    expect(serialized).toContain('p=face-on-disk');
    const route = parseRoute(`/atlas/${state.atlas.activeDestination}`, `?${serialized}`);
    expect(route.destination).toBe('black-hole');
    expect(route.preset).toBe('face-on-disk');
  });

  it('buildRoute output round-trips through both parsers', () => {
    const url = buildRoute('neutron-star', 'pulsar');
    const route = parseRoute('/atlas/neutron-star', '?preset=pulsar');
    expect(url).toContain('preset=pulsar');
    expect(route.preset).toBe('pulsar');
    const share = parseFromUrl('?preset=pulsar');
    expect(share.atlas?.activePreset).toBe('pulsar');
  });

  it('a dc= payload is keyed to the route destination when d= is absent (U-06)', () => {
    // Hand-written deep link: /atlas/compact-merger?dc=… names the
    // destination in the ROUTE; without the option the payload was keyed to
    // the default destination and never applied.
    const dc = encodeURIComponent(JSON.stringify({ viewingAngleDeg: 33 }));
    const withOption = parseFromUrl(`?dc=${dc}`, { defaultDestination: 'compact-merger' });
    expect(Object.keys(withOption.destinations ?? {})).toEqual(['compact-merger']);
    expect(withOption.destinations?.['compact-merger']?.state['viewingAngleDeg']).toBe(33);

    // Explicit d= still wins over the fallback.
    const withD = parseFromUrl(`?d=tidal-disruption&dc=${dc}`, {
      defaultDestination: 'compact-merger'
    });
    expect(Object.keys(withD.destinations ?? {})).toEqual(['tidal-disruption']);

    // No option: the documented default keys the payload (unchanged).
    const legacy = parseFromUrl(`?dc=${dc}`);
    expect(Object.keys(legacy.destinations ?? {})).toEqual(['black-hole']);
  });
});
