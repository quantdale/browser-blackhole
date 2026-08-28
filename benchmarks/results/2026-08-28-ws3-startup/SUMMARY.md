# WS3 / tasks.md §5 — startup module-graph evidence

Campaign: `openspec/changes/whole-atlas-performance-optimization`
Recorded: 2026-08-28

## Environment

| Field | Value |
| --- | --- |
| OS | Windows 11 Pro 10.0.26200 |
| Node / npm | v24.3.0 / 11.4.2 |
| three | 0.185.1 |
| Vite / Playwright / TypeScript | 8.2.2 / 1.62.1 / 5.9.3 |
| Default browser project | Playwright Chromium (Desktop Chrome), headless, 1280x800 |
| Backend | **WebGPU**, adapter `intel gen-12lp`, `timestampQuery: true`, `storageBuffers: true`, `floatRenderTargets: true`, maxTextureSize 8192, DPR 1 |
| Governor at boot | tier `low`, renderScale 0.6 (integrated GPU) |
| Firefox project | Firefox headless, forced software WebGL2 (`gfx.webrender.software`) — WebGPU blocklisted |
| Server | `vite preview` production build on 127.0.0.1:4173 |

**Adapter caveat.** Every previously committed campaign benchmark number in
`docs/PERFORMANCE.md` / `docs/BENCHMARK_MATRIX.md` was recorded on an
`amd rdna-2` adapter. Numbers here are NOT comparable to those. Everything
below is a within-machine, within-session A/B of two commits, which is the
only comparison this hardware supports.

## What was measured

Bytes and requests are **network-observed** (Playwright `request` events plus
in-page `PerformanceResourceTiming`), not read off the bundler's chunk table.
That distinction matters: the defect being fixed was invisible in the chunk
table, because five `presets.ts` modules statically imported their own render
module and the implementation was fused INTO the metadata chunk.

Harness: `tests/browser/startup-graph.spec.ts` (committed).

## Result — JavaScript fetched to boot `/atlas/galaxy-collision`

| | Before (`c465a89`) | After (`4d41974`+) | Delta |
| --- | ---: | ---: | ---: |
| JS requests | 13 | 13 | 0 |
| Total decoded JS bytes | 1,448,619 | 1,320,931 | **−127,688 (−8.8%)** |
| of which shared (`three.webgpu` + `three.tsl`) | 1,043,021 | 1,043,021 | 0 |
| of which app shell (`index-*.js`) | 241,010 | 240,595 | −415 |
| **of which destination code** | **164,588** | **37,315** | **−127,273 (−77.3%)** |

The shared `three.webgpu` chunk (1,032,935 B decoded) dominates the total and
is unaffected by this workstream, so the destination-code row is the honest
measure of what WS3 changed.

Post-split destination code on that boot = 30,847 B of metadata for all nine
destinations + 6,468 B for galaxy-collision's own implementation. The request
count is unchanged because the same nine metadata modules are still fetched;
they are simply small now.

## Result — cross-destination isolation

Before: booting ANY route fetched EVERY destination's implementation.
Recorded failure output for `/atlas/black-hole` (identical for all eight):

```
index-1zweC6G0.js, three.webgpu-DmEoyhoa.js, three.tsl-CMI6CHrk.js,
diagnosticDestination-DKMQi8p0.js, blackHoleDestination-BAGPEgfB.js,
neutronStarModule-BYFpLRrb.js, presets-Dh2sORyr.js, presets-BUSw2g8o.js,
presets-Cb-0KKu5.js, presets-D6eo6oQ2.js, presets-C6-yQ54S.js,
presets-COVyQgNf.js
```

After: 8/8 routes fetch their own implementation and no other destination's.

## Regression found and fixed during this workstream

Moving the implementation import out of registry setup and into the arrival
transition introduced a Firefox-only console error on reload:

```
[CosmicAtlasHost] transition error: Preparation of 'black-hole' failed:
error loading dynamically imported module: .../blackHoleDestination-*.js
```

Bisect: 12/12 pass at `c465a89` (pre-split), 3/3 fail after. Network probe
showed the chunk returning HTTP 200 and the module load still failing ~266 ms
later, with the next load's request ending `NS_BINDING_ABORTED` — i.e. the
engine cancelling its own in-flight module load as the navigation starts.
Reporting that as a preparation failure is untrue, and it only became
reachable because the fetch now happens during the transition instead of at
boot.

Fix: `CosmicAtlasHost.abandonPendingTransition()`, called from `beforeunload`
(which fires at navigation start, ahead of the abort) and `pagehide`
(`persisted === false` only, so bfcache restores are untouched). It cancels
the in-flight prepare and silences transition-error REPORTING for the rest of
that document's life. Verified 12/12 Firefox.

A genuine chunk failure is deliberately NOT silenced — pinned by
`startup-graph.spec.ts` "a genuine implementation-chunk failure is still
reported truthfully", which aborts the chunk request while the page stays put
and asserts the host still says `Preparation of 'black-hole' failed`.

## Not claimed here

- No first-interactive / registry-init timing claim. This machine's browser
  timing was unstable enough in a prior session to be recorded as unreliable;
  byte counts and request identity are deterministic, timings are not.
- No comparison against the `amd rdna-2` numbers in the committed docs.
- Idle prefetch (tasks.md §5, optional) was not attempted.
