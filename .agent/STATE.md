# ACTIVE CAMPAIGN OVERRIDE — 2026-08-28

The repository remains production-certified for the pre-optimization product baseline, but a new active hardening campaign is now selected:

`openspec/changes/whole-atlas-performance-optimization/`

Canonical fast audit: `docs/NEXT_CAMPAIGN_AUDIT_2026-08-28.md`.
Canonical execution instructions: `.agent/START_HERE.md` → `.agent/EXECUTION_PROMPT.md` → active OpenSpec `EXECUTION_PROMPT.md`.

Do not interpret older "no active campaign" / "certified production-ready" historical lines below as meaning there is no current work. They remain historical release evidence; the active performance-hardening checklist is currently unexecuted.

## 2026-08-28 session — WS1 failures root-caused; WS3/§5 startup splitting landed

Backend note first, because it changes what this machine can certify: headless
Playwright Chromium here now reports **hardware WebGPU** —
`debugInventory().backend = { api: 'webgpu', adapterName: 'intel gen-12lp',
timestampQuery: true, storageBuffers: true, floatRenderTargets: true }`. The
previous session's "no WebGPU adapter / WebGL2 fallback everywhere" finding
did not reproduce. GPU timestamp queries ARE available. The adapter is still
NOT the `amd rdna-2` one every committed benchmark number was recorded on, so
absolute cross-machine comparisons remain invalid; within-session A/B is fine.

### The three "unresolved" WS1/WS3 items were test defects, not regressions

All three were root-caused with direct measurement, not re-runs.

1. **`black-hole-merger.spec.ts` "data-derived phases appear in order while
   scrubbing" missing the final `remnant`.** Bisect: 4/5 FAIL at `acdd8e6^`
   (pre-WS1), 1/3 at the WS1 tip — so WS1 did not cause it and it is not new.
   An in-page probe caught the mechanism: the spec's fixed 250 ms sleeps were
   treated as postconditions, but entering `ringdown` makes the Kerr remnant
   subgraph visible for the FIRST time and that pipeline compile stalls the
   frame loop past the sleep. The probe recorded the destination's `timeM`
   frozen at the 0.68 value across both the 0.75 and 0.95 scrubs while the
   host's `physicalTime` was already correct — the final scrub was read before
   it had ever been applied.
2. **`frame-invalidation.spec.ts` idle/resize/visibilitychange one-offs.**
   Mirror image of the same mistake: the idle windows were wall-clock. Under
   parallel-worker load this host's rAF cadence itself drops below a 300 ms
   window, so "no orchestrated frames in 300 ms" was satisfiable while the
   loop simply had no opportunity to render. The previously unexplained
   "failed once in isolation then passed 5/5" visibility result is this.
3. The `pauseAndSettle` helper settled on a camera-displacement heuristic
   looser than `CameraRig`'s own dirty criterion, so it reported "settled"
   while the ease still had frames to issue.

Fixes (`c465a89`, tests only): `readDestinationTime` /
`awaitDestinationTimeApplied` / `scrubAndAwaitDestination` in
`tests/browser/support/appHarness.ts` wait until the ACTIVE DESTINATION has
consumed the coordinate; `frame-invalidation.spec.ts` counts rAF ticks
(`waitForAnimationFrames`) and settles on real render quiescence (20 quiet
ticks on the independent `kernel.renderFrame` counter), failing loudly if a
paused untouched scene never goes quiet. Evidence: phase sweep 6/6; the three
affected specs 30/30 at `--workers=4`; frame-invalidation 21/21 at
`--workers=4 --repeat-each=3`.

**Standing rule for this repo's browser suites:** never treat a fixed sleep as
a postcondition, and never measure "the loop stayed idle" in milliseconds.

### WS3 / tasks.md §5 — startup module graph (landed, measured)

§5 asked to split black-hole + neutron-star and *verify* the other
descriptors were already lightweight. **The verification failed.** Only
galaxy-collision was: five more `presets.ts` modules statically imported
their own render module to build a one-line factory wrapper, so registry
setup pulled EVERY destination's implementation into EVERY boot. The scope
was therefore two modules as planned plus six more that the verify step
found — deliberate, not scope creep.

Landed: `src/atlas/destinations/blackHoleDescriptor.ts` and
`src/phenomena/neutron-star/descriptor.ts` (data only); all eight `load`
thunks are now real dynamic imports; dead factory wrappers removed; both
implementation modules import their descriptor back (static edge in that
direction only, no cycle).

Measured, network-observed (NOT from the bundler chunk table — the fusion was
invisible there), `c465a89` -> split tip, same machine/session:

| | Before | After | Delta |
| --- | ---: | ---: | ---: |
| Destination code in a boot graph | 164,588 B | 37,315 B | **-77.3%** |
| Total boot JS (decoded) | 1,448,619 B | 1,320,931 B | -8.8% |
| Routes fetching a foreign implementation | 8 of 8 | 0 of 8 | — |

Full artifact: `benchmarks/results/2026-08-28-ws3-startup/SUMMARY.md`.
Harness: `tests/browser/startup-graph.spec.ts` (committed).
`Compare registry-init and first-interactive timing` stays
DEFERRED_ENVIRONMENT: byte counts are deterministic here, browser timing is
not.

### Regression introduced by that split, found and fixed

Moving the implementation import into the arrival transition made a
Firefox-only console error reachable on reload: `Preparation of 'black-hole'
failed: error loading dynamically imported module`. Bisect 12/12 pass
pre-split, 3/3 fail after — genuinely ours. A network probe showed the chunk
returning HTTP 200 with the module load still failing ~266 ms later, and the
next load's request ending `NS_BINDING_ABORTED`: the engine cancelling its
own in-flight module load as the navigation starts. Calling that a
preparation failure is untrue.

