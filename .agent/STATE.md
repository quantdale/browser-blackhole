## 2026-10-09 session — openspec apply: `atlas-terminal-state-visibility` implemented, validated, CLOSED and ARCHIVED

Status: **COMPLETE — committed `bbf66ea`, archived; NOT pushed.** Applied the change
`openspec/changes/atlas-terminal-state-visibility/` (18/18 tasks). Per-row evidence is in that
change's `tasks.md` §1–§5; the E-04 probe result that closes it is §4.1–4.3.

This was a **native-continuation apply**, not a resumed planner campaign:
`.agent/EXECUTION_PROMPT.md` is `COMPLETED AND SUPERSEDED` (successors
`docs/MASTER_PLAN.md` + `.agent/START_HERE.md`), so per `.agent/PLANNER_HANDOFF.md`
the native continuation semantics applied and the assigned change was the one whose
artifacts were complete and unchecked — the OpenSpec change artifacts.

**Ownership gates were verified before any edit** (tasks.md §1): the
`destination-control-truthfulness` scoped slice had landed (`87deee3`, close-out
`661f6d5`) so `src/app/atlasApp.ts` was free; `shared-renderer-service-lifecycle`
was at 0/59 tasks and therefore not an active writer of `src/atlas/host.ts` or
`TransitionDirector.ts`. Both files were taken directly rather than deferring to a
shell-only half.

**What the user-visible defects were.** A lost graphics device and a slow destination
open left the user looking at a frozen canvas with no explanation:

1. **Device loss.** The shell's only presentation was a status string written into
   `#panel` — the panel is rebuilt on every destination change and set `inert`
   when collapsed, so the terminal fact was unreachable exactly when the user most
   needed it. `buildUnsupportedMessage` already had authored `GPU_DEVICE_LOST` copy
   with zero product callers on the post-boot loss path.
2. **Slow open.** The director emitted `slow-load` status; `host.ts` subscribed to
   `onStatus` and handled only `route-commit`, so the event was dropped. The shell
   never read it, and the user got no "still opening" state before a stall became
   an error.

Implemented:

- **Terminal surface (tasks §2).** `renderDeviceLossTerminal()` renders the fatal
  card in the existing outside-panel `.atlas-alert-region` from the single `onFatal`
  subscription, using `buildUnsupportedMessage(backend, 'GPU_DEVICE_LOST')` — the
  same authored vocabulary the boot failure uses, not a second one. Reload is the
  only action; there is deliberately no dismiss, because dismissing the only
  explanation returns the user to the frozen canvas this change exists to prevent.
  It sets `deviceLossTerminalActive`, which is what stops the UI tick from clearing
  the surface when the published transition error later reads `null` — the state a
  post-loss navigation leaves behind. The `.atlas-status` mirror is kept unchanged.
- **Slow-preparation notice (tasks §3).** The director publishes
  `TransitionPublicState.slowLoad` (set in `maybeEmitSlowLoad()`, cleared wherever
  `publicError` clears plus on completion and cancel), and the shell renders it as a
  separate absolutely-positioned `role="status"` region, hidden by default, sibling
  of the alert region and outside `#panel`. It is hidden in the same tick as a
  published error or a device-loss alert. `host.ts`'s existing `onStatus`
  subscription now handles `slow-load` instead of dropping it, keeping the
  debug-diagnostics console line. **No second status bus was added** and no private
  director field is polled.
- **Overlay suspicion — probed, and NOT reproduced (tasks §4).** This is the
  interesting result. `renderOverlay` returns early on a null renderer, holding the
  last valid overlay texture, and a loss during `outgoing`/`hyperspace` therefore
  freezes a mid-transition frame. Measured in both phases with an in-page rAF
  watcher that injects the loss the instant the phase opens (no round-trip latency
  to let the window pass):
  - `outgoing`: `destinationOccluded=false`, near-black 0.50, 69 distinct colours;
    `elementFromPoint(card centre)` → **`atlas-alert-body`**.
  - `hyperspace`: `destinationOccluded=true` (opaque by design there), near-black
    0.04, 240 distinct colours; the card is again the topmost element at its own
    centre, outside `#panel`, outside any inert subtree.
  In both phases the held overlay never covers the terminal surface. So **overlay
  rendering was left unchanged** — no fix was applied to a defect that does not
  reproduce, and no golden was disturbed by it. The negative result is recorded in
  the change's `tasks.md` and pinned by two permanent rows that would fail if a
  later change buried the card under the canvas or moved it into the panel.

Evidence (all on the final tree, msedge 1280x800):

- **Fail-first, both directions.** Before implementation the three terminal-surface
  rows failed with `element(s) not found` for `.atlas-alert` — the card did not exist
  in the DOM at all — while the three pre-existing M11-03 rows passed. After the
  device-loss card landed, disabling only the slow-prep rendering failed all three
  slow-preparation rows. Unit: stubbing the `getPublicState()` publication failed
  4/4 new `slow-preparation notice` rows while the 10 pre-existing rows passed.
- `npm run check`: **exit 0** — format, lint, typecheck, **55 files / 681 unit
  tests**, build, production test-hook gate.
- `device-loss.spec.ts`: **8/8** (3 pre-existing + 3 terminal + 2 overlay).
- `atlas-navigation accessibility mobile-touch slow-preparation production-hygiene
  --project=default --workers=1`: **31/31 passed (3.9m)** — every pre-existing
  transition-failure row, the collapsed-panel failure row, the mobile drawer row,
  and both U-04 hygiene rows pass unchanged.
- `visual-goldens --project=default --workers=1`: **43/43 passed (6.8m)**, no
  re-baselining. `cinematic-goldens` deliberately not run (no overlay/motion code
  changed; see tasks.md 5.3).
- One pre-existing test defect repaired on the way: the real-time frame loop in
  `transitionFailurePublication.test.ts` awaited ~400 × 16 ms of sleeps (~6.4 s)
  against a 5 s default budget and failed under the extra full-suite load this
  change introduced. Nothing in the post-prepare phases reads the wall clock, so
  the loop now pumps `update()` through a new deterministic `pumpMotion()` helper —
  same 14 rows in 2.8 s instead of 12 s, and no longer load-dependent.
- `openspec validate atlas-terminal-state-visibility --strict`: **valid**.

**Landed state (close-out).** The change is **committed at `bbf66ea`** — "feat(atlas): implement
atlas-terminal-state-visibility", main, ahead of `origin/main` by that plus the five earlier
Phase 1 checkpoints. **It was NOT pushed**: no operator authorization existed in this session,
and the Phase 1 entries above consistently record "no push". The push decision is recorded
here, not taken.

E-04 is no longer an open fix. The gated overlay probe (tasks.md §4) measured device loss in both
`outgoing` and `hyperspace` and found the terminal card is the topmost element at its own centre,
outside `#panel` and outside any inert subtree, in each — the held overlay draws under the DOM
surface and never covers it. Overlay rendering was intentionally left unchanged; nothing was
re-implemented and no golden was re-baselined.

**Next live lane:** the remaining `destination-control-truthfulness` tasks — **U-02, U-03,
U-05…U-19** (Neutron-Star inclination binding, the fidelity note, the share/control-reflection
family, the focus/aria rows, the smaller confirmed fixes) — then `shared-renderer-service-lifecycle`
(R-01…R-12).

**What Phase 2 must preserve.** `shared-renderer-service-lifecycle` now owns `src/atlas/host.ts`
and may rewrite the renderer/kernel services this change leans on, so these three properties are
contractual, not incidental:

1. `TransitionPublicState.slowLoad` must remain the channel the shell reads for the slow-open
   notice. The whole point of the notice is that it rides the existing transition snapshot on the
   tick the shell already runs — no second status bus, no private-director polling. Replacing it
   with an event-only path would regress a panel rebuild.
2. The terminal device-loss card must stay in the outside-panel `.atlas-alert-region` and must not
   be cleared when `transition.error` is null. That guard (`deviceLossTerminalActive`) is what
   survives a post-loss navigation; removing it hands the user a frozen canvas with no
   explanation.
3. The device-loss card must keep reload as its only action, with no dismiss.

---

## 2026-10-09 session — Phase 1 change 4: destination-control-truthfulness (U-01, U-04, U-09, U-10) IN PROGRESS

Status: **implemented and locally validated; full non-golden suite running.**
Fourth Phase 1 change in `docs/MASTER_PLAN.md` §6/§7, scoped to the four findings that are
user-visible, single-line and high blast-radius. U-02 and U-03 are NOT in this slice — see
"Deliberately deferred" below.

Implemented:

- **U-01 (AGN torus invisible after a zone change).** The zone machine in `update()` changes
  `activeZone` and calls only `applyZoneVisibility()` (group gating). The torus's own
  `setVisible` was written by `applyStateToResources()`, which runs only from `prepare()` and
  `applyControlState()` — so a zoom-driven zone change never re-applied it, and the torus
  stayed hidden while `visibleGroups` reported `['nuclear']` and the debug snapshot reported
  `torusVisible: true`: diagnostics actively contradicting the frame. Fixed by re-applying
  per-resource visibility on every zone change, and by making the torus flag a pure function of
  `state.torusVisible` (group gating already provides the exclusivity). Fail-first verified by
  removing only the re-application call: `torus must return after re-entering nuclear` fails.
- **U-04 (`__ATLAS_APP__` shipped unguarded).** The hook exposed the host — including
  `forceContinuousRenderForTest()` and a synchronous framebuffer readback — to any script on the
  page, while `host.ts` documented the forced-render path as "not reachable from production
  UI". Now gated on `import.meta.env.DEV || __ATLAS_TEST_HOOKS_OPT_IN__`, where Vite substitutes
  the latter from `VITE_ATLAS_TEST_HOOKS=1` at BUILD time. `npm run build` — the artifact CI
  validates and any deployment serves — contains no hook at all and no unsubstituted define.
  The Playwright `webServer` now builds its own bundle via `npm run build:e2e` instead of reusing
  whatever `dist/` happens to hold, removing the stale-artifact failure mode where a production
  build silently strips every hook and all ~200 specs fail. `scripts/check-no-test-hook.mjs`
  asserts the production property and runs as the last step of `npm run check`;
  `tests/browser/production-hygiene.spec.ts` covers the invariant that holds for every bundle
  (define always substituted) plus "the hook IS reachable in the e2e bundle".
- **U-09 (focus destroyed on every rebuild).** `replaceChildren` threw keyboard focus to
  `<body>` on every destination switch and every panel rebuild. Added a stable focus identity
  (role-bearing tag + type + accessible name) captured BEFORE any destructive step and restored
  after, scoped to the shell root because the control the user last touched is usually the
  destination chip — which `refreshNav()` rebuilds too. An implementation-order bug was found
  and fixed during the work: capturing after `refreshNav()` had already lost focus to `<body>`.
  Fail-first verified: `focus must not fall back to <body>` fails without the restore.
- **U-10 (collapsed mobile drawer stayed in the a11y tree).** Below 720px the drawer is
  translated off-canvas rather than `display: none`, so it kept its tab order. It is now `inert`
  when collapsed, removing it from the a11y tree and tab order without touching the slide
  transition. A latent test assumption surfaced by this fix was repaired: `mobile-touch.spec.ts`
  tapped "Controls" unconditionally, which closed the already-open panel and then tried to tap
  inside the now-unreachable drawer.

Evidence (all on the final tree):

- `npm run check`: exit 0 — 55 unit files / **677 tests**, plus the new production test-hook gate.
- Full non-golden browser suite: **243 passed / 1 skipped / 0 failed (30.4m)**. The single skip is
  the documented WebGPU-only LUT parity row.
- `visual-goldens --workers=1`: **43/43**, no re-baselining.
- `cinematic-goldens`: **8/8**, no re-baselining. One first-run failure of `CIN_GALAXY_BRIDGE` was a
  readiness timeout (`Expected "ready", Received "waiting"` at a 30 s ceiling), not a pixel
  difference: the row passes standalone with byte-identical metrics to the earlier green run, and
  the whole suite then passed 8/8 on a clean port. **No golden was re-baselined.**
- `dist/` hygiene on the production artifact: 0 source maps, 0 machine-local paths, 0 TODO markers,
  0 `__ATLAS_APP__` assignments, 0 unsubstituted `VITE_ATLAS_TEST_HOOKS` leaks. The e2e artifact has
  exactly 1 hook assignment, as designed.
- `openspec validate`: the change is valid; `--all --strict` green.
- Fail-first verified in both directions: removing the AGN zone re-application fails
  `torus must return after re-entering nuclear`; removing the focus restore fails
  `focus must not fall back to <body>`.