Fix: `CosmicAtlasHost.abandonPendingTransition()` invoked from `beforeunload`
(fires at navigation start, ahead of the abort — `pagehide` alone loses the
race) and from `pagehide` with `persisted === false` only, so bfcache
restores are untouched. It cancels the in-flight prepare and suppresses
transition-error REPORTING for the remainder of that document's life.
Verified 12/12 Firefox.

The guard must NOT latch. `beforeunload` fires when a navigation starts, not
when it commits, so a page can fire it and then survive (cancelled
navigation, a link that resolves to a download). A latched flag would silence
every later transition error — fatal ones included — while the director still
drove the UI error path: an error visible on screen and absent from the
console. `requestTransition()` therefore clears it, and
`startup-graph.spec.ts` "a page that fires beforeunload and then stays still
reports failures" pins it (verified to FAIL without the clear and pass with).

bfcache, measured rather than assumed: with and without the `beforeunload`
listener, headless Firefox and Chromium both reported
`pageshow.persisted === false` on a back-navigation. This app is already
bfcache-ineligible in that environment (it holds a live GPU context), so the
listener is not the deciding factor here. Real-browser eligibility is
UNVERIFIED and is recorded as such rather than claimed either way.

**New failure mode this workstream creates, and how it is contained:** a
destination chunk can now be missing (stale deploy) or unreachable (offline)
at navigation time, which was impossible when every implementation was
fetched at boot. That case is deliberately NOT silenced and is pinned by
`startup-graph.spec.ts` "a genuine implementation-chunk failure is still
reported truthfully".

### Benchmark harnesses were silently measuring nothing (found and fixed)

WS1 landed in `acdd8e6`; the nine `scripts/bench-*.mjs` harnesses landed in
`b320a6d`, BEFORE it, and nothing reconciled them. Every harness pauses the
timeline and then samples rAF deltas — which, after WS1, is a scene that
legitimately renders nothing. So the §0 baseline that every later
percentage claim was going to rest on would have been measuring an idle
loop.

This is demonstrated, not argued. With the fix removed, `bench-galaxy-
collision` reports `framesRendered: 0`, `framesSkipped: 601`,
`destinationDrawn: false` — and still prints `medianMs: 6.1`, the SAME value
as the correct run. A reader could not have distinguished the two records.

Fixed two ways:

1. Each harness pins `host.forceContinuousRenderForTest(true)` alongside its
   `time.pause()` — the escape hatch WS1 added for exactly this.
2. Record `schemaVersion` bumped to 2 with a `renderTelemetry` block
   (framesObserved / framesRendered / framesSkipped / lastFrameWork) for the
   sampled window, and the harness exits non-zero with an explicit refusal
   message when `framesRendered === 0`. A broken harness can no longer emit a
   plausible millisecond number quietly.

Verified: `bench-galaxy-collision` now reports 601/601 frames rendered, all
stage flags true, with real GPU timestamps (`frameGpuMs.lastResolvedFrame`
1.38 ms — timestamp queries work on this adapter).

**Methodological consequence worth carrying into §0:** `medianMs` was 6.1 ms
whether or not anything rendered, i.e. the CPU rAF delta is dominated by
frame scheduling rather than render cost on this host. Lead the baseline
with GPU timestamps and the machine-independent COUNTS (`renderTelemetry`,
`renderer.info`, ResourceManager totals), and treat rAF deltas as the weakest
evidence in the record rather than the headline.

### Known intermittent full-suite failure (diagnosed, NOT fixed, NOT hidden)

`accessibility.spec.ts` failed once in each of the last two full-suite runs at
`--workers=2`, on two DIFFERENT tests ("focus lands on a real element after a
destination switch", then "keyboard flow: nav -> mode switch -> controls ->
observer select", the latter timing out with `activeDestination` still on the
previous destination). Both failures are keyboard-driven destination
switching.

Mechanism, measured directly rather than inferred: the shell's 4 Hz UI
reflection tick rebuilds the nav and control panel once per completed
arrival, and it notices the arrival up to a full tick LATE. A probe that
watched the "Neutron Star" chip's element identity after an arrival poll
returned found the node REPLACED at 106 ms, 106 ms and 165 ms across three
runs, then stable. A test that focuses a chip inside that window has its
focused node swapped out, so the subsequent `keyboard.press('Enter')` lands
on a detached element and silently does nothing. The arrival poll's 250 ms
interval usually hides this, which is why it is rare.

The rebuild-after-arrival behaviour is pre-existing M11 code, not from this
session. Whether this session's work made the race likelier is genuinely
unresolved: it appeared in the two most recent full runs and not the two
before, which is n=2 versus n=2, and the WS3 chunk fetch does shift arrival
timing slightly.

**A fix was attempted and REJECTED on evidence rather than shipped.** Adding
a `waitForNavSettled` postcondition (wait for the chip element identity to
survive a quiet window) scored 39/40 under `--workers=6 --repeat-each=10`
while the UNCHANGED spec scored 40/40 in the same configuration — i.e. no
demonstrated improvement, so shipping it would have been a speculative
change dressed as a fix. The helper was removed rather than left as dead
code. Note that isolated repeat-stress does not reproduce the failure at all;
only the mixed full-suite workload does, so the next attempt needs a
reproduction harness that mixes specs, not one that repeats a single file.

### Still open

§0 baseline and §1 telemetry remain unexecuted and are still the declared
prerequisite for §6-§21. With WebGPU + `timestampQuery` available here, §0 is
now genuinely attemptable on this machine for the first time — with the
adapter caveat recorded in the SUMMARY above.

---

## 2026-08-28 session — repository branch consolidation

- Fetched and pruned `origin`, then audited every local and remote branch.
- Preserved the useful repository-local add-ons work: the planning document
  from `plan/repo-local-addons-2026-08-28` and the implementation from
  `feat/repo-local-addons`. Both are now on `main`; the plan and handoff docs
  were reconciled to record `main` as the landing branch.
- The stale local `research/cosmic-atlas-phenomena` branch had no commits
  absent from `main` and contained no additional work to preserve.
- Validation at the integrated tip: `npm run check` passed (format, lint,
  typecheck, 531 unit tests, and production build); MCP static and online
  preflight both passed, including registry resolution for the two pinned
  packages.
- Pushed `main` to `origin` at `0c8266e`, deleted the remote planning branch,
  and deleted both redundant local branches. Before this state record,
  `git status --short --branch` was clean, local `main` matched `origin/main`,
  and `git ls-remote --heads origin` listed only `main`.

Next action: continue the active whole-atlas performance-hardening campaign
from the synchronized `main` branch; no branch-specific work remains pending.

---

## 2026-08-28 session — WS1 (frame invalidation) + partial WS3 (visibility) implemented, NOT certified

Scope note: a research-scoped subagent (asked to map the frame-loop
architecture only) implemented production code beyond its instructions —
disclosed here for full transparency, not hidden. The code itself was
independently reviewed (diff read in full) and is reasonably well-designed;
the concern is process (no checkpoint before landing), not quality.

**What changed (uncommitted at end of session unless a follow-up session
committed it — check `git log`/`git status` before assuming either way):**

- `src/atlas/types.ts`: `INVALIDATION_REASON` bitset (TIME_ADVANCED,
  CAMERA_CHANGED, CONTROL_CHANGED, DESTINATION_CHANGED, RESIZE,
  QUALITY_CHANGED, TRANSITION_CHANGED, POST_CHANGED, DEBUG_CHANGED,
  FORCED_CAPTURE) + `ICameraRig.update()` now returns `boolean`.
- `src/atlas/TimeController.ts`: sticky `consumeDirty()` flag, set whenever
  `internalTime` actually moves (scrub/update/reset), survives a scrub that
  happens between two `frame()` ticks.
- `src/renderer/shared/CameraRig.ts`: `update()` returns whether it changed
  the camera transform this tick.
- `src/atlas/host.ts`: `CosmicAtlasHost.frame()` accumulates a reason mask
  each tick (time/camera/control/resize/quality/transition/post/debug) plus
  `!time.paused` as an unconditional render trigger (several destinations key
  continuous integration to playing-vs-paused, not to the mapped UI phase
  moving); skips `destination.update()`/`render()`/`kernel.renderFrame()`
  when the mask is empty AND the timeline is paused. New public API:
  `invalidate(reason)`, `forceContinuousRenderForTest(enabled)`,
  `lastFrameRendered` getter. `frame(dt, {force:true})` is the new
  `forceFrame`-equivalent escape hatch (used by `captureFrame()` and the
  visibility-resume nudge). `TransitionDirector.ts` was NOT touched — WS2
  (transition occlusion) is still fully unimplemented.
- `src/app/atlasApp.ts`: `visibilitychange` listener (WS3, partial) — on
  resume (`!document.hidden`), resets the frame-loop's `lastMs` baseline and
  calls `host.invalidate(FORCED_CAPTURE)` as a one-shot wake. "Stop
  nonessential polling while hidden" and explicit documented hidden-time
  semantics (tasks.md §3) were NOT done.
- New tests: `tests/browser/frame-invalidation.spec.ts` (7 browser tests),
  `tests/unit/timeController.test.ts` (10 tests), `tests/unit/cameraRig.test.ts`
  (6 tests) — all 16 new unit tests pass; `npm run typecheck`/`lint`/
  `format:check`/`build` all clean on the full tree.
- Separately (correctly scoped, general-purpose subagent): all 9
  `scripts/bench-*.mjs` harnesses gained `--force-backend=webgpu|webgl2`
  (wired to the existing `?backend=` URL override) and real
  `flushGpuTimestamps()` GPU-timestamp capture where missing. Format/lint
  clean, smoke-tested. This part is clean and safe to treat as complete
  independent of the WS1/WS3 status below.

**Why this is NOT certified — environment, not (only) code:**

This session's machine has no WebGPU adapter reachable from headless
Playwright Chromium (`No available adapters`; confirmed by direct probe) —
every browser run here is WebGL2 fallback, unlike the `amd rdna-2` hardware-
WebGPU machine all prior campaign numbers were recorded on. Timing here is
also unstable independent of backend: the same route arrived in ~5s in one
Playwright run and never arrived in 120s in a hand-rolled probe against the
identical build; unrelated pure-CPU vitest tests timed out purely from
concurrent load with a browser suite. Full detail: project memory
`local-env-no-webgpu` / `whole-atlas-perf-campaign`.

**Known suspected regression (NOT dismissed as flakiness):**
`tests/browser/black-hole-merger.spec.ts` "data-derived phases appear in
order while scrubbing" failed 2 of 3 direct observations (original 10-worker
run + an isolated `--workers=3` rerun; passed once at `--workers=1` per the
implementing subagent), always missing the LAST expected phase (`remnant`).
The `compact-merger.spec.ts` analog missed `merger` once. Code review of
`blackHoleMergerModule.ts`'s `update()` shows the phase readout is purely
`phaseAt(clampedT, ds)` — a pure function of current time, not an
accumulator — so skipping `update()` on idle frames should not lose state;
the actual mechanism causing the last-phase miss is UNKNOWN. Do not mark
tasks.md §2 done, and do not assume this is fixed, until root-caused on a
capable-hardware runner.