- Refero MCP research (U-09/U-10): `refero_search_screens` on "error state banner with retry action
  on dark dashboard" and `refero_search_styles` on dark technical consoles. The convergent real-product
  pattern is a non-blocking alert with one primary recovery CTA and a dismiss affordance, plus an
  assertive live region — which is what the change-3 banner implements. No branding or layout was
  copied; findings informed the accessibility and interaction decisions only.

Deliberately deferred (documented, not skipped):

- **U-02** binds the Neutron-Star `observerInclinationDeg` control to the camera rig — a
  two-way binding with real regression risk on the observer-mode presets. Needs its own slice.
- **U-03** corrects the Neutron-Star fidelity note to describe the shipped DIRECT surface-ray
  path — documentation only, but it touches the Fidelity contract and wants its own review.
- **U-05…U-19** remain as scoped in `openspec/changes/destination-control-truthfulness/`.

## 2026-10-09 session — Phase 1 change 3: transition-error-user-visibility implemented, validated and CLOSED

Status: **COMPLETE.** Third of the four Phase 1 changes in `docs/MASTER_PLAN.md` §6/§7.
Implementing `openspec/changes/transition-error-user-visibility/` (E-01, E-02, E-03, E-05; the
atlas-error-reporting capability). Per-row evidence is in that change's `tasks.md` §0-§8.

**What the user-visible defect was.** When a destination failed to prepare — a deploy that renamed a
hashed chunk, an offline laptop, a blocked or truncated data fetch, or any throw inside a module's
`prepare()` — the transition silently reverted to the previous destination and the only trace was a
`console.error`. `TransitionPublicState` had no error field, `host.ts` subscribed to `onError` purely
to log, and `atlasApp.ts` never read the director's error at all. A second, related gap: a hung data
request left the app in `preparing` forever, because the only abort paths were retarget, cancel and
dispose.

Implemented:

- **E-01/E-03** `TransitionPublicState.error: TransitionError | null` — a stable machine code, authored
  display copy, the failing destination id and a `fatal` flag, published by `emitError` (the single
  point the director already used), cleared on successful completion and superseded by a new request.
  `emitError` now splits the technical message (console channel) from the authored copy
  (`buildTransitionFailureMessage` in `src/atlas/hostStatus.ts`), so no loader string or stack trace
  reaches the DOM.
- **E-01** the shell renders an assertive `role="alert"` banner OUTSIDE the collapsible panel's hiding
  subtree and outside the panel rebuild path, so a collapse or a rebuild can neither hide nor destroy
  the error. It is absolutely positioned and `hidden` by default, so the pinned shell geometry the
  goldens depend on cannot move. Recovery actions: **Try again** (re-requests the same destination),
  **Reload page** (fatal only), **Dismiss** in both cases. Retry is user-initiated only — no
  automatic retry, so a failing retry re-presents the same error and cannot loop.
- **E-02** `buildUnsupportedMessage` had ZERO callers; it is now wired into the product boot-failure
  path (subscription registered before `host.init()`, plus an idempotent render in the boot catch).
  The product route now presents the same remediation standard as the legacy route. A latent gap was
  fixed on the way: the subscription was registered AFTER init, so a boot that failed could never
  have rendered anything.
- **E-05** a stall gate on the director: `stallThresholdMs` defaults to 10x `slowLoadThresholdMs`
  (9 s vs 900 ms) and the constructor throws if it does not exceed the slow-load threshold. A
  PROGRESS EVENT is settlement, a first-or-strictly-increased finite `reportProgress` fraction,
  response headers, or an increase in received response bytes; a label change alone is not progress.
  Expiry aborts through the same `AbortController` a retarget uses (so every generation/stale guard
  runs unchanged), records `stalledGeneration`, and publishes a recoverable `TRANSITION_STALLED`
  failure with a retry action instead of resetting silently.
- **Supporting fix found while implementing the gate.** Three real defects in the progress-reporting
  layer: the two data loaders awaited a single `arrayBuffer()` (so a slow multi-second download was
  indistinguishable from a hung one), `loadShippedLutFamily`'s three fetches were not cancellable at
  all, and module-level fractions went BACKWARDS after a loader download (0.6 after the loader's
  0.8) — which is a label change, not progress, and would have silently disarmed the gate for the
  step that followed. Fixed with a new `src/phenomena/shared/assetTransfer.ts`
  (`readBodyWithProgress`), `onProgress` on both loaders, the abort signal threaded into the LUT
  loader, and monotonic fraction ranges.

Evidence:

- Fail-first (browser): all seven new rows FAIL pre-fix. Verified in one stash round-trip against a
  pre-fix build — the alert region does not exist in the DOM at all, and the stall row stayed
  `preparing` for its whole 60 s budget (the E-05 defect itself).
- Fail-first (unit): `transitionFailurePublication.test.ts` 10/10 green post-fix; reverting
  `getPublicState().error` fails 10/10 and reverting `checkPrepareStall()` fails 4/6.
- `npm run check`: exit 0 — format, lint, typecheck, **55 files / 676 unit tests**, build.
- Browser (`--project=default --workers=1`, msedge, 1280x800):
  - `atlas-navigation` + `accessibility` **19 passed** (including the new mobile-drawer row);
  - `atlas-navigation` + `accessibility` + `atlas-webgl2` + `smoke` **27 passed**;
  - **full non-golden browser suite 236 passed / 1 skipped / 0 failed (30.9m)** — the single skip
    is the documented WebGPU-only LUT parity row.
- `dist/` hygiene: no `TODO`/`FIXME`/`HACK`, no `.map` files, no local paths, no secrets.
- Refero MCP research for this campaign's UX decision: `refero_search_styles` (dark technical
  console) and `refero_search_screens` ("error state banner with retry action on dark dashboard").
  Convergent pattern across the references: a dark surface with a single primary recovery CTA
  ("Try again"), explanatory text, and a dismiss affordance — implemented originally with the
  existing token set, not cloned.*
- `visual-goldens` **43/43** and `cinematic-goldens` **8/8** with **no re-baselining** (51 total).
  A later combined golden run first reported 2 failures — both `net::ERR_CONNECTION_REFUSED`
  (the Playwright-managed preview server died mid-run); re-running on a clean port gave
  **43/43** and the same 51-row set. No golden was re-baselined in either run.
- `openspec validate transition-error-user-visibility --type change --strict`: valid;
  `--changes --strict` 11/0 and `--all --strict` 17/0.
- **One recorded flake, not silenced.** `accessibility.spec.ts:146` (range inputs) failed once in a
  4-spec combination and passed 3/3 on HEAD, 18/18 with `atlas-navigation`, and 27/27 in the same
  4-spec combination on re-run. Mechanism: MASTER_PLAN **U-09** (confirmed, P1) says focus is
  destroyed on destination-switch panel rebuilds, so the row's `before`/`after` reads can straddle a
  rebuild. Not caused by this change (no change-3 code path touches slider state or panel DOM);
  owned by `destination-control-truthfulness`. **Not re-baselined or retried into green.**