**Also unresolved (no clear evidence either way):** `frame-invalidation.
spec.ts` "resize wakes exactly the frames needed" and "a paused, settled
scene issues zero further orchestrated frames" (both failed once in the
original full run, passed on every isolated rerun); `resource-leak.spec.ts`
"repeated cross-destination cycles return to the resource baseline" (60s
timeout stuck on `transitioning` in the original run, passed once isolated).
4 Firefox failures in the original run are CONFIRMED pure environment
(`Executable doesn't exist at ...firefox-1538\firefox\firefox.exe` — a local
Playwright browser-install version gap, fix with `npx playwright install
firefox`), not a regression.

**Next steps for whoever picks this up:** root-cause the black-hole-merger
last-phase miss first (it's the only failure with a consistent, non-random
pattern); then do §0/§1 (baseline + telemetry) retroactively against this
already-landed §2/§3 code on a capable-hardware (real WebGPU) runner before
claiming any of tasks.md §2/§3 checkboxes; §4 onward (startup splitting,
black-hole active-pass lifecycle, Schwarzschild/Kerr optimization,
destination-specific work, final certification) has not been started.

---

# Durable project state

Last update: 2026-08-27 — **FINAL PRODUCTION-READINESS CERTIFIED** (`openspec/changes/final-production-readiness`)
+ a standalone post-certification perf fix (LUT backend-conditional load, below).
(OpenSpec campaign order: M12-NS → M12-RI → CA9 → final-production-readiness.)

## Current phase

**Certified production-ready.** All prior campaign work (M12-NS, M12-RI, CA9)
plus a final certification pass are closed and pushed. The repository hosts
eight production destinations. See `docs/RELEASE_CERTIFICATION.md` for the
full evidence report and the closure record below for what changed in this
pass.

### Post-certification perf fix — LUT backend-conditional load (2026-08-27)

Requested scope: "optimize the entire thing." The repository is certified
and its own rules block reopening prior optimization decisions without new
evidence (`docs/PERFORMANCE_BUDGETS.md` §20 stop rule; the named M11-rejected
list). A repo sweep (fresh `npm run build` bundle check, `docs/BACKLOG.md`,
`.agent/STATE.md` Next Actions) found no bundle/frame-time regression and no
open item except one explicitly pre-approved, never-rejected footnote in
`docs/LUT_BACKEND_ADR.md` §12: the Schwarzschild LUT family (~2.1 MiB GPU
textures + 3 network fetches) loaded unconditionally in
`BlackHoleModule.prepare()` even when the selected backend could never use
it. User confirmed this narrow, scoped item over a full re-open. Fixed: the
load is now skipped when `metric === 'kerr'` (LUT is architecturally
inapplicable to Kerr, ADR §1.21) or an explicit `?trajectory=numerical`
override is pinned (wins all precedence for the page lifetime, M8-09); the
Kerr `render()` path now reports `lut-inapplicable-while-kerr-active`
unconditionally so the COMPATIBILITY_MATRIX.md "locked" contract stays
truthful regardless of whether the family object happens to be loaded. Full
detail/evidence: `docs/LUT_BACKEND_ADR.md` §12. Gates: `npm run check` PASS
(515/515 unit, build); `trajectory-backend.spec.ts`/`kerr-integration.spec.ts`/
`observer-modes.spec.ts`/`integrator-parity.spec.ts`/`ray-parity.spec.ts`/
`resource-leak.spec.ts`/`smoke.spec.ts` PASS; visual goldens 43/43
twice-stable (zero pixel drift, expected — load-order-only change). Verified
directly with a network-request probe (0 `/luts/*` requests on a Kerr preset
and on `?trajectory=numerical`; unchanged 4 requests on the default
Schwarzschild preset).

### final-production-readiness closure record (2026-08-27)

The prior "campaign complete" state was written while hosted `main` CI was red
on every push — a real repository/CI/release-state disagreement. This pass
found and fixed the root cause with local measurement (not assumption), then
re-verified every hard gate independently.

- **CI root cause (F-01/F-01a/F-01b):** hosted CI ran the FULL GPU/TSL browser
  suite (`npx playwright test`, all projects) on GPU-less runners. Firefox was
  never installed (F-01a: instant launch failures). The `default` Chromium
  project starved under 2 workers on software WebGL2 and, even after
  `workers=1` + a 180s arrival ceiling, hosted runner speed variance was too
  severe for a stable gate (a black-hole arrival measured 18s in one hosted
  run, >180s in another) — investigation showed heavy shader compile + the
  hyperspace transition under software WebGL2 has no fixed timeout that
  survives that variance.
- **Resolution (owner-approved architecture change):** hosted CI now runs only
  `quality` (format/lint/typecheck/unit/build) + `browser-smoke` (the cheap,
  backend-agnostic M0 smoke: boot to ready/fallback/unsupported, forced-WebGL2
  diagnostic render, safe interaction/resize — the root route renders the
  cheap diagnostic gradient, never the heavy lensing/Kerr passes). The full
  behavioral+parity suite, the 43 visual goldens (hardware-WebGPU baselines),
  and the Firefox second-engine matrix (headless Firefox has no GL context on
  a GPU-less host) are now a DOCUMENTED local capable-runner gate
  (`docs/CI_CD.md` §2/§16) — explicit environment routing with recorded
  evidence, not silent coverage reduction. They already pass there: 131/131
  non-golden browser tests, 43/43 goldens twice-stable, 4/4 Firefox.
- **F-03 cross-platform `npm run check`:** `.gitattributes` (`* text=auto
  eol=lf`) fixes a Windows-checkout CRLF/Prettier mismatch invisible to Linux
  CI; one-time renormalize touched only 4 already-JSON-parsed data files
  (whitespace-only, verified).
- **F-05:** corrected a stale "TEMPORARY placeholder... lands with CA4"
  docstring in `stellar-explosion/presets.ts` (CA4 rendering has long landed).
- **Evidence:** `npm run check` local pass (515/515 unit, lint/typecheck/build
  clean); full non-golden Playwright suite 131/131; goldens 43/43 twice-stable;
  `npm audit` 0 vulnerabilities; hosted CI green — see
  `docs/RELEASE_CERTIFICATION.md` for the consecutive-green-run list.
- **Defect ledger:** `openspec/changes/final-production-readiness/ledger.md` —
  P0=0, P1=0 at closure.
- **Known limitation (documented, not a defect):** hosted CI cannot run the
  GPU-heavy suite (no GPU on hosted runners); it is a local capable-runner gate
  by design, matching the repository's own pre-existing CI philosophy
  (`docs/CI_CD.md` §16, historical note about local-runner golden/parity
  evidence).


### CA9 closure record (2026-08-27)

Galaxy Collision — DATA_DRIVEN reduced restricted-three-body reconstruction
from Toomre & Toomre (1972) via NASA GISS/NTRS source-lock.

- **Source-lock (CA9-03):** GISS `to03000u.pdf` (image-only scan, not committed)
  + NTRS 19730032576, DOI 10.1086/151823; model facts source-locked (parabolic,
  two galaxies, test-particle disks, no self-gravity/gas); numeric scenario is
  a repository-derived default within that framework (equal-mass 1:1, q=4,
  60° inclination, window -50..70, 800 tracers/galaxy, 241 keyframes dtK=0.5)
  disclosed as `source-locked-framework-repository-scenario` in
  `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION_SOURCE_LOCK.md`.
- **Offline pipeline (CA9-04..05):** `restricted_three_body.py` now has a
  fail-closed production path (`--emit-artifact`) requiring source-locked
  status; exercise config remains placeholder and cannot produce a runtime
  artifact. The committed GC1 binary (`public/data/galaxy-collision/gc1.bin`
  ~4.6 MB float32, magic GCL1 schema 1, sha256 92d446c61e807e3090ee497820bf1d6915bee1beb080e2d4954bedf7564b0da2 + manifest)
  was generated deterministically from PROD_* constants; re-emit yields identical
  sha256. `DATA_PIPELINE.md` generation command + schema recorded.
- **Runtime (CA9-06..07):** `src/phenomena/galaxy-collision/` dataset
  (decodeGc1, interpolateTracers/Centers, phaseToModelTime) + loader
  (manifest shape, byte-length, SHA-256 fail-closed) +
  `galaxyCollisionModule.ts` (Points via BufferGeometry/PointsNodeMaterial,
  atlas lifecycle, deterministic timeline phase handling, debug probe). Presets
  `encounter`/`bridge-tail`/`post-encounter` (0.0/0.5/0.9). Registered in
  `host.ts` + `launchCatalog.ts` (eight production destinations).
- **Validation (CA9-08):** `tests/unit/galaxyCollisionInterp.test.ts` 11/11
  (decode counts/times, manifest sha, exact-keyframe + midpoint lerp, clamp,
  fail-closed bad-magic/schema/byte-length); `tests/browser/galaxy-collision.spec.ts`
  5/5 (boot, scrub-driven motion, determinism, WebGL2 fallback, leave/re-enter).
  Goldens `GC_ENCOUNTER`/`GC_BRIDGE_TAIL`/`GC_POST_ENCOUNTER` added to
  `goldenHarness.ts` and generated via UPDATE_GOLDENS=1; full golden suite
  43/43 twice-stable on E2E_PORT=4219.
- **Perf (CA9-09):** `scripts/bench-galaxy-collision.mjs` + `bench:galaxy-collision`;
  smoke run bridge-tail phase 0.5 low: median 7 ms (60 frames, 576x480 internal,
  webgpu amd rdna-2, 0 console errors). Same schema as other destinations;
  resource-scoped geometry/material, bounded reuse.

### M12-RI closure record (2026-08-26)

Repository integrity / evidence hardening (audit F-01..F-10). Concrete remediations:

- **Dependency pin (F-05):** `tsx` caret `^4.23.12` → exact `4.23.12` in package.json
  (lock-resolved 4.23.12); `docs/DEPENDENCIES.md` now lists `tsx` and notes the
  historical caret correction. `npm ci` clean (144 pkgs, 0 vuln), `npm ls tsx` → 4.23.12.
- **CI contract (F-07):** `.github/workflows/ci.yml` job renamed `browser-fallback`,
  comment now states full `npx playwright test` on Chromium under WebGL2 fallback (NOT a
  smoke subset, never a WebGPU validation); `docs/CI_CD.md` §2 + §16 reconciled. Coverage
  deliberately NOT narrowed.
- **Waveform flake (F-08):** `tests/browser/black-hole-merger.spec.ts` two fixed
  `waitForTimeout(400)` waits replaced with `expect(readout).toContainText('inspiral'|
  'ringdown', { timeout: 5000 })` (condition-based, bounded). Stress: 3 isolated runs +
  full 11-test suite under --workers=2 all PASS. No longer sleep-based.