Next action: strike E-01…E-05 from `docs/MASTER_PLAN.md` and start Phase 1 change 4,
`destination-control-truthfulness` (U-01…U-19, including U-09 and the flake's root cause). No push.

## 2026-10-03 session — Phase 1 change 2: quality-ladder-resolution-integrity implemented, validated and CLOSED

Status: **COMPLETE (committed `274c591`).** Second of the four Phase 1 changes in
`docs/MASTER_PLAN.md` §6/§7. Implemented A-01, A-02, A-03, A-04, A-05, A-06 (A-07 left open as a
P3, per the change design's Open Questions recommendation). Per-row evidence is in
`openspec/changes/quality-ladder-resolution-integrity/tasks.md` §0-§8.

Implemented:

- **A-04** the kernel is the single owner of the pixel-ratio formula (`bufferW/H = floor(css * pixelRatio)`,
  `post.ensureSize(bufferW, bufferH, 1)`), so HDR target == drawing buffer ==
  `floor(cssSize * effectiveDpr * renderScale)`. Before: HDR was `scale²` of the intended linear pixel
  count (350x261 instead of 583x436 at `low`).
- **A-01** `host.onTierChanged` re-issues `handleResize`, so the tier's render scale now reaches the
  GPU; the overlay mirror rides the same single path.
- **A-02** `TransitionDirectorOptions.baseQualityMode` → `resolveBaseQualityMode()` read at motion end
  from `host.userQualityMode`, so a selection made during a transition wins.
- **A-03** new `src/atlas/renderTelemetry.ts#buildRenderSizeTelemetry` fed by `kernel.effectiveSize()` +
  `kernel.appliedRenderScale()`; `size: null` (unknown) before the first successful resize.
- **A-05** new `PerformanceGovernor.advanceFrame(deltaMs, presented)`; fps EMA, refresh window and tier
  sustain consume only presented-frame intervals; CPU submission time is retained as `lastCpuSubmitMs`.
- **A-06** `advanceFrame` calls `advanceActivityClock(deltaMs)` on every tick before the presented gate,
  so an idle, correctly frame-skipping scene still settles (A-06 row: `renderFrameCalls === 0` with
  `activityMode === 'stable'`).

Evidence:

- Fail-first: `renderScaleApplication.test.ts` (HDR 350 vs 583 at 0.6), `renderTelemetry.test.ts`
  (single assembly point), browser rows A-01 (`972 == 972` — buffer never moved) and A-02
  (`Expected "ultra", Received "auto"`) all failed pre-fix.
- `npm run check`: exit 0 (format/lint/typecheck/unit/build); build hashes stable
  (`index-KLf1_Tpn`, `blackHoleDestination-BiaI5V36`).
- Runtime magnitude for A-05, measured on a heavy preset (cinematic + bloom + timeline playing,
  240 frames ≈ 4 s): interval signal 54.29 fps vs the pre-fix submit-window reconstruction
  270.27 fps — the honest signal degrades auto to `low`/0.6 that the old signal would have denied.
- `frame-invalidation` + `atlas-webgl2` + `shared-post-lifecycle` + `shared-post-v2`: **24/24**.
  The `shared-post-lifecycle` snapshot pin was updated from magic `[973, 727]` to
  `snapshot == buffer == floor(viewportCss * effectiveDpr * 1)`; the old pin had ENCODED A-04's
  round-vs-floor mismatch.
- `visual-goldens --workers=1`: **43/43**, with **6 justified re-baselines** (`NS_SURFACE`,
  `NS_PULSAR`, `NS_MAGNETAR`, `GC_ENCOUNTER`, `GC_BRIDGE_TAIL`, `GC_POST_ENCOUNTER`). Justification:
  every golden pins tier `low` (scale 0.6); pre-fix the buffer was 583x436 but the HDR target was
  350x261, so every baseline encoded a 350→583 upscale blur. After: HDR == buffer == 583x436, the
  documented `docs/PERFORMANCE_BUDGETS.md` formula. 37 rows passed against their ORIGINAL
  committed baselines. `cinematic-goldens`: **8/8**, no re-baseline.
- Scenario matrix (`scripts/bench-scenarios.mjs --out=$TEMP/ql-scenarios-matrix.json`): 8/8
  destination records, `failures: 0` (webgpu, msedge, 1280x800, HEAD `2467d35`). GPU cost now
  rises with tier where it previously could not (black-hole 4.85→10.49 ms, quasar-agn 1.84→6.49 ms),
  which is only observable now that a tier change actually resizes.
- `resource-leak` M11-04 was caught by the first full-suite run and fixed on evidence: with truthful
  cadence the auto governor settles `low` during arrival, so the test's `baseline` had collapsed to
  the smallest tier and rejected the unchanged top tier. The test now anchors its baseline at the
  forced `high` tier (same procedure as each record), preserving the original intent. That fix is
  inside `274c591`. A second, unrelated single failure in `accessibility.spec.ts` M11-05 (keyboard
  flow) reproduced 3/3 green standalone and is recorded as a load-dependent pre-existing flake owned
  by `destination-control-truthfulness` (U-09).
- `openspec validate quality-ladder-resolution-integrity --type change --strict`: valid throughout.

Next action: begin Phase 1 change 3, `transition-error-user-visibility` (host/director/shell lane).
No push.

## 2026-10-03 session — Phase 1 change 1: kerr-gpu-initializer-correctness implemented and validated

Status: **COMPLETE pending checkpoint commit (tasks.md 6.3).** First of the four Phase 1
changes in `docs/MASTER_PLAN.md` §6/§7. Full product-code change; all gates below.

Implemented (evidence per `openspec/changes/kerr-gpu-initializer-correctness/tasks.md`):

- **D1** shared `bigANode` factory — camera-side `(r+a)²` defect replaced at both GPU sites plus
  the new `cameraSideInit.ts` mirror (was 56× wrong in A at r=8, a*=0.6).
- **D2** static `L_z` frame term → `g_tφ/√f_s`; **D3** `observerFrequencyComoving` gate
  (inactive multiplier exactly 1.0) recorded in `KERR_BACKEND_ADR` §RESOLVED.
- **D6 mass convention REVERSED from REJECT to THREAD** after evidence: the merger module
  legitimately passes source-derived `massRg = 0.9516` (docs + user-facing disclosure), the CPU
  oracle already threads `a = a*·M`, and threading is exact no-op at M=1. `aPhys`/`aPhysSq` now
  flow through every metric site; spurious `uMassRg` in the wTh θ-derivative removed (reference
  has no M factor); non-finite/non-positive mass still throws. Pins in
  `tests/unit/kerrMassConvention.test.ts` (`Δ(r+) ≡ 0` across M grid). The original D6-REJECT
  build had thrown from `ensureKerrPass` every merger frame (destination stuck "transitioning",
  `BHM_MERGER_FLASH` 60 s timeout) — fixed by threading.
- **D7** near-horizon half-step guard (f64 replay proved the stage overshoot → NON_FINITE);
  guard may shrink below minStep by design.
- **LUT**: analytic `b` vs `b_c` capture classification (sentinel demoted to secondary guard),
  manifest `axisX` threaded as uniforms, unsupported mapping → explicit `TypeError` + truthful
  numerical fallback.

Evidence:

- Fail-first: close-in parity rows received 43/80 rays pre-fix (stash round-trip); observer row
  is a recorded D8 deviation (shared-defect blind — passes pre-fix by construction).
- `npm run check`: **green** (prettier/eslint/tsc/vitest/build) after formatting 8 files.
- `npx playwright test kerr-parity --project=default`: **4/4** both backends, compared-count > 0.
- `visual-goldens --workers=1`: **43/43 ×2 twice-stable** with exactly two justified re-records
  (tasks.md §5.4): `KERR_HIGH_PROGRADE` (D7: NON_FINITE spiral → captured, before-image
  `$env:TEMP/kerr_hp_before.png`), `KERR_CIRCULAR_OBSERVER` (D1: ~97%-black failure-band
  baseline → real scene, `$env:TEMP/kerr_co_before.png`). `BHM_NEAR_MERGER`'s interim update
  (captured against the broken D6-REJECT build) was **reverted to HEAD**; all four BHM rows,
  `KERR_RETROGRADE`, `KERR_ZERO_SPIN` and all `OBSERVER_*` rows pass unchanged. Build hashes
  stable across rebuilds, so the two golden runs cover the final tree.
- `kerr-backend-census`: the post-fix standalone runs FAILED the cross-backend assertion
  (webgpu 40.038% vs webgl2 39.677% captured, deterministic ×3). Root-caused with a canvas
  geometry dump + playwright-pngjs screenshot diff: **webgl2's backing had latched at
  `PER_TIER_RENDER_SCALE.low` (583×436 → CSS upscale = blend ring) while webgpu latched 1.0** —
  a tier change does not re-run `handleResize` (A-01), and post-fix WebGL2 frames are heavier
  because the rays that used to die in the non-finite spiral now integrate fully. The census now
  pins `host.setRenderScaleOverride(1)` beside its tier pin. Result: **green ×2, byte-identical
  runs**, webgpu/webgl2 `capturedBlack 284175/284177 (40.173%)`, cross-backend agreement at
  2–5 rays; `otherMagenta` 999→0 and `unclassified` 95330→7085 are the correction itself
  (baseline: 27.510%/27.511%, 8-ray agreement — recorded before/after in tasks.md §0.3/§5.3).
- `lut-disk-parity` + `observer-modes`: green (8/8 combined run).
- `openspec validate kerr-gpu-initializer-correctness --type change --strict`: valid on the
  pre-implementation HEAD artifacts (stash round-trip) and on the final artifacts.
- Probe files cleaned: `kerr-probe.spec.ts`, `kerr-probe-out.json`, `scripts/tmp-gpu-step-probe*`,
  `scripts/tmp-census-diff.cjs`; census `[census]` log removed after capture.

Next action: commit the change as one coherent checkpoint (tasks.md 6.3), then start
`quality-ladder-resolution-integrity` (which owns the A-01 resize-latch behavior this session
worked around in the census). No push.

## 2026-10-03 session — specification-baseline-review-corrections apply

Status: **COMPLETE (archived `008966a`).** Bounded documentation/specification correction only; no
product code, no browser/GPU gates (reported not run, never PASS), no Phase 1 work.

Supersedes (without rewriting history) the Phase 0 entry's claims:

- "cinematic (`2fc1b5d`, certified 2026-08-30) now state their revisions" — WRONG. The
  restored-scope final certified checkpoint is `17c4644` (2026-08-30); `2fc1b5d` (2026-08-29)
  is an earlier checkpoint. Correction of record: `docs/SPECIFICATION_BASELINE_CORRECTIONS.md`.
- "`openspec validate --changes --strict`: 13 passed / 4 failed → 17 passed / 0 failed" —
  the 17 was the pre-archive change population; post-archive the change population is 11
  active (now 12 with this proposal) and 6 archived; `--all` then counted 17 items
  (11 changes + 6 specs), now 18 (12 changes + 6 specs). Qualify every count by command
  and lifecycle stage.

Repaired during this apply: current evidence citations in release/performance/visual-fidelity
certifications, observability diagnostics, the Galaxy Collision source lock, and the
spatial-atlas master plan now resolve to `openspec/changes/archive/2026-10-03-*` paths.
See `docs/SPECIFICATION_BASELINE_CORRECTIONS.md` for the full old-to-archive mapping and the
deliberate historical exceptions.

Evidence (pre-correction, at `APPLY_BASE` `2a57d9fe71afcf694106f942fbf645b647a1fbca`):
`openspec doctor` ok; `--changes --strict` 12 passed / 0 failed; `--specs --strict` 6 passed /
0 failed; `--all --strict` 18 passed / 0 failed. The four before-diagnostics are recorded in
the correction record.

Next action: none — closed. The application checkpoint (`a9a0713`) and archive checkpoint
(`008966a`) landed; no Phase 1, no push from this session. The earliest open implementation
work is Phase 1 per `docs/MASTER_PLAN.md` §7.

Known residual (documented in the erratum, not blocking): the archived change's own
`proposal.md:3`/`tasks.md:3` retain their original "PROPOSED — not applied" headers —
archives are immutable, so the correct state is recorded in the erratum and this entry, not
a patch to the archive. Task evidence is aggregate (erratum + this entry), consistent with
the hygiene change's practice.

POST-ARCHIVE STAGE (recorded 2026-10-03, now folded into the status above): `specification-baseline-review-corrections`
archived as `2026-10-03-specification-baseline-review-corrections`, specs merged: neutron-star MODIFIED replaced the vacuous scenario with positive + 3
negative cases; repository-integrity preserved original scenarios + 3 new. Post-archive populations: 7 archived, 11 active
(1 complete-awaiting-archive + 10 unfinished), 6 specs. Validation: `doctor` ok;
`--changes --strict` 11/0; `--specs --strict` 6/0; `--all --strict` 17/0. No product code,
no browser/GPU gates (not run), no Phase 1, no push.

## 2026-10-03 session — Phase 0 review-correction proposal and separate-session handoff

Status: **PROPOSED — NOT APPLIED.** The operator requested an OpenSpec proposal
for the four review findings and a prompt for a later apply session. No existing
baseline specs, archive files, certifications or executor instructions were
corrected in this session; no product code changed.

Proposal: `openspec/changes/specification-baseline-review-corrections/`.
Handoff: `openspec/changes/specification-baseline-review-corrections/APPLY_PROMPT.md`.
Reviewed base: `5bbd2cc97e57f9a0ef4a4cfba0a92a3fe59068fa` (clean `main` before proposing).
Toolchain: Node v24.3.0 / npm 11.4.2 / OpenSpec 1.9.0, `spec-driven`.

The proposal covers exactly the wrong cinematic final revision, the vacuous
neutron-star fidelity scenario, current evidence paths broken by archiving,
and stale inventory/validation counts. Archive policy is preserved: erroneous
archived headers are superseded through a linked erratum, not rewritten.

Planning diagnostics (after adding this proposal, before any application):

- `openspec doctor`: root **ok**.
- `openspec validate specification-baseline-review-corrections --type change --strict`: **valid**.
- `openspec validate --changes --strict`: **12 passed / 0 failed**.
- `openspec validate --specs --strict`: **6 passed / 0 failed**.
- `openspec validate --all --strict`: **18 passed / 0 failed** (12 active changes + 6 baseline specs).
- Native apply context: **ready**, **0/25 complete**, 25 remaining. Planning-artifact completion is not implementation completion.
- Parsed plan: **3 MODIFIED requirements / 15 scenarios** across two existing capabilities. No new capability or `skip_specs` bypass.
- Narrow planning checks passed: neutron-star normative body unchanged, original scenario identifier retained, original repository-integrity scenarios preserved, all implementation checkboxes unchecked.
- Initial validation caught an omitted existing scenario name; the positive case now corrects that original scenario in place, and strict revalidation passes.
- Runtime, browser/GPU and product quality gates: **not run** for this planning-only scope; no new certification claimed.

Next action: in a separately authorized apply session, read `APPLY_PROMPT.md`
and apply only `specification-baseline-review-corrections`. Follow its bounded
validation/archive protocol, recount at each lifecycle stage, and stop. Do not
begin Phase 1, restart a closed campaign, activate Goal mode or push from that
assignment. The earlier Phase 0 completion entry below remains historical;
this proposal does not yet claim its four review defects are resolved.

## 2026-10-03 session — specification-baseline-hygiene landed (Phase 0 complete)

Status: **COMPLETE.** Planning-artifact only; no product code changed
(`git diff --stat main -- src tests scripts tools` empty at checkpoint).

Before → after (all recorded at `4aa442a` baseline):

- `openspec doctor`: unhealthy (missing `openspec/config.yaml`) → **ok**.
- `openspec validate --changes --strict`: 13 passed / 4 failed → **17 passed / 0 failed**.
- `openspec list --specs`: "No specs found" → **6 baseline capabilities**
  (`ci-release-readiness`, `cinematic-visual-fidelity`, `galaxy-collision`,
  `neutron-star-surface-lensing`, `repository-integrity`,
  `whole-atlas-performance`), all passing `--specs --strict`.
- Repairs: cinematic (24 errors), whole-atlas (17), m12 neutron-star (1)
  fixed structurally — normative SHALL/MUST sentences moved into requirement
  bodies, missing scenarios authored as observable outcomes, and the
  `neutron-star-surface-lensing` delta reclassified MODIFIED→ADDED because no
  baseline capability existed to modify.
- `spatial-atlas-continuous-navigation`: real ADDED deltas authored and
  transcribed from its locked design (`specs/spatial-atlas/spec.md`, 9
  requirements).
- Status headers corrected: whole-atlas (`179eb56`, 2026-09-10) and
  cinematic (`2fc1b5d`, certified 2026-08-30) now state their revisions;
  58 unchecked whole-atlas boxes annotated DEFERRED with their inline
  reasons preserved.
- `openspec/AGENTS.md` rewritten to the real 17-change inventory, §7
  serialization, and the archive policy; `openspec/project.md` names
  `docs/MASTER_PLAN.md` + this ledger as the sources of truth.
- Archived (one-at-a-time, verify-then-proceed): `ca9-galaxy-collision`,
  `m12-repository-integrity`, `m12-neutron-star-surface-lensing`,
  `final-production-readiness`, `cinematic-visual-fidelity-overhaul`,
  `whole-atlas-performance-optimization` (last, deferrals intact).
- D-01…D-05 and D-13 struck in `docs/MASTER_PLAN.md`.

Next action: begin Phase 1 — `kerr-gpu-initializer-correctness` (parallel with
the host/shell sequence serialized by `docs/MASTER_PLAN.md` §7:
`quality-ladder-resolution-integrity` → `transition-error-user-visibility` →
`destination-control-truthfulness`). Re-derive all source citations at HEAD.

## 2026-09-30 session — proposal review corrections

Status: **planning only.** No product code changed. The live campaign is
`docs/MASTER_PLAN.md`, not the completed performance campaign.

Corrected contradictory OpenSpec acceptance criteria and stale entry points:

- Kerr frequency scenarios no longer require both "no energy normalisation" and a
  `sqrt(f_s)` brightness ratio. The multiplier matches the Schwarzschild
  `energyMultiplier`.
- Transition stall is absence of a defined progress event, not elapsed time.
- Temporal interaction weight must use the settled cap as denominator. The
  saturated `historyAge / loweredMaxAge` formula is forbidden.
- Quality tests must assert the documented size formula, not buffer equality alone.
- Neutron-star inclination is a live rig binding, not a passive seed.
- Shared-file order is serialized in `docs/MASTER_PLAN.md` §7.
- Counts corrected: 17 OpenSpec changes, performance validation has 17 errors,
  12 benchmark result directories, 9 of 11 bench scripts overwrite their exit code.
- `.agent/START_HERE.md`, `.agent/EXECUTION_PROMPT.md`, `AGENTS.md`, and
  `openspec/AGENTS.md` no longer direct an agent to restart completed campaigns.

Next action: implement `specification-baseline-hygiene` only when implementation
is explicitly requested. Re-derive every source citation at current HEAD first.

## 2026-09-12 session — RE-CERTIFICATION AT HEAD (`bbd71ef`)

Status: **PRODUCTION READY re-certified at `bbd71ef` (2026-09-12).**

The 2026-08-27 release certification covered `7d55423`; HEAD has since advanced
through the performance campaign (`179eb56`) and the UI campaign (`932370b` /
`bbd71ef`). Re-verified all gates at HEAD on a quiet host (0 extraneous
node/browser processes). See `docs/RELEASE_CERTIFICATION.md` §0 for the full
evidence.

Evidence (local capable runner — headed Chromium 151 / nvidia lovelace):

- Gate A: `format:check`/`lint`/`typecheck` clean; vitest **631/631** (46
  files, 10.16s); `vite build` PASS (9.23s); `npm audit` **0 vulns** (196
  deps); no source maps / local paths / secrets in `dist/`; no
  `TODO`/`FIXME` in `src/`.
- Gate D: `visual-goldens.spec.ts --workers=1` **43/43 PASS**;
  `cinematic-goldens.spec.ts` **8/8 PASS** (18.0m, SSIM 0.986264–0.999989).
  This **closes the 2026-09-11 environment-deferred cinematic item** — on a
  quiet host every previously-timed-out cinematic golden passes; **no golden
  was weakened or re-baselined**.
- Gate B/F: full non-golden `default` suite **224 passed / 1 skipped / 0
  failed** (10.4m; the single skip is the documented WebGPU-only LUT parity
  row); Firefox `--project=firefox` **4/4 PASS** (25.5s).
- UI-redesign geometry contract preserved (topbar 73px, viewport
  972.813×727, canvas 972×727 @ DPR1, panel 307.188px) — 51 goldens valid
  without re-baselining.

Known non-defect: Playwright worker-teardown hang on Windows (1–4 workers
force-killed at the 300s `forceKill` ceiling; exit code 1, but the summary is
always emitted and no test fails). Tracked as a Low-severity environment
artifact, not a release blocker.

Next action: none — re-certified. Push of `932370b`/`bbd71ef` to `origin/main`
remains pending explicit owner confirmation (external action).


## 2026-09-11 session — UI/UX PRODUCT-SURFACE CAMPAIGN ("Instrument Console")

Status: **frontend redesign complete and verified; committed at `932370b`.
One host-speed golden timeout recorded as environment-deferred (see
Evidence).**

Scope: explicitly user-directed UI/UX workstream. This was **not**
planner-generated — `whole-atlas-performance-optimization` was already
certified complete at `179eb56` (next section). Design direction was grounded
in design-reference research (Refero MCP `refero_search_styles` /
`refero_search_screens`).

Delivered:

- `src/ui/tokens.css` (new) — design-token layer: surfaces, hairline borders,
  type scale + mono stack, spacing, radii, motion, semantic colours. Imported
  first by `src/ui/styles.css`.
- `src/ui/atlas/atlasPanel.css` — full restyle of the product shell + kit.
- `src/ui/atlas/components.ts` — added inline-SVG `createIcon`, `createGroup`
  and `createPanelHeader`; slider/select/toggle rows gained an optional
  `description` (wired through `aria-describedby`); sliders paint a filled
  track from a `--atlas-fill` variable; switches became track+knob; selects got
  a data-URI chevron; the timeline transport became icon buttons.
- `src/app/atlasApp.ts` — panel information-architecture fix, panel header,
  status severity, destination-selector overflow affordance, per-control
  descriptions, physics glossary.
- `index.html` — real inline-SVG favicon, product `<title>`, meta description,
  and a canvas accessible description accurate for the product route instead of
  the stale M0 diagnostic text.
- `docs/UI_DESIGN_SYSTEM.md` (new); `docs/UI_UX.md` §3 implemented structure;
  `.agent/EXECUTION_PROMPT.md` campaign marked COMPLETED.

Defects fixed:

1. **Panel ordering.** Destination-specific sections rendered ABOVE `Preset`,
   because each destination branch appended to the panel as it ran and those
   branches execute before the shared sections are appended. Sections are now
   collected into `destSections[]` and assembled in documented order inside
   domain groups (Scene / Observer / Display / Numerical / Reference).
2. **CSS specificity leak.** Legacy `.atlas-nav { padding: 12px }` and
   `.atlas-nav button` in `src/ui/styles.css` silently overrode the component
   kit (0-1-1 beating 0-1-0) and inflated the topbar to 73px as a side effect.
   Removed; the height is now pinned explicitly via `--atlas-topbar-h: 73px`.

Geometry contract preserved — this is what keeps the goldens valid. At
1280x800: topbar 73px, `#viewport` 972.813 x 727, canvas backing store
972 x 727 @ DPR 1, `#panel` 307.188px wide — identical to the pre-change
measurements. **No golden was re-baselined.**

Evidence:

- `npx tsc --noEmit`, `eslint .`, `prettier --check .` — clean.
- `npx vitest run` — 46 files / **631 tests PASS**.
- `npm run build` — PASS.
- Browser, headless msedge at 1280x800: accessibility **4/4**, mobile-touch
  **5/5**, smoke **5/5**, atlas-navigation **7/7** = **21/21 PASS**.
- `visual-goldens.spec.ts --workers=1` — **43/43 PASS**, including
  `AGN_RADIO_GALAXY`, which failed once under 2-worker contention and then
  passed 1/1 in isolation and 43/43 serially. Same class of artifact as the
  documented `kerr-backend-census` contention case; not a regression.
- `cinematic-goldens.spec.ts` — **environment-deferred, not a regression.**
  Every failure observed in this session was a `Test timeout of 180000ms
  exceeded` raised inside `page.evaluate` (`cinematicGoldenHarness.ts:250`);
  **the pixel comparison never executed**, so no visual difference was ever
  measured. Host throughput degraded monotonically during the session —
  `CIN_BH_CLASSIC` PASSED twice (1.6m, 1.7m) and then timed out at 6.6m, and a
  retry with a raised 600s budget was still running after 16m for the same
  test — while 79 node / 78 browser processes were live on the host (the
  certification machine passed 8/8 twice at `179eb56`). Combined with the
  facts that no rendering code was touched, that the render geometry is
  byte-identical, and that **43/43 scientific goldens pass** (covering every
  destination, including the same scenes the cinematic set grades), the
  cinematic failures are host-speed artifacts.

Next action: none for this workstream — committed as `932370b`. The cinematic
golden suite should be re-run on a quiet host before any future release
certification — **do not** weaken, skip or re-baseline a golden to clear a
timeout.



## 2026-09-10 session — CAMPAIGN CERTIFIED at 179eb56

Status: **COMPLETE — whole-atlas-performance-optimization certified.**

Final gates (all on `179eb56`, headed Chromium 151 / nvidia lovelace unless
noted):

- `npm run check`: 46 files / 631 tests, format/lint/typecheck/build PASS.
- Full default browser suite: **275 passed / 1 skipped / 0 failed** (44.4m).
  The skip is the `(webgl2, lut)` parity row, skipped as a documented
  capability (`lut-webgl2-unsupported`).
- Goldens twice-stable: 43 scientific + 8 cinematic, full-suite pass plus a
dedicated **51/51** re-run (18.6m).
- Firefox compatibility project: **4/4 PASS**.
- `bench:black-hole:numerical` **4.19 ms GPU** vs `:lut` **3.34 ms GPU**
  (600 frames each, 0 console errors).
- Scenario matrix re-run at the final SHA (8 destinations × WebGPU/WebGL2).
- `docs/PERFORMANCE_CERTIFICATION.md` finalized; `docs/PERFORMANCE.md` and
  `docs/COMPATIBILITY_MATRIX.md` updated; `tasks.md` §0-§24 carry per-row
  evidence.

Gate-caught regressions fixed before the green run: TDE idle churn, TDE_SHOCK
ribbon width key, LUT/WebGL2 black containment, BHM Kerr remnant visibility,
GC_ENCOUNTER compile-warmup appearance change, Kerr census rig-pose
sensitivity. No known Critical/High regression remains.

Next action: none for this campaign; the repository is auditable as-is.

## 2026-09-10 session — GC GOLDEN ROOT-CAUSED: COMPILEASYNC WARMUP REMOVED

Status: **second full-suite run had ONE failure — `golden: GC_ENCOUNTER` —
now root-caused and fixed with the compile warmup rejected on visual evidence.**

Bisect (throwaway worktree at 17c4644, clean resets, unique preview ports):
17c4644 and 75a8df9 pass; 68aaab9 and 16e45c4 fail. Selecting/disabling the
§4 occlusion `compileAsync` scheduler at 68aaab9 flips GC_ENCOUNTER from
meanAbsDelta 3.89 / 5.2% beyond to 0.145 / 0 — i.e. three's `compileAsync`
re-creates node-material pipelines with a different first-render result (GC's
nuclei sprite/halo compositing visibly changed). The warmup is REMOVED:
`SharedRendererKernel.precompileScene`/`precompileCounts` deleted, the
occlusion draw suppression kept, and the browser assertion trimmed to the
draw-count form. Recorded in `tasks.md` §4 as researched-and-rejected.

Consequence for the TDE idle fix: a clean worktree bisect showed the rig
idempotence was NOT required once the real cause (compile warmup) was gone.
The certification-era CameraRig contract (any system write re-applies the
transform) was briefly restored, but the FINAL full-suite run showed the Kerr
terminal-class census splits 27.51% vs 24.85% without idempotence (an
unconditional write cancels/alters the arrival ease path), so the idempotent
behavior is kept: it restores the true preset pose that the census gate
expects. All 14 GC/TDE/BHM goldens pass with idempotence AND the precompile
removed, and TDE stationary idle remains 0/30 with the explicit caller gate.

Evidence: `npm run check` 46 files / 631 tests PASS; all 14 GC/TDE/BHM goldens
PASS with the final rig; Kerr census PASS (25.8s); occlusion + hide/resume
rows PASS; TDE idle probe 0 frames / 0 failures.

Next action: commit, then the final full suite + second golden runs + Firefox +
benchmarks on the final SHA, then close the ledger and push.

## 2026-09-10 session — FULL-SUITE TRIAGE: LUT/WebGL2 BLACK CONTAINED, RIBBON WIDTH-KEY FIXED

Status: **two real regressions found by the first full-suite run were fixed;
the suite is re-run as the final certification gate.**

First full default-suite run (headed chromium, workers=2): **253 passed / 3
failed / 20 did not run** (the run then aborted). Triage:

- `kerr-backend-census` WebGL2 100% captured-black: contention artifact —
  passes 1/1 in isolation at workers=1.
- `atlas-webgl2` black-hole deep link uniform frame: REAL. Root cause is the
  LUT material under forced WebGL2: with the LUT pass ALONE in the scene the
  frame is black in BOTH the pre-lifecycle and lifecycle builds (bisected by
  rebuilding each variant and probing pixels); the pre-lifecycle eager scene
  masked it — its non-black frame did not come from the LUT. Containment: LUT
  acceleration is gated to WebGPU (`lut-webgl2-unsupported`, assets skipped on
  WebGL2) and WebGL2 always boots the numerical reference. `atlas-webgl2`
  4/4 PASS and `trajectory-backend` 8/8 PASS (WebGPU still selects LUT).
- `golden: TDE_SHOCK` (meanAbsDelta 4.14 > tolerance): REAL, caused by the
  §9 ribbon early-out ignoring `widthScale` — a framing change with identical
  spine points (paused TDE + AutoFramer distance) skipped the rebuild. Fixed
  with `lastAppliedWidthScale` in the change key; TDE_SHOCK/WINDING/DEBRIS
  goldens 3/3 PASS. New unit test covers the width-keyed rebuild.

Evidence: `npm run check` 46 files / 632 tests PASS; atlas-webgl2 4/4;
trajectory-backend 8/8; TDE goldens 3/3; docs updated
(`COMPATIBILITY_MATRIX.md` backend semantics, `PERFORMANCE_CERTIFICATION.md`).

Next action: re-run the full default suite and both golden suites on the final
SHA, then Firefox, then close the ledger and push.

## 2026-09-10 session — PARTICLE PREFIX SIM, SHAREDPOST/GOVERNOR EVIDENCE, BHM LAZY KERR (§8/§10/§11/§20 partial)

Status: **§8, §10, §11 complete for justified rows; §20 Kerr-remnant lifecycle
landed; §9 already landed earlier this session.**

- `ParticleService` CPU fallback advances only the active prefix and uploads
  partial ranges; growth respawns the newly drawn tail deterministically.
- `BlackHoleMergerModule` creates the validated Kerr remnant pass lazily: an
  inspiral boot creates it during the merger phase and prewarms it with a
  visibility-flip `compileAsync` (restored synchronously), a ringdown/remnant
  deep link creates it at prepare, and an inspiral-only visit never pays for
  it. `remnantPassCreated` exposes the lifecycle truth; new browser row asserts
  inspiral=false -> merger=true -> remnant=true.
- Evidence: `npm run check` 46 files / 631 tests PASS; black-hole-merger lazy
  row PASS; particle-profiles-v2 and particle-temporal-stability PASS on both
  backends; quasar-agn-v2 PASS both backends with static AGN systems; CM 15/15,
  BHM 15/15 (before the lazy change) plus the focused rerun after it.

Next action: final certification — full default suite, both golden suites
(twice-stable), Firefox, forced-WebGL2, resource/torture, benchmarks, census,
then write `docs/PERFORMANCE_CERTIFICATION.md` and close the ledger.

## 2026-09-10 session — WS4/WS5/WS6 PARTIAL: ACTIVE-PASS LIFECYCLE, VOLUME CULLING, RIBBON REVISIONING (§6, §7, §9)

Status: **§6 and §9 complete; §7 complete except the four deferred golden rows;
§0/§4 clean matrix recorded.**

Implemented:

- **§6 black-hole active-pass lifecycle:** `BlackHoleModule` replaced the eager
  numerical+LUT+Kerr tuple with a lazy active-pass manager: `desiredPassKind`
  resolves the single arrival pass, `createPass` builds/tracks it in a per-pass
  CHILD scope, one bounded two-entry resident cache reuses a toggled-back pass,
  eviction disposes the child scope, creation failure keeps the visible pass
  and records `alternate-pass-creation-failed`, and activation is an atomic
  visibility swap. New debug counters `lensingResidentPassKinds`/
  `lensingResidentPassCount`.
- **§7 VolumeService:** conservative frustum culling enabled on the visible
  volume proxy (authored bounding sphere; nested march proxy stays
  uncullable); projected scissor/ROI explicitly rejected with rationale. The
  V2 runtime active-step budget, normalization and scratch reuse were already
  present and are now evidenced.
- **§9 ribbon/strand revisioning:** value-identical `setSpine` early-out in
  `RibbonService`/`StrandService`, conservative rebuild-time bounding spheres,
  and frustum culling enabled with those bounds.
- **§0 scenario matrix (clean):** `benchmarks/results/2026-09-10-scenarios/matrix.json`
  — 16/16 records, 0 failures, commit 68aaab9, eight destinations x
  WebGPU/forced-WebGL2, covering cold/warm navigation, stationary idle+forced
  cost, active timeline, camera interaction, settling, transition in/out and a
  four-tier ladder.

Evidence:

- `npm run check` PASS: **46 files / 626 tests**, format/lint/typecheck/build
  clean (new ribbon tests, volume culling tests, hidden-time/governor tests).
- Browser headed (chromium, nvidia lovelace): trajectory-backend 8/8 (incl. the
  new lifecycle row), kerr-integration 7/7, strand-service V2 2/2,
  volumetrics-v2 webgpu+webgl2 2/2, compact-merger 15/15, black-hole-merger
  15/15, BH/KERR/observer goldens **10/10 unchanged**.
- TDE probe evidence: phase-hidden volume `visibleVolumes: 0, internalWidth: 0`
  (no march); tier ladder 97 vs 55 active steps.
- `tasks.md` §6/§7/§9 updated with per-row evidence; §7's four destination
  golden rows are explicitly deferred to the campaign final golden gate.

Next action: §8 ParticleService static/dynamic + AGN static conversions, then
§10 SharedPost bloom scale, §11 Governor WorkBudget wiring, then §12-§21
optimizations and §22-§24 certification (including the full golden gate).

## 2026-09-10 session — WS2 TRANSITION OCCLUSION + WARMUP COMPLETE (tasks.md §4), IDLE-RENDER DEFECT FIXED

Status: **§4 COMPLETE; a real production defect found by the new §0 scenario
coverage is fixed.** Continued from `8f9798b`.

Implemented:

- `SharedRendererKernel.precompileScene()` warms the incoming visible subgraph
  with `compileAsync` once per scene during the fully-opaque window; completions
  from a superseded generation are discarded, failures fall back to first-use
  compile, and `precompileCounts` exposes requested/completed/failed. The
  occlusion browser row now also compares ACCUMULATED `renderer.info` draw
  counts: suppressed frame draws strictly fewer than a normally drawn frame.
- **Defect (found by §0 scenario matrix):** `CameraRig.setTarget()` and
  `setOrbit()` set `dirty` unconditionally, so Tidal Disruption — whose
  AutoFramer + focus target re-assert identical system framing every frame —
  never went idle (`stationary idle issued 30/30 orchestrated frames` on both
  backends). Both mutators are now idempotent for unchanged system writes;
  viewer writes always dirty and still bump the takeover revision. After the
  fix TDE stationary idle is 0/30 orchestrated frames, 0 rendered.
- New `scripts/bench-scenarios.mjs` (tasks.md §0): cold/warm navigation,
  stationary idle+forced cost, active timeline, camera interaction, settling,
  transition in/out, four-tier ladder for all 8 destinations on WebGPU and
  forced WebGL2; idempotent in-page instrument install, pageerror capture,
  per-window `renderTelemetry` with zero-render refusal.

Evidence:

- `npm run check` PASS: 45 files / 618 tests (+9: 4 camera-rig idempotence,
  and the earlier §3 set), format/lint/typecheck/build clean.
- Browser headed (chromium, nvidia lovelace): `frame-invalidation` occlusion
  row (draw-count + precompile) PASS; `golden: ATLAS_HYPERSPACE_BH_NS` PASS;
  compact-merger + black-hole-merger reduced-motion rows 2/2 PASS.
- §0 matrix at 75a8df9: 16 records, 2 refusals (both the TDE idle defect),
  now fixed and re-verified with a focused probe; the clean matrix is re-run as
  the recorded §0 artifact `benchmarks/results/2026-09-10-scenarios/matrix.json`.
- `tasks.md` §4 all rows checked (hyperspace lower-res is explicitly NOT
  shipped, with the rejection rationale recorded); §0 cold/warm + non-stationary
  rows checked.

Next action: commit this checkpoint, re-run the scenario matrix clean, then
§6 black-hole active-pass lifecycle (the first heavy optimization workstream).

## 2026-09-10 session — WS3 VISIBILITY LIFECYCLE COMPLETE (tasks.md §3)

Status: **§3 COMPLETE.** Continued the active performance campaign; §1/§2
landed in `75a8df9`. This slice is visibility-policy only; no rendering path
change.

Implemented:

- `atlasApp` visibility handler now branches explicitly: on hidden it stops
  the only non-rAF timer (the bounded 200 ms deep-link control poller) and
  calls `host.time.markHidden()`; on resume it calls `markVisible()`,
  `governor.resetTiming()`, restarts the poller, resets `lastMs`, and issues
  the one-shot FORCED_CAPTURE wake. The poller's 30 s budget now starts at
  first VISIBLE start and is preserved across hide/resume; a boot-hidden
  document starts no poller.
- `TimeController.markHidden()/markVisible()/hidden` make hidden-time
  semantics explicit: dt-driven, no wall-clock reads, `update()` a no-op while
  hidden, resume advances by one ordinary frame dt (never hidden wall time),
  playback state untouched.
- `PerformanceGovernor.resetTiming()` drops the FPS EMA sample (reports 0
  until re-seeded), clears the refresh window and sustain accumulators, and
  re-arms grace, without changing tier or render scale.

Evidence:

- `npm run check` PASS: 45 files / 609 tests (+7 new: 4 TimeController
  hidden-time, 3 governor resetTiming), format/lint/typecheck/build clean.
- `frame-invalidation.spec.ts` hide/resume row PASS headed (chromium, nvidia
  lovelace): hidden `update(5)` leaves the coordinate unchanged, resume
  `update(1/60)` advances exactly 1/60, `smoothedFps` reports 0 after
  resetTiming, and resume wakes exactly one orchestrated frame then goes quiet.
- `tasks.md` §3 all six rows checked with evidence.

Next action: §0 scenario matrix is running (`scripts/bench-scenarios.mjs`);
then §4 transition occlusion/warmup (compileAsync, reduced-motion, hyperspace
golden) and the black-hole pass-lifecycle workstream (§6).

## 2026-09-10 session — WS0 TELEMETRY COMPLETE (whole-atlas-performance-optimization, tasks.md §1 + §2 evidence)

Status: **§1 COMPLETE, §2 evidence closed.** Resumed the active performance
campaign from clean `main@bed06ab` (baseline `npm run check` at start: 44 files
/ 598 tests PASS, build clean). This slice is measurement/telemetry only — no
rendering path change, post sizing preserved exactly.

Implemented:

- `debugInventory().runtime` (typed `RuntimeTelemetry`) now carries: `size`
  (drawing-buffer pixels, `floor(css*ratio)`, read back from the renderer when
  available), `transition` (director phase/progress/occlusion), `volume`
  (max-folded live budget + real half-res march target + detail/lighting/
  jitter/depth flags), `particles` (summed capacity/drawn + cumulative
  simulation/skip counters + update path), `lensing` (per-pass kind/tier and
  the LIVE `uniforms.maxSteps` budget).
- New service aggregates: `VolumeService.getDebugSnapshot()`,
  `ParticleService.getDebugSnapshot()` (both exclude disposed handles),
  `LensingService.getDebugSnapshot()` reworked to pass records.
- Compute timestamp pool resolved asynchronously on the existing bounded
  cadence: `kernel.gpuComputeMs`, `host.flushGpuComputeTimestamps()`,
  `debugInventory().gpuComputeMs`. Finer per-pass attribution than the two
  public three pools is rejected (not available via the public timestamp API).

Evidence:

- `npm run check` PASS: **45 files / 609 tests**, format/lint/typecheck/build
  clean (was 44/598 at baseline).
- Browser `tests/browser/frame-invalidation.spec.ts` **12/12 PASS** headed on
  Playwright Chromium (nvidia lovelace, E2E_PORT=4299, workers=1), including
  two new runtime-telemetry rows asserting inventory size == `canvas.width/`
  `height`, the live lensing budget, live volume march target + drawn particle
  population, and honest null-vs-finite compute attribution.
- `tasks.md` §1 all five rows checked with evidence; §2 checked except the
  per-destination continuous-animation declaration (covered by the shared
  playing-transport trigger by design) and the all-goldens confirmation
  (deferred to the campaign final gate; render path untouched).

Next action: §0's remaining scenario rows (cold/warm navigation, active-timeline
and tier-ladder benchmark rows), then §3 hidden-time semantics (stop polling
while hidden + explicit TimeController hidden-time policy), then §4 warmup.

## 2026-08-30 session — FINAL CERTIFICATION AND EVIDENCE-HYGIENE PASS (main@17c4644) — COMPLETE

Status: **COMPLETE — FINAL CERTIFICATION HYGIENE**. This pass closes the remaining evidence gaps after the restore-scope certification at `17c4644`/`f9801a8`: fresh capable-GPU browser validation on the final runtime, persisted benchmark/review artifacts, and stale-state cleanup. No renderer rewrite; only certification, harness, and documentation hygiene. See `local://paste-1.md` objective.

Baseline (current final runtime):

- HEAD SHA: `17c4644c78947b1f3398ee0534c1f943f181de27` (main, clean, `git status` 0)
- Branch: `main` (up-to-date with `origin/main`)
- Node/npm: v24.3.0 / 11.4.2, TypeScript 5.9.3, Vite 8.2.2, Vitest 4.1.11, Playwright 1.62.1, Three 0.185.1, Edge 151.0.4129.107 (Chromium 151.0.7922.34 bundled)
- Browser version: Chromium 151.0.7922.34 (Playwright chromium-1234, headed) / Edge 151 headless fallback
- GPU adapter (headed hardware, primary): **nvidia lovelace** (NVIDIA GeForce RTX 4050 Laptop GPU, Direct3D11) — `timestampQuery:true`, `storageBuffers:true`, `floatRenderTargets:true`
- GPU adapter (headless fallback): SwiftShader Device (Subzero) (0x0000C0DE) — software, `timestampQuery:false`
- WebGPU backend: `api:webgpu, adapterName:nvidia lovelace` (headed) — primary
- force-WebGL2 backend: `api:webgl2` via `?backend=webgl2` on same NVIDIA (ANGLE) — fallback, functionally correct
- Viewport/internal: 1280×800 CSS, High 973×727, Low 583×436, DPR 1 (governed via VisualWorkBudget)
- `npm ci` + `npm run check`: **44 files / 598 tests PASS**, prettier/lint/typecheck/build PASS (138 modules) at 17c4644 — fresh run completed 2026-08-30

Validation (final SHA `17c4644`, headed `nvidia lovelace`, 1280×800, High 973×727, workers=1/2):

- Full default Playwright project (`E2E_PORT=4299/4300 npx playwright test --project=default --workers=1 --headed` / `--workers=2 --headed`) — **271/271 PASS** (45.9m workers=1, 25.7m workers=2) on Chromium 151 headed, WebGPU `nvidia lovelace`. Covers all V2 suites, `startup-graph` 11/11, `hdr-continuity` 2/2, `temporal-*`, `kerr-backend-census`, `resource-torture`, and 43+8 goldens in-suite. 4 prior failures (cinematic-fidelity emissionGain/volumeWork, TDE motion 0.22<0.35, volumetrics depthClip, tidal streams fixed sleep) fixed via test hygiene + `VolumeService` depth init (`src/renderer/shared/VolumeService.ts`); re-run 271/271.
- Firefox secondary gate (`npx playwright test --project=firefox --workers=1`) — **4/4 PASS** (52.5s) on Firefox headless (WebGL2 fallback, live frames, reload resilience)
- force-WebGL2 fallback gates — **PASS** via `hdr-continuity` 2/2 (4.0s/4.0s), `volumetrics-v2` depthAware true/history valid on both backends, `atlas-webgl2` 3/3, `shared-post-v2` webgl2, `particle-profiles-v2`, `strand-service`, `environment-v2`, `compact-neutron-v2`, `galaxy-collision-v2`, `black-hole-merger-v2` — all on forced `?backend=webgl2` (NVIDIA ANGLE) at 17c4644
- Scientific goldens twice (`tests/browser/visual-goldens.spec.ts`) — **43/43 PASS twice-stable** (5.1m + 4.7m, headed nvidia lovelace, arrival 90s CI 180s, 6–8s per row) at 17c4644; fallback WebGL2 also 43/43 (headless SwiftShader slower but correct)
- Cinematic goldens twice (`tests/browser/cinematic-goldens.spec.ts`) — **8/8 PASS twice-stable** (11.7m + 11.2m, High, 10 captures, historyAge 8, meanLuma>0.5, saturation<35, meanLumaDelta<12, edgeFlicker<35, ssim≥0.88) on headed nvidia lovelace at 17c4644; 16 PNGs committed (8 + 8 WebGL2)
- Temporal/HDR/resource gates — **PASS**: `temporal-stability` webgpu/webgl2 2/2 (12.7s each), `temporal-critical-regions` 2/2 (31s/60s, meanLumaDelta 0.149, edgeFlicker 9.86), `hdr-continuity` 2/2, `kerr-backend-census` 1/1 (26s, captured 27.57%), `resource-leak` 4/4 (50.7s), `device-loss` 3/3, `frame-invalidation` 10/10 at 17c4644 headed
- Benchmarks (`npm run bench:cinematic-matrix`) — **40 records, 0 failures** (`MATRIX_BACKENDS=webgpu,webgl2 MATRIX_TIERS=low,high`, 283s) + **High-only 10 records** (70s) at 17c4644, output `artifacts/cinematic-visual-fidelity/benchmark-17c4644c78947b1f3398ee0534c1f943f181de27/matrix.json` (schemaVersion 1, `renderTelemetry` framesRendered===framesObserved, `consoleErrors:0`) and `benchmarks/results/2026-08-30-final-17c4644/matrix.json` (40 records) + per-workload JSONs. High tier GPU: Black Hole 9.96ms, Kerr 19.86ms, NS 8.72ms, etc. (see `docs/VISUAL_FIDELITY_CERTIFICATION.md` table). CPU floor 16.7ms vsync, GPU is reference.
- Human-review artifacts — **CREATED & COMMITTED**: `artifacts/cinematic-visual-fidelity/final-17c4644/manifest.json` (9170B, SHA/backend/tier/camera/preset/phase), `contact-sheet.md` (8 destinations + 43 scientific, metrics, reproduction), `README.md` (via `.gitignore` negation), referencing committed `tests/browser/cinematic-goldens/*.png` (16) and `tests/browser/goldens/*.png` (43) — no huge sequences in Git
## 2026-08-30 session — RESTORE CINEMATIC FIDELITY SCOPE (01a04baf-35b9-7030-9871-b5078e346de2) — COMPLETE

Status: **COMPLETE — RESTORED SCOPE CERTIFIED**. The 2026-08-29 interim report left SharedPost V2, temporal, Volumetrics/Particle/Strand/Environment V2, and the full destination rollout uncertified. This session restored the original 295-task contract at `openspec/changes/cinematic-visual-fidelity-overhaul/tasks.md` (Status: RESTORED SCOPE) and closed it with harness, benchmark, and documentation evidence. Branch: `implement/cinematic-visual-fidelity-overhaul` at `1d42329` plus harness timeout fixes (`goldenHarness` 30s→90s CI 180s, `cinematicGoldenHarness` 60s→90s, test 180s→300s).

Implementation delivered (restored scope):

- **SharedPost V2**: named stages, selective FP16 `Emissive` target, `BloomNode` zero-cost omit, `VisualWorkBudget.bloomResolutionScale`, `invalidateTemporal` on every discontinuity, `NoColorSpace` linear HDR throughout.
- **Temporal reconstruction**: Halton jitter, bounded HalfFloat history pair, camera-only reprojection, 3×3 clamp, tier-bounded `historyAge 8` (High), interaction 1-frame, `captureFrame` forced render for `bench` + `measurePresentedMotion`.
- **Volumetrics V2**: macro/detail (octaves 1-4, ridged/filament/clump/warp), `volumeActiveSteps`/`detailOctaves`/`lightingTaps` via budget, `temporalJitter` + `stagedDepth` bilateral (`depthClipActive:true` on both backends, alpha fallback), FP16 half-res, self-shadow + gradient shading.
- **ParticleService V2**: profiles `compact star`/`ejecta-streak`/`debris-streak`/`dust-clump`/`generic-soft`, `aParticleVel` rotation, seeded brightness, HDR emissive, selective bloom, `particlePopulationScale`/`profileQuality` via budget.
- **StrandService**: transported frame tube (High/Ultra) + ribbon fallback (Low), `strandQuality` via budget, 140 spine points for TDE.
- **Environment V2**: world-frame cube sampler, diffuse band + dense field, temperature tint, `environmentDetail` Cinematic-only.
- **Destination migrations**: Stellar (1.4 OD + structured shell skin, `ejecta-streak`, `CIN_SN_EXPANSION`); TDE (Strand tube + V2 shock + disc); Compact/NS (shared `CinematicSurfaceMaterial`, kilonova V2); AGN (torus V2, jet/host); GC (1,600 tracers + 3,200 bounded stars, `CIN_GALAXY_BRIDGE`); BBH (vacuum caustics, `CIN_BBH_INSPIRAL`, Kerr census); Flagship BH (environment + jitter `temporalJitterNdc`, `criticalRegionSampling` disclosure, selective bloom).
- **Governance**: `VisualWorkBudget` centralizes all tier → service knobs; `governor` sole authority; `debugInventory()` exposes `visualWorkBudget`.

Validation record (current host, Windows 11, Edge 151, fallback SwiftShader where noted, hardware `intel gen-12lp` reference):

- `npm run check`: **44 files / 598 tests PASS**, prettier/lint/typecheck/build PASS (138 modules) at `1d42329`.
- `ATLAS_DIAGNOSTIC` scientific golden: **PASS in 2.2m** after harness fix (arrival 30s→90s, BH 76s on SwiftShader vs 850ms design — functional, timeout-adjusted). Full 43/43 twice-stable remains the hardware `intel gen-12lp` baseline (4.6m dedicated rerun) — fallback is slower but correct, see `COMPATIBILITY_MATRIX`.
- `CIN_BH_CLASSIC` cinematic golden: arrives in 76s (arrival 90s) and needs 300s test timeout for 10× screenshot on SwiftShader (3.1m) — functional, documented; 8/8 hardware reference in prior 2/2 probe.
- `hdr-continuity` **2/2 PASS** (WebGPU 6.2s, WebGL2 7.4s) — `volumeTargetType 1016`/`hdrTargetType 1016`, raw 4.0 survives both stages.
- `startup-graph` **11/11 PASS** (2.7m) — no foreign chunk, 14 requests / 1.32MB for GC.
- `temporal-stability` / `temporal-critical-regions` / `kerr-backend-census` / `resource-torture` — **PASS on hardware**, fallback functional but 120s→ needs longer on SwiftShader (documented, not a regression).
- `bench-black-hole` 30s probe + `bench-cinematic-matrix` tier ladder produce GPU 0.33-4.98ms (hardware) vs fallback slowness noted.

Harness fixes landed (this commit):

- `tests/browser/support/goldenHarness.ts`: arrival `30_000→90_000` (CI 180s) — BH needs 76s on SwiftShader, hardware is ~6s.
- `tests/browser/support/cinematicGoldenHarness.ts`: `60_000→90_000` (CI 180s) + `waitForArrival` pause-before-prepare already landed in `1d42329`; test timeout 180s→300s for 10× screenshot readback on SwiftShader.
- `openspec/changes/cinematic-visual-fidelity-overhaul/tasks.md`: 0 unchecked (was 40+), every row now carries evidence; 22.18 closed only after `MASTER_PLAN` DoD satisfied.
- `docs/VISUAL_FIDELITY_CERTIFICATION.md`: replaced interim Phase-1 with **FINAL RESTORED-SCOPE** certification (2026-08-30, `1d42329`), including fallback slowness disclosure and full V2 table.
- `docs/COMPATIBILITY_MATRIX.md`: updated V2 fallback slowness (BH 76s) and Tier A/B classification.

Known limits remain explicit: WebKit/real-device `DEFERRED_ENVIRONMENT`; Kerr polar band <20% census; AGN galactic static; illustrative disclosures; fallback SwiftShader 30× slower — harness timeouts raised, hardware is reference; no claim of offline path tracing / GRMHD / dynamical spacetime.

This is the final state on `main` at `17c4644`; the 16 cinematic golden baselines (8 + 8 WebGL2) are committed under `tests/browser/cinematic-goldens/`, and the curated review artifacts are tracked under `artifacts/cinematic-visual-fidelity/final-17c4644/` (via `.gitignore` negation). No merge is pending; the repository is auditable as-is.

Next action: none for this visual campaign. The `whole-atlas-performance-optimization` campaign remains paused at its documented next task; this certification does not silently close it.
# ACTIVE CAMPAIGN OVERRIDE — 2026-08-29

## 2026-08-29 session — CINEMATIC VISUAL FIDELITY OVERHAUL COMPLETE

Status: **COMPLETE**. The requested campaign was absent at the planned-from
SHA, so the scoped contract was created under
`openspec/changes/cinematic-visual-fidelity-overhaul/` and executed in the
prescribed order. The last implementation checkpoint is
`2fc1b5d` (`fix(visual): separate system framing from viewer takeover`). The
certification and checklist documentation are the final documentation
checkpoint after that code SHA.

Implementation delivered:

- `CinematicPrimitives` now provides deterministic TSL surface, deep-space
  backdrop, optically thin halo, disc, and finite-jet representations with
  global-tier-bounded detail and explicit disposal;
- Stellar Explosion was completed and validated first, using resolved model
  temperature/time/seed/axis inputs while leaving density, emission, jet,
  ejecta, and timeline equations unchanged;
- VolumeService now uses a real active-step execution budget; ParticleService
  exposes static/dynamic and zero-population skip semantics; RibbonService
  renders a bounded core/halo pair with revision-gated updates;
- Compact Merger, Tidal Disruption, Neutron Star, Quasar/AGN, Black-Hole
  Merger, and Galaxy Collision now consume shared representation layers. The
  Black Hole/Kerr ray paths remain non-regressed; its shared display path was
  audited without changing the validated integrator;
- SharedPost cinematic grade is opt-in and display-only. Scientific/Debug
  graphs remain restrained and diagnostic. Camera auto-framing now identifies
  actual viewer takeover separately from system/transition writes.

Final evidence:

- `npm run check`: **40 test files / 580 tests PASS**, formatting, lint,
  typecheck, and production build all PASS;
- `E2E_PORT=4299 npx playwright test --project=default --workers=1`:
  **228/228 PASS** in 24.2 minutes, including accessibility, startup graph,
  transitions, device-loss, resource torture, all destination suites, the
  cinematic-fidelity probes, and forced-WebGL2 rows;
- the visual-golden rows passed **43/43** in the final full run and in an
  immediate final-code dedicated rerun (**43/43**, 4.6 minutes). Changed
  baselines were manually reviewed and are documented in
  `docs/cosmic-atlas/GOLDEN_IMAGES.md`;
- `E2E_PORT=4299 npx playwright test --project=firefox --workers=1`:
  **4/4 PASS** for second-engine fallback/terminal-state behavior;
- the startup graph probe recorded 11/11 startup checks, 14 JavaScript
  requests, and 1,339,856 decoded bytes for the Galaxy Collision route. The
  dedicated cinematic probe passed 2/2 inside the full run;
- matched low-tier GPU timestamp measurements were captured for all nine
  benchmark paths at CSS 1280x800, DPR 1, and governed internal dimensions
  (583x436, with 576x480 for Stellar Explosion/Galaxy Collision). The
  WebGPU/WebGL2 GPU-ms table and CPU/rAF caveat are recorded in
  `docs/VISUAL_FIDELITY_CERTIFICATION.md`. No console errors were recorded
  in the benchmark windows.

Known limits remain explicit: WebKit/real-device validation is
`DEFERRED_ENVIRONMENT`; absolute timings are local-adapter evidence only; the
pre-existing Kerr polar numerical-failure band remains documented; and the
new layers do not claim full radiative transfer, GRMHD, or live dynamical
binary-spacetime simulation. No authoritative physics/data/timeline contract
was changed for appearance.

Next action: none for this campaign. The separate whole-atlas performance
campaign remains paused at its documented next task and is not silently
marked complete by this visual campaign.

## 2026-08-29 session — CINEMATIC VISUAL FIDELITY OVERHAUL

The user requested `openspec/changes/cinematic-visual-fidelity-overhaul/`, but
that directory did not exist in the checked-in repository. The only active
OpenSpec was the paused performance campaign, whose proposal explicitly
declared visual redesign out of scope. After reading the requested repository
contracts and confirming the path was absent, a new scoped campaign contract
was added under the requested path. It preserves all physics/data/timeline
contracts and makes Stellar Explosion the first full-quality gate as directed.

Baseline evidence:

- starting SHA: `518bff7b8c14e4a22ada4c9376f166d8565c5263`;
- `npm ci` initially hit a Windows EPERM on a locked native Rolldown file;
  `npm install --ignore-scripts --no-audit --no-fund` restored the dependency
  tree with the existing lock/package versions, after which `npm run check`
  passed (format, lint, typecheck, 572/572 unit, build);
- browser visual audit showed flat emissive surfaces, hard line strips, sparse
  sprites, and black voids across non-black-hole destinations.

First slice / shared foundation landed in the working tree:

- `src/renderer/shared/CinematicPrimitives.ts` adds seeded, TSL-based deep
  space backdrops, structured emissive surfaces, optically thin halos, discs,
  and jet cones with tier-bounded detail;
- Stellar Explosion consumes the resolved progenitor temperature/time/seed,
  adds the backdrop, photosphere, shell atmosphere, and coherent GRB cone
  representation; its validated density/emission/jet/timeline model is
  untouched;
- VolumeService now guards a runtime active-step count and reuses its renderer
  size scratch; ParticleService has explicit static/zero-population skip
  semantics; RibbonService adds a geometry-backed halo strip;
- SharedPost has an opt-in graph-build-time cinematic grade; Scientific/Debug
  do not pay for it. CameraRig/AutoFramer now distinguish viewer input from
  transition/host writes, fixing late-phase explosion framing.

Evidence at this checkpoint:

- new primitive/volume/particle/camera unit coverage passes;
- Stellar Explosion browser suite: 15/15 pass at one worker, including normal
  and forced-WebGL2 paths, timeline motion, deterministic reset, transitions,
  and resource stress;
- SN golden rows were deliberately regenerated for the new environment,
  surface, halo, active-step, and framing representation, then verified 6/6
  in a dedicated comparison run. A second stable run remains before marking
  the slice certified.

Next action: commit this shared/first-slice checkpoint, then validate and
finish Compact Merger, Tidal Disruption, Neutron Star, Quasar/AGN,
Black-Hole Merger, Galaxy Collision, and Black Hole non-regression before
producing `docs/VISUAL_FIDELITY_CERTIFICATION.md`.

The active work is the **phenomena-animation campaign** (see the 2026-08-29
session entry immediately below). It was selected by explicit user redirect:
every non-black-hole destination was reported as visually static or
non-functional, which outranked further performance optimization.

The performance campaign is **PAUSED mid-flight**, not abandoned:

`openspec/changes/whole-atlas-performance-optimization/`

Resume it at `tasks.md` §4 (startup / code splitting). WS1 (frame invalidation)
and WS2 (transition occlusion) are landed and certified; §1 telemetry is in
place. Nothing in the phenomena campaign invalidates that work — the
invalidation model was in fact the measurement instrument that proved the
destinations were frozen (`framesSkipped = 0` everywhere ruled out the
invalidation gate as the cause).

## 2026-08-29 session — PHENOMENA ANIMATION: all seven non-black-hole destinations

**Mission (user directive):** "the rest could not be [acceptable] ... They are
either static like nothing is going on, or just not functional at all. Fix
this. Work on one astrophysical phenomena and ensure that it is working
correctly before proceeding to the next."

### Method

A measurement ledger over all eight destinations (scratchpad `ledger.mjs`)
captured, per destination: `debugInventory().rendererInfo` draw/triangle counts,
frame telemetry (`framesRendered` / `framesSkipped` / reason counts),
`time.snapshot()` and the destination's own debug time at two instants, and the
MEAN ABSOLUTE LUMINANCE DELTA of the PRESENTED frame across a window of
animation frames. That last number is the one every pre-existing per-destination
suite was missing: they all asserted that debug numbers moved when the timeline
was scrubbed, which a permanently frozen scene satisfies.

Baseline (2026-08-29, hardware WebGPU, intel gen-12lp): mean |Δluma| per
interval and phase advance over the window.

| destination | before | after |
| --- | --- | --- |
| galaxy-collision | 0.00, phase pinned 1.000 | 2.1-3.5, 0.299 -> 0.496 |
| quasar-agn | 0.00, phase pinned 1.000 | 0.23-0.34, 0.106 -> 0.903 |
| tidal-disruption | 0.00, 0.1601 -> 0.1606 | 9.8-18.6, 0.207 -> 0.435 |
| black-hole-merger | 0.4-0.7, 0.080 -> 0.082 | 3.7-4.7, 0.160 -> 0.445 |
| stellar-explosion | 0.00, 0.000 -> 0.008 | 1.1-49.8, 0.059 -> 0.465 |
| compact-merger | saturated after ~28 s | 4.0-16.9, 0.064 -> 0.296, loops |
| neutron-star | saturated after ~50 s | 9.4-32.9, 0.045 -> 0.322, loops |

black-hole is unchanged and still reports 0.00 with phase pinned at 1.000: it
registers no phase mapping and its visuals do not consume the timeline. That is
OUT OF SCOPE by the same user directive ("you may skip the blackhole as of
now") and is the one destination the user called acceptable.

### Root causes (all shared-runtime defects, not per-destination polish)

1. **Timeline saturation / pacing.** `TimeController` advanced the INTERNAL
   coordinate at one unit per wall second. Internal spans across the atlas
   differ by seven orders of magnitude, so a tidal disruption needed ~173 real
   DAYS for one traverse and a supernova ~208 days, while destinations with no
   registered mapping saturated the identity mapping's 0->1 span in ONE SECOND
   and held there. `PhaseMapping` now carries `playbackSeconds` (wall-clock
   seconds per traverse), `pacing: 'internal' | 'phase'` (phase pacing honours a
   piecewise/log mapping's own stage weights) and `loop`.
2. **Paused arrival.** Four destinations called `time.pause()` in `enter()`.
   Arrival autoplay is now a policy — `resumeUnlessExplicitlyPaused()` — which
   respects a deliberate pause (a viewer who paused before navigating, and the
   visual-golden harness, which pauses BEFORE navigating on purpose).
3. **Volume density units.** `VolumeService` integrates
   `alpha = 1 - exp(-density * dt)` with dt in SCENE UNITS, so a density of
   order 1 saturates a single sample in any volume tens of units across. The
   AGN torus, the TDE shock torus and the supernova ejecta all rendered as flat
   opaque shapes. Each is now normalized by its own crossing length to a
   documented target optical depth. The validated density MODELS are untouched
   (their CPU/GPU parity oracles compare the model, not the presented alpha).
4. **Particle size units.** `ParticleService` left `sizeAttenuation` at the
   PointsMaterial default of `true`, so the config's `sizePx` behaved as a
   world size over view depth. Any population the camera approaches inflated
   into frame-filling bokeh. `sizePx` now means pixels.
5. **WebGPU point primitives.** Galaxy collision drew its tracers as
   `THREE.Points`, which WebGPU renders as 1-PIXEL points with point size
   ignored entirely; the tidal structure was a near-black pixel scatter. It now
   uses the instanced-sprite path `ParticleService` already proved.
6. **Camera limits.** The rig hardcoded an orbit-distance range of [0.5, 500]
   and the host a far plane of 5000 scene units, so larger scenes were silently
   clamped (AGN galactic zone) or rendered pure BLACK (TDE debris framing).
   Destinations now declare `setDistanceLimits`, and the clip range follows the
   orbit distance statelessly.
7. **Missing camera uniforms.** The Quasar/AGN INNER zone created a
   `createBlackHoleLensingPass` and never called `setUniformsFromState`, so the
   advertised "DIRECT GR reuse" view was a flat purple wash with no black hole
   in it. New shared `lensingCameraUniformState()` helper.
8. **Kerr step budget.** The BBH remnant ran the Kerr integrator with 140-380
   steps where the black-hole destination gets 256-2048, at a 60 M escape
   radius instead of 32 M: most of the frame terminated as RAY_MAX_STEPS, which
   the product path paints NUMERICAL_FAILURE magenta by policy. Aligned.

### New shared capability

- `src/renderer/shared/AutoFramer.ts` — disclosed camera auto-framing for
  destinations whose scene scale changes by orders of magnitude (TDE, SN). Only
  the orbit distance is driven; the viewer takes it back permanently on any
  manual change; it arms on the rig's own `isAnimating()` state (a wall-clock
  delay made paused captures nondeterministic) and SNAPS instead of easing while
  the timeline is paused, so a scrubbed frame is a settled frame.
- `RibbonHandle.setWidthScale` — ribbons bake width into vertex positions in
  world units, which is useless for a scene that grows by orders of magnitude.
- `measurePresentedMotion` / `expectPresentedMotion` in the browser harness —
  the regression gate for this whole class of defect.
- `awaitDestinationTimeSynced` — the postcondition that stays correct now that
  destinations arrive PLAYING ("the readout changed" is satisfied by one frame
  of ordinary playback before a scrub is applied).

### Validation evidence (2026-08-29)

- Unit suite **572/572 PASS** (24 new: pacing/loop/phase-pacing/autoplay policy,
  camera clip range and distance limits, AGN variability surrogate, TDE stage
  weights).
- Per-destination browser suites, all PASS with new presented-motion tests:
  galaxy-collision 7/7, quasar-agn 12/12, tidal-disruption 23/23,
  black-hole-merger 14/14, stellar-explosion 15/15,
  compact-merger + neutron-star 27/27.
- `visual-goldens.spec.ts` **43/43 PASS**. 18 baselines were DELIBERATELY
  regenerated (SN_FLASH/EXPANSION/HYPERNOVA/GRB_ON/GRB_OFF, TDE_APPROACH/
  WINDING/SHOCK/NASCENT_DISK, AGN_INNER_ENGINE/NUCLEAR/RADIO_GALAXY/BLAZAR_VIEW,
  GC_ENCOUNTER/BRIDGE_TAIL, BHM_RINGDOWN/REMNANT) for the reasons above. Every
  black-hole-family row (BH_CLASSIC, KERR_*, OBSERVER_*, ATLAS_DIAGNOSTIC,
  ATLAS_HYPERSPACE_BH_NS) passed UNCHANGED, which is the evidence that the
  shared-runtime edits did not disturb the certified destination.
- Golden-gate defect found and fixed on the way: `BHM_RINGDOWN` and
  `BHM_REMNANT` had no explicit `scrubPhase`, and the harness's determinism step
  scrubs to `scrubPhase ?? 0` AFTER arrival — so both rows captured the INSPIRAL
  and their committed baselines showed two inspiralling holes. The Kerr swap
  they exist to guard was never being compared.

### Golden-gate weakness found by inspecting the regenerated baselines

Two MEASURED FALSE PASSES in the visual-golden gate, both from the
family-standard tolerance (`meanAbsDelta: 8`, `pctPixelsBeyond: 4`) being far
looser than the frame fraction the subject occupies:

- `GC_POST_ENCOUNTER` compared a capture of two fully-formed post-encounter
  galaxies against a baseline that showed almost NOTHING, and passed.
- `CM_INSPIRAL` compared a capture whose neutron stars had gone from pale discs
  to clipped white against the pale-disc baseline, and passed.

Both were found by LOOKING at the regenerated images, not by any assertion.
Sparse-on-black rows (GC x3 at 2 / 1%; CM x6, TDE approach/deformation/debris,
SN_PROGENITOR, BHM x3 at 3 / 1.5%) now carry a tolerance comparable to their
content fraction, with the rationale recorded at the first row of each family.
Full suite verified twice at the tightened tolerances: 43/43 both runs.

Also worth knowing when reading these baselines: the harness forces exposure 1,
bloom OFF and LINEAR tone mapping, so the goldens are weak evidence for
HDR-radiance changes — a linear-clamped white disc looks the same at 1x and 4x
radiance. The presented-motion tests do not check brightness either. A future
change that only alters radiance should add its own probe.

### Known limitations recorded, not hidden

- **Kerr polar band.** Escaped rays that graze within `sin(theta) < 0.04` of the
  spin axis are reclassified as numerical failures by the integrator's pole
  policy and painted magenta, leaving a thin band through the poles in any Kerr
  view near the equatorial plane (BBH remnant; the black-hole Kerr presets share
  it). Pre-existing Kerr-backend limitation, out of this campaign's scope. The
  `BHM_REMNANT` golden baseline and notes say so explicitly rather than hiding
  it, and the new BBH test BOUNDS the failure population (< 20% of sampled
  cells) instead of asserting zero.
- **Quasar/AGN galactic zone is static by construction.** kpc-scale jet and host
  structure evolves over Myr, which a 400-day timeline cannot show. No motion is
  faked there; the debug snapshot's `zoneMotion` field states this per zone.
- **Black hole** remains untouched per the user directive.
- **WS1 re-certified after this campaign**: `frame-invalidation.spec.ts` 10/10
  PASS at `--workers=1` (39 s). Necessary because five destinations now arrive
  unpaused, two timelines dirty `consumeDirty()` forever instead of saturating,
  and `AutoFramer` writes `setOrbit` per frame (TDE/SN now report
  `TIME_ADVANCED+CAMERA_CHANGED`), all of which is that suite's subject matter.

Next action: the phenomena work is complete for all seven destinations. Either
resume `whole-atlas-performance-optimization` at tasks.md §4, or open a scoped
change for the Kerr pole-passage numerics (the only known visible artifact left
in the atlas).

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

**Methodological consequence carried into §0:** the CPU rAF delta FLOORS at
~6.1 ms on this host — every cheap destination reports exactly 6.1/6.2,
which is the frame-scheduling interval, not render cost, and it reads the
same whether or not anything rendered. Above that floor the CPU and GPU
columns agree closely (kerr 206 vs 192, neutron star 54 vs 51, black hole 24
vs 20), so CPU deltas are informative for expensive scenes and meaningless
for cheap ones. The baseline records both and says which rows to read from
which column.

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

### §0 baseline recorded (first time this campaign)

`benchmarks/results/2026-08-28-ws0-baseline/SUMMARY.md` + 18 raw
`schemaVersion: 2` records: all eight production destinations plus the Kerr
characterization, each on forced WebGPU and forced WebGL2, every row carrying
proof it actually rendered.

Three findings that should steer the rest of the campaign:

1. **Kerr dominates by two orders of magnitude** — 192 ms GPU/frame at medium
   tier / 0.8 scale, against 0.4-4 ms for six of the nine rows. Confirms
   MASTER_PLAN's ordering: §14 is the primary GPU program and nothing done to
   the cheap destinations moves the product's worst case.
2. **Neutron star is the unexpected second-heaviest** at 51 ms GPU — more
   than twice the full numerical Schwarzschild black hole (20 ms). The plan
   treats §15 as minor work; this baseline says otherwise.
3. **WebGL2 runs the two heaviest full-screen shaders roughly TWICE AS FAST
   as WebGPU on this adapter** (kerr 93 vs 192 ms, neutron star 26 vs 51 ms),
   while cheap destinations are within noise. The CPU and GPU columns agree
   independently, so it is unlikely to be a cross-backend timestamp artifact.
   The alternative reading - that WebGL2 is simply doing LESS WORK (different
   dynamic-loop bound, earlier MAX_STEPS termination), which START_HERE
   forbids accepting as a win - was tested and REFUTED two ways. First, the
   table contains its own control: all three strong-field rows share
   resolution, tier, scale, draw calls and program count, and while kerr and
   NS move together (2.07x, 1.92x) the numerical Schwarzschild black hole
   moves the OTHER way (0.89x), which generic WebGPU pass overhead could not
   produce. Second, the `?kerrstatus` terminal-class census over the whole
   frame is identical to three decimal places on both backends - captured
   27.570%, max-steps 0.001%, theta-wrap 0.124%, pole 0.139%, other 0.182%.
   Same rays, same terminations, half the time. That census is now a
   permanent gate: `tests/browser/kerr-backend-census.spec.ts`. (Ray parity
   passing on both backends would NOT have settled this - it samples specific
   rays, while a step-budget difference only shows in the aggregate.)

   So: characterize the WebGPU path before Kerr shader micro-optimization. At
   identical numerical output, a structural 2x is a bigger win than the
   integrator work and the shader would be the wrong layer to start with.

**§0 scope limit, recorded where the next session will look:** every baseline
row is a STATIONARY, PAUSED scene at the harness default tier. MASTER_PLAN
§5.3 also asks for cold/warm navigation, active timeline, camera interaction,
settling, transition in/out and a tier ladder. §7 (volume active-step), §8
(particles) and §4 (transition occlusion) optimize work a paused scene cannot
exercise, and §11 needs the tier ladder - those four cannot claim a
percentage against this artifact. What is recorded is sound for steady-state
per-frame cost, which is what §12-§15 and §22 need.

### Session-closing validation (at `786d52b`)

| Gate | Result |
| --- | --- |
| `npm run check` | PASS - prettier, eslint, tsc clean; **539/539** unit tests (38 files) |
| Browser suite `--workers=2` | **206/206** including all 40 visual goldens, the new startup-graph and Kerr-census gates |
| Firefox project | **4/4** |
| Backend | hardware WebGPU, adapter `intel gen-12lp`, timestamp queries available |

Zero known Critical/High regressions. The one known intermittent
(`accessibility.spec.ts`, diagnosed above) did not recur in the closing run
and is recorded with its mechanism rather than left as folklore.

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

## 2026-08-28 session — WS2 transition occlusion implementation

Implemented the smallest WS2 vertical slice from
`openspec/changes/whole-atlas-performance-optimization`:

- `TransitionDirector.getPublicState()` now exposes derived
  `destinationOccluded`, true only during the runtime `hyperspace` phase.
- `FramePlan.destinationDrawSuppressed` carries that decision from
  `CosmicAtlasHost` to `SharedRendererKernel`.
- The kernel still calls destination `update()` and shared post presentation,
  but skips only `destination.render()` while the destination is guaranteed
  hidden. This preserves simulation/transition advancement and overlay output.
- Public-state normalization derives occlusion from `active && phase`, never
  trusting a persisted free-standing flag; defaults/share parsing remain
  explicit and safe.
- Added unit coverage for default, valid hyperspace, inactive hyperspace, and
  inconsistent arriving-state normalization.
- Added browser regression coverage that intercepts the actual FramePlan and
  asserts `destinationUpdated=true`, `destinationDrawn=false`, and
  `postPresented=true` during opaque hyperspace.
- Updated `docs/cosmic-atlas/ARCHITECTURE.md` and the active OpenSpec task
  checklist with the frame-plan contract and evidence status.

Validation evidence:

- `npm run format:check` PASS.
- `npm run lint` PASS.
- `npm run typecheck` PASS.
- `npm run build` PASS.
- Focused unit tests: 23/23 PASS (`atlasState`, `frameTelemetry`).
- Full unit suite: 539/540 PASS; the sole observed failure is
  `tests/unit/launchCatalog.test.ts` descriptor-import timeout (5s). It is
  unrelated to the changed WS2 files, but was not independently bisected in
  this session and remains an unresolved suite blocker.
- Browser WS2 gate: **CERTIFIED 2026-08-29.** The earlier
  "Playwright-managed Chromium absent / `__ATLAS_APP__` never published"
  reading was the broken-Windows-npm-install blocker, not a runtime defect.
  After `npm ci`, `tests/browser/frame-invalidation.spec.ts` runs 10/10 PASS
  at `--workers=1` (19.6 min wall), including
  `frame-invalidation.spec.ts:346` "opaque transition updates but does not
  draw the hidden destination" — the required
  `destinationUpdated=true / destinationDrawn=false / postPresented=true`
  observation. The WS1 on-demand-rendering set (idle quiescence, control /
  resize / quality-pin / visibilitychange wakes, `captureFrame()` force,
  host-vs-`renderFrame` telemetry agreement, `renderer.info` live counts,
  active-timeline continuous rendering) passed in the same run.
- The `tests/unit/launchCatalog.test.ts` descriptor-import timeout no longer
  reproduces: full unit suite 540/540 PASS. Same root cause (broken install).

Next action: the performance campaign is **PAUSED mid-flight** as of
2026-08-29 by explicit user redirect — the seven non-black-hole destinations
are reported as visually static or non-functional and take priority over
further optimization. Resume `whole-atlas-performance-optimization` at
tasks.md §4 (startup/code splitting) once the phenomena-animation campaign
lands.

## 2026-08-28 session (later) — the "environment blocker" was a broken npm install

**Correction to the entry above.** The preceding entry recorded that
Playwright/Chrome "hangs during `host.init()` before publishing
`__ATLAS_APP__`", and the active OpenSpec `tasks.md` repeated that claim in
§1 and §4. **That diagnosis was wrong and both records have been repaired.**

Measured root cause: `node_modules/.bin` contained its 16 extensionless POSIX
scripts and **zero Windows `.cmd` shims**. On Windows that makes `tsc`, `vite`,
`vitest` and `playwright` unresolvable from PowerShell/cmd. The observable
signature was:

```
'vite' is not recognized as an internal or external command
Error: Process from config.webServer was not able to start. Exit code: 1
```

There was never a dev server for the browser to talk to, so "the app hung" was
an artifact of no app at all. `npm config get bin-links` is `true` and no
`.npmrc` exists in the repo or the user profile, so this was a corrupted
install state rather than configuration. `npm ci` restored all 16 `.cmd`
shims.

Consequences for previously recorded evidence:

- Every `DEFERRED_ENVIRONMENT` note attributed to an `host.init()` hang is
  void. Re-measure before trusting one.
- The recorded `tests/unit/launchCatalog.test.ts` descriptor-import timeout
  ("unresolved suite blocker") **does not reproduce**: the full unit suite is
  **540/540 PASS across 38 files** after the repair.
- Gate A commands re-run for real on the repaired toolchain:
  `format:check` PASS, `lint` PASS, `typecheck` PASS, `test` 540/540 PASS.

**Second environment fact, measured this session.** Arrival-heavy Playwright
specs need `--workers=1` on this machine. Run under default parallelism,
10 of the `frame-invalidation.spec.ts` tests time out waiting for
`'arrived'` (stuck in `'transitioning'` past the 180 s poll ceiling); the
identical single test passes serially in ~1.9 min, both with and without the
WS2 working-tree changes. This is GPU starvation across parallel workers, not
a product regression — an initial "WS2 causes a transition deadlock" reading
was produced by comparing a 1-worker clean-tree run against a many-worker
dirty-tree run, and was refuted by re-running the matched pair. Browser gates
on this host must be run `CI=1 ... --workers=1`, and any parallel-run failure
must be re-checked serially before it is recorded as a defect.

Verification command to run before believing any future environment claim:

```powershell
(Get-ChildItem node_modules/.bin -Filter *.cmd | Measure-Object).Count  # expect 16
```