- **Benchmark discoverability (F-06):** added `bench:stellar-explosion`; confirmed
  `bench:neutron-star` (Phase A). All 8 bench scripts now mapped. `BENCHMARK_MATRIX.md`
  already documents both; no fabricated committed measurements.
- **Control-plane truthfulness (F-03/F-09):** `.agent/START_HERE.md` now marks M12-NS
  COMPLETE + M12-RI ACTIVE; `.agent/EXECUTION_PROMPT.md` got a status header (Phase A
  COMPLETE, Phase B ACTIVE) and final line points to M12-RI. README M11 "in progress" →
  COMPLETE, GPU-timing wording corrected (frameGpuMs populated when WebGPU timestamps
  available; CPU/rAF never conflated), CA9 source-status updated.
- **CA9 source status (F-04):** `docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md`
  §0 addendum — paper now publicly reachable as scanned PDF via NASA GISS/NTRS; CA9 moves
  BLOCKED → TRANSCRIBE; PDF redistribution still gated (not committed without rights).
- **No-behavior-drift gate:** `npm run check` PASS (504 unit + build); full default
  project `npx playwright test` on E2E_PORT=4199 reached 141/177 with 0 failures before a
  30-min tool timeout; remaining 36 are visual goldens validated 40/40 in dedicated runs.
  This integrity pass changed only control-plane/docs/test-waits — no rendering/physics
  code, so no expected golden drift.

---

### M12-NS closure record (2026-08-26)

- Surface-ray direct path: `surfaceRayReference.ts` (binary64 oracle, NS codes
  11..14) + `surfaceLensingGpu.ts` (TSL fullscreen pass mirroring the
  Schwarzschild integrator) + `neutronStarModule.ts` rewired (sphere mesh
  removed; km→r_g per-frame uniform; `?nssurfacedebug=1`).
- Tests: `neutronStarSurfaceRay.test.ts` + `neutronStarPhysics.test.ts` (28
  unit); `tests/browser/neutron-star.spec.ts` 8/8 (parity corpus webgpu+webgl2).
- `npm run check`: PASS (504 unit, build/lint/typecheck/format green).
- Black-hole non-regression: `integrator-parity` 4/4 + `ray-parity` 1/1 PASS;
  shared `schwarzschildIntegrator.ts`/`cpuReference.ts` untouched; BH/Kerr goldens
  unchanged.
- Visual goldens: regenerated ONLY `NS_SURFACE`/`NS_PULSAR`/`NS_MAGNETAR`;
  full suite 40/40 on `E2E_PORT=4199`. (Default 4173 produced one
  `ERR_CONNECTION_REFUSED` flake on `CM_REMNANT` — port-collision, not drift;
  M12-RI item.)
- Benchmark: `scripts/bench-neutron-star.mjs` + `bench:neutron-star` script;
  smoke run median CPU 20.9 ms / GPU 19.01 ms (timestamp queries), 0 console
  errors.
- Docs truthfulness: README NS row DIRECT + disclosed omissions;
  PHENOMENA_IMPLEMENTATION §2 status; SCIENTIFIC_FIDELITY §6; BENCHMARK_MATRIX
  NS-01/02 links.
- Known omissions (disclosed): Doppler/aberration, frame dragging, atmosphere,
  oblate figure, interior metric. Static `g = sqrt(1-2r_g/R)` only.

---

## Previous phase note (M11)

M11 SYSTEMIC OPTIMIZATION CAMPAIGN remains complete (BH-121 closed, Kerr hot
loop deduplicated; performance characterization in `docs/PERFORMANCE.md` §14).

### Optimization campaign record (2026-08-26)

Scope inspected with evidence: Kerr numerical pass (hot loop read line-by-line,
benchmarked), Schwarzschild numerical + LUT passes, all seven CA destinations,
atlas frame orchestration/governor, startup/boot path and bundle composition,
benchmark harnesses, unit-test/build runtimes.

Landed:

1. **BH-121 GPU timestamp timing** (`e2375cf`): `trackTimestamp` on both
   renderer construction paths, bounded 90-frame pool-resolve cadence,
   `kernel.gpuFrameMs` = last resolved frame's summed render-pass ms (verbatim
   three.js TimestampQueryPool semantics — per-frame total, never averaged
   into CPU windows), surfaced via debugInventory + `frameGpuMs`
   in bench-black-hole/bench-kerr records. Overhead measured nil vs baseline
   commit (interleaved A/B).
2. **Kerr RK4 common-subexpression elimination** (`a36fed1`): shared
   per-stage metric block (`stageMetricFn` vec4 Sigma/Delta/sin²/sin consumed
   by RHS + azimuthal rate), hoisted pixel-invariant conserved products
   (E², 4MaE·Lz prefix-factored to preserve op order exactly), carried
   segment-start world-Y height instead of re-embedding last iteration's
   endpoint every disk-enabled step. Provably bit-identical trajectories.
3. Docs: `docs/PERFORMANCE.md` §14 — first true GPU-ms table per backend,
   methodology warning (bimodal machine state ~97–160 ms across same-day
   reruns; headless rAF quantizes to ~7 ms quanta → interleaved A/B required
   for any claim).

Evidence highlights (amd rdna-2, headless msedge 151, 972×727 internal,
medium tier): LUT ~10.2 ms GPU / CA destinations 0.5–0.8 ms GPU /
numerical-Schwarzschild 40.7 ms GPU / Kerr static ~129 ms GPU — the Kerr
backend is the only GPU-bound heavy scene and its cost is mandated by the
validated integration budgets (deeper cuts would change trajectories and
goldens; explicitly out of scope). OPT-2's effect sits below this
environment's measurement floor (~1 quantum); kept as strictly-less-work,
zero-drift.

Investigated and deliberately NOT changed (with reasons):

- Idle-frame skipping for paused/static scenes (paused-state-only benefit;
  stale-frame invalidation risk High; would invalidate benchmark methodology).
- Step-size policy / bisection iterations / escape radius changes (locked
  CPU-parity formulas; goldens must stay stable).
- Startup waterfall (assets lazy per destination; local boot ≈3.4 s dominated
  by WebGPU pipeline compilation — expected per PERFORMANCE_BUDGETS §15).
- Bundle splitting of `three.webgpu` (prebundled 1.03 MB / 284 KB gz; not
  tree-shakeable; lazy destination chunks already exist).
- Per-frame JS allocations in destination.render (whole orchestrated JS
  frame measures 0.24–0.6 ms — immaterial).

Validation: `npm run check` PASS (prettier/eslint/tsc clean, vitest 476/476,
vite build PASS); `npm run e2e` **169/169 PASS** (one unrelated timing flake
in black-hole-merger waveform cursor sync on run 1 under 6-worker GPU load;
passed standalone and in the full rerun — test uses a fixed 400 ms wait);
parity corpora (kerr/integrator/ray) webgpu+webgl2 twice; visual goldens
40/40 across two independent runs over the modified shader codegen.
Temporary probe scripts and machine-local benchmark JSONs were removed
before closure (raw machine records are not committed by policy).

---

# Previous phase (M11)

**M11 COMPLETE — release candidate.** Packet status:

| Packet | Status | Evidence |
| --- | --- | --- |
| M11-01 browser/fallback matrix | DONE | `docs/COMPATIBILITY_MATRIX.md` + `tests/browser/compatibility-matrix.spec.ts` (4/4 Chromium, 4/4 Firefox 153 headless WebGL2 fallback, serial); WebKit + real devices `DEFERRED_ENVIRONMENT` with reasons. |
| M11-02 mobile/touch/DPR | DONE | `tests/browser/mobile-touch.spec.ts` 5/5 (portrait DPR-3 pixel cap, orientation flip, tiny-viewport recovery, mobile-layout drag without scroll trapping, no-hover panel operability). Emulated only — no device performance claims. |
| M11-03 device-loss recovery | DONE | Locked terminal reload-required contract implemented (`isFatalDeviceLoss`, `onFatal`, truthful `GPU_DEVICE_LOST` status line, frame submission stop) + `tests/browser/device-loss.spec.ts` 3/3 via production-path fault injection (`simulateDeviceLossForTest`). `docs/FAILURE_RECOVERY.md` §5 records the decision + rationale. |
| M11-04 resource-leak torture | DONE | `tests/browser/resource-leak.spec.ts` 3/3: 12 cross-destination cycles return to scope/GPU-byte baselines; observer churn bounded; resize storm live+bounded (debug-inventory counters, no new telemetry). |
| M11-05 accessibility | DONE | `tests/browser/accessibility.spec.ts` 4/4: keyboard core flow (nav → mode switch → panel → observer select), canvas text companion, labeled range inputs with text readouts + arrow-key operation, post-switch focus never stranded in disposed nodes. |
| M11-06 assets/provenance/licenses | DONE | `docs/ASSET_PROVENANCE.md` §18 dated audit: PASS. **Missing root LICENSE added (MIT)**; three@0.185.1 sole runtime dep (MIT); bundle scanned clean of machine paths/keys; CA9 source status truthfully blocked. |
| M11-07 production build/deployment | DONE | `npm ci` fresh-lockfile proof (144 pkgs, 0 vulnerabilities) + full `npm run check` green; `docs/DEPLOYMENT.md` provider-neutral contract (SPA fallback, HTTPS, cache policy, no secrets, CSP, no COOP/COEP); the whole e2e suite runs on the production preview build. |
| M11-08 final benchmark report | DONE | `benchmarks/results/2026-08-26-m11/` — first-class `--observer` harness + matched 5-scenario series + `SUMMARY.md` (honest CPU-rAF labeling, frameGpuMs=null, single-machine caveats, regression audit vs M10 baseline). |
| M11-09 user-facing docs | DONE | README status/truthfulness refresh (M10 observer modes + stop-band limitation + Kerr presets + new suites + timing wording); `docs/FAILURE_RECOVERY.md` §5 rewritten to the locked contract; `docs/OBSERVABILITY_DIAGNOSTICS.md` §8.1 documents `?lutdebug`/`?kerrstatus` classification views. |
| M11-10 release-candidate full gate | DONE | Final cumulative run (below). |

M10 release-evidence debts closed: observer goldens materialized + twice-stable;
matched moving-observer benchmarks recorded.

## High defects found and fixed (all validated)

1. **Vacuous Kerr/BHM golden baselines** — harness `startsWith('/atlas/black-hole')`
   navigation skip swallowed `?preset=` rows AND `black-hole-merger`; 8
   baselines were byte-identical default-view captures (MD5-verified). Fixed
   (full URL parsing + post-capture destination/preset assertion + `#scene`
   identity guard); 8 re-baselined; the other 27 pre-existing baselines
   byte-identical across the fix.
2. **M10 moving-observer GPU init physically wrong** — static-emitter
   direction formulas without u's spatial drift → empty-sky (Schwarzschild
   numerical+LUT) / failure-magenta (Kerr) renders on all four moving
   presets. Fixed covariantly (`E=-k_t`, `pr=k_r/E`, `b=L/E`,
   `Wu + Σn_a W_a`, new `observerLegWu` uniform) with binary64 mirror
   (`observer/photonInit.ts`) + 5 unit gates (static-formula reduction exact
   to 1e-12); Kerr step budget scaled ×3 for moving observers only
   (compile bound decoupled from the tier ladder; measured census median
   ~215 / p95 ~1260 / max ~2600 steps). Residual Kerr failure band =
   DOCUMENTED pole-passage honesty gate (near-polar Lz≈0 photons) — now
   visible per-reason via `?kerrstatus`.
3. **Device loss had no user-visible path** — `GPU_DEVICE_LOST` copy existed
   but was unreachable; loss left a misleading READY. Fixed with the locked
   terminal reload-required contract.
4. **Observer preset framings** pointed the observer ~90° away from the hole
   (hole outside the FOV) — sight-line-corrected poses.
5. **Control-panel staleness/mid-drag rebuilds** — deep-link boots showed
   stale values forever; slider drags rebuilt the panel per input event.
   Fixed (one rebuild per completed transition, mode in signature, per-tick
   value sync).
6. **Missing root LICENSE** (package.json declared MIT, no file).

## Final cumulative validation (release gate)

| Gate | Result |
| --- | --- |
| `npm ci` fresh lockfile | PASS — 144 packages, 0 vulnerabilities |
| `npm run check` | PASS — prettier clean; eslint clean; tsc clean; vitest **476/476** (32 files); vite build PASS |
| `npm run e2e` (workers=2, production preview) | **169/169 PASS** — 165 default-project (all destination suites, parity corpora ×4 backends, 40 goldens, observer modes, compatibility matrix, mobile-touch, device-loss, resource-leak, accessibility) + 4 firefox-project matrix tests |
| Visual goldens | 40/40, twice-stable (two standalone runs + the final e2e) |
| Environment | Windows 11 (10.0.26200), Node v22.23.2, Playwright `msedge 151` headless + Firefox 153 headless, hardware WebGPU `amd rdna-2`; e2e on `E2E_PORT=4199` (4173 occupied by a foreign app) |

## Known limitations / deferred (truthful)

- WebKit: `DEFERRED_ENVIRONMENT` (Playwright ships no Windows WebKit builds).
- Real mobile devices: `DEFERRED_ENVIRONMENT` (emulated viewport/touch only;
  no device GPU/performance claims).
- Kerr moving-observer scenes: residual explicit failures are the documented
  pole-passage honesty gate + max-steps at low tiers (preset recommends
  ultra); disclosed in GOLDEN_IMAGES.md and the preset fidelity note.
- `frameGpuMs` null everywhere (no GPU timestamp queries wired).
- Hosted CI: `.github/workflows/ci.yml` runs format/lint/typecheck/unit/build
  + a WebGL2-fallback smoke job; hosted runners provide no representative
  WebGPU, so the full browser/golden evidence is local-run (recorded
  honestly; not silently claimed as CI-passed).
- Carried debts: CA9 source-lock is now complete (see CA9 closure record); remaining debts are CA8 remnant perf note and Kerr perf headroom. Previous debt was CA9 transcription blocked on the
  paper source; CA8 remnant perf note; Kerr perf headroom.

## Critical/High defects remaining

Zero known.

## Commit chain this campaign

```
3b25cb1 docs(agent): plan M11 production hardening and release-candidate campaign
7855f67 fix: correct M10 moving-observer GPU photon initialization, preset sight lines, and observer panel sync
13f3adb test: golden harness destination/preset guard, corrected Kerr/BHM baselines, M10 observer goldens
2156d46 state: record M11 WS0/WS1A defect ledger, moving-observer render fix evidence, and next workstreams
422b13d bench: first-class moving-observer selection in the black-hole benchmark harness (M11 WS1B)
1ee1606 test: M11-01 compatibility matrix with engine-agnostic fallback suite (Chromium + Firefox)
75fd95b test: M11-02 mobile/touch/DPR hardening suite (device-emulated)
6c21a54 fix: explicit terminal device-loss state with production-path fault injection (M11-03)
662b8bc test: M11-04 quantitative resource-ownership torture across destinations
afe16a9 test: M11-05 accessibility suite - keyboard core flow and text-first state
1862937 fix: add missing MIT LICENSE text and record the M11 license/provenance audit (M11-06)
60da148 docs: provider-neutral deployment contract (M11-07)
0471db5 docs: M11 final benchmark summary, device-loss contract reconciliation, README truthfulness (M11-08/09)
55a1bc5 release: M11 production hardening release candidate - full campaign closure
b94d129 fix: complete the pushed tree - hook type surface, formatting, and deep-audit doc notes
<pending: state commit recording this chain; it is the campaign tip>
```

Final pushed `origin/main` at the time of this state update: `b94d129`
(closure commit `55a1bc5` + the tree-completion follow-up `b94d129` that
carries the hook type surface the committed specs typecheck against, plus
the deep-audit doc notes).

## Next actions

1. ~~Commit Phase A (M12-NS) with detailed evidence; push to `origin/main`.~~ DONE (commit `a827563`).
2. ~~Begin Phase B `m12-repository-integrity` ...~~ DONE (commit `5e01bbb`).
3. ~~Phase C `ca9-galaxy-collision`: source-lock Toomre & Toomre 1972 via
   NASA GISS/NTRS (now publicly reachable as scanned PDF), offline artifact pipeline,
   runtime interpolation.~~ DONE this session (see CA9 closure record above).
4. If a deployment target is chosen, verify the DEPLOYMENT.md checklist on
    the real host (HTTPS/WebGPU secure context, SPA fallback, cache headers).
