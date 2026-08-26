# EXECUTION PROMPT — M11 Production Hardening & Release Candidate

Status: COMPLETED
Completed-At: 2026-08-26
Completed-On: local main `2156d46` + closure commit (see `.agent/STATE.md` commit chain)
Planned-From: 6a51389fcd1fa98270eff62ffe119976fd58da97
Planned-At: 2026-08-25T17:34:00+08:00
Target-Branch: main
Campaign-Type: HARDENING
Expected-Scale: substantial autonomous campaign, roughly 8–12 hours when the work and validation justify it; this is a sizing target, not permission to invent work or weaken gates

## Mission

Take `browser-blackhole` from the completed M10 scientific/feature milestone to an evidence-backed **M11 production-hardening release candidate**.

This is not a narrow changed-files review. Treat the application as one integrated system and perform a broad, evidence-driven audit of the full codebase wherever M11 concerns can propagate: renderer lifecycle, capability/fallback decisions, route/destination lifecycle, state/preset restoration, UI/accessibility, input/touch/keyboard behavior, responsive layout, browser automation, asset loading and checksums, provenance/licensing, benchmark tooling, deployment behavior, production build output, and every Cosmic Atlas destination that shares the hardened infrastructure. Trace the effects of fixes across call sites, state schemas, tests, docs, and runtime integration rather than only inspecting the first files that appear related.

The campaign should implement and validate the M11 packet family end-to-end:

- `M11-01` browser matrix;
- `M11-02` mobile/touch/DPR hardening;
- `M11-03` device-loss recovery torture;
- `M11-04` resource leak/reinitialize torture;
- `M11-05` accessibility review;
- `M11-06` asset/provenance/license audit;
- `M11-07` production bundle/HTTPS deployment readiness;
- `M11-08` final benchmark report;
- `M11-09` user-facing physics/about documentation;
- `M11-10` release-candidate full gate.

Before declaring M11 complete, also close the two M10 release-evidence debts that are directly required for truthful release certification:

1. materialize and twice-stabilize the M10 moving-observer golden images if the existing golden workflow/environment supports doing so truthfully; and
2. extend the black-hole benchmark harness so moving observer modes can be driven explicitly and record matched observer-mode benchmark evidence without mislabeling CPU-side rAF deltas as GPU timestamps.

These are release-evidence prerequisites, not a reopening of M10 scientific scope.

The central acceptance principle is `.agent/QUALITY_GATES.md` Gate I: Gates A–H pass or are explicitly documented as user-visible limitations, the production build/deployment path is reproducible, compatibility and benchmark evidence are current, license/provenance is complete, known Critical/High defects are zero, and `.agent/STATE.md` records the release-candidate commit and evidence.

Do not stop because one M11 packet, one browser test, or one bug fix is complete. Continue through the campaign until all implementation-ready M11 work is exhausted and the release-candidate acceptance criteria are satisfied, or until a genuine external/environmental blocker prevents further truthful progress.

---

## Why this is the correct next campaign

Repository evidence at planning time:

- remote `main` is exactly `6a51389fcd1fa98270eff62ffe119976fd58da97` (`docs: close M10 relativistic observer modes with validated closure state`);
- `.agent/STATE.md` marks **M10 COMPLETE** and records zero known Critical/High defects;
- the M10 closure evidence reports `npm run check` PASS, **471/471** unit tests, **142/142** Playwright tests, and **36/36** existing visual goldens;
- M10's new moving-observer presets are implemented but their dedicated committed golden baselines remain release debt;
- M10's benchmark harness still lacks first-class moving-observer selection/phase support, so only the static baseline is recorded;
- CA9 Galaxy Collision is only partially implemented and its next scientific-fidelity step is legitimately blocked on a copy of Toomre & Toomre (1972) needed to transcribe published encounter parameters with citations; do not fabricate those parameters or weaken provenance just to keep an implementation campaign moving;
- `docs/ROADMAP.md` defines M11 Production Hardening and Release after M10;
- `docs/MILESTONE_WORK_PACKETS.md` defines `M11-01..M11-10` as the remaining main black-hole milestone packet family;
- `docs/BACKLOG.md` maps the same release work to `BH-240..BH-244`;
- `.agent/QUALITY_GATES.md` Gate I is explicitly M11-only and requires the cumulative release-readiness proof;
- there are no open GitHub issues or pull requests superseding this campaign at planning time;
- the codebase already has substantial browser coverage and shared renderer infrastructure, so M11 should harden and extend what exists rather than replace stable architecture wholesale.

Under the planner rule "implementation campaigns first, then hardening when implementation-ready work is blocked/exhausted," this is the correct next campaign. CA9 remains preserved as a future implementation campaign once its source blocker is resolved.

---

## Mandatory startup, reconciliation, and repository safety

Before editing implementation files:

1. Read completely and obey, in authority order where applicable:
   - `AGENTS.md`;
   - `.agent/STATE.md`;
   - `.agent/START_HERE.md`;
   - `.agent/EXECUTION_PROTOCOL.md`;
   - `.agent/QUALITY_GATES.md`;
   - `.agent/PLANNER_HANDOFF.md`;
   - this `.agent/EXECUTION_PROMPT.md`;
   - `docs/PRODUCT_SPEC.md`;
   - `docs/ARCHITECTURE.md`;
   - `docs/PHYSICS.md`;
   - `docs/RENDERING_PIPELINE.md`;
   - `docs/PERFORMANCE.md` and `docs/PERFORMANCE_BUDGETS.md`;
   - `docs/TESTING.md`;
   - M11 in `docs/ROADMAP.md`;
   - M11 in `docs/MILESTONE_WORK_PACKETS.md`;
   - release items in `docs/BACKLOG.md`;
   - `docs/STATE_SCHEMA.md` and `docs/UI_CONTROL_CATALOG.md`;
   - relevant Cosmic Atlas architecture, rendering-services, UX, performance-hardware, golden-image, provenance/data-source, and destination-control documents before changing shared infrastructure.
2. Inspect `git status`, current branch, `git log -15`, `origin/main`, recent M10 commits, and any uncommitted/untracked work.
3. Work from `main`. Reconcile carefully with `origin/main` without discarding newer valid work.
4. Reconcile `Planned-From` with reality. If valid commits landed after `6a51389f`, inspect them and adapt this campaign; never reset just to make the prompt's baseline look exact.
5. Never use `git reset --hard`, `git clean`, force-push, shared-history rewrite, branch deletion, or any destructive operation against unknown work.
6. Do not leave the final implementation on a feature branch or detached HEAD. The campaign closes only with intended work on local `main`, safely reconciled and pushed to `origin/main`.
7. Inspect hosted CI/status for the final pushed SHA. If no hosted CI is configured for a gate, state that honestly and use the documented local/browser evidence instead.
8. If the environment cannot execute a required compatibility/device/browser gate, classify it `DEFERRED_ENVIRONMENT`, not PASS, and continue all other implementation-ready work.

### Whole-codebase audit rule

For every defect or hardening change, inspect its system-wide blast radius before closing it. At minimum ask:

- which constructors/services/routes call this path?
- which state/preset schemas serialize or restore it?
- which destinations share the service or renderer kernel?
- which tests exercise only the local function but not the integrated lifecycle?
- does the change alter CPU/GPU parity, backend fallback, resource ownership, or error semantics?
- can repeated enter/leave/reinitialize expose leaks or stale listeners?
- can mobile, high-DPR, hidden-tab, reduced-motion, or unsupported-browser behavior reach a different branch?
- do docs or user-facing claims become inaccurate?

Do not mark a hardening item complete from a single unit test or a plausible screenshot when integration effects remain unexamined.

---

## Behavior that must be preserved

Unless a defect is demonstrated and the fix is validated with corresponding documentation/tests, preserve:

- all M0–M10 black-hole physics conventions, fixtures, numerical classifications, CPU/GPU parity tolerances, LUT semantics, Kerr semantics, observer-mode semantics, and the locked observer/Kerr ADR decisions;
- the M10 static/camera compatibility anchor and existing 36 historical goldens;
- all shipped Cosmic Atlas destinations and their scientific-fidelity disclosures;
- deterministic routing, transitions, cancellation/disposal, share/preset behavior, and canonical state semantics;
- explicit Scientific/Cinematic/Debug separation;
- truthful fallback/unsupported behavior instead of silently swapping to fake physics;
- explicit numerical-failure states instead of hiding failures as shadow/black output;
- current no-telemetry/no-secret requirements for core operation;
- deterministic benchmark/golden metadata and existing provenance/checksum rules;
- WebGPU-preferred architecture and supported WebGL2 fallback behavior where that fallback is actually implemented and validated;
- mobile/desktop behavior that is already correct;
- the CA9 partial work exactly as landed; do not invent source parameters or claim CA9 completion.

Hardening is not permission for broad aesthetic rewrites or unmeasured performance changes.

---

## Explicit non-goals

Do not expand this campaign into:

- CA9 Galaxy Collision parameter transcription without a legitimate source copy and page-level provenance;
- CA9-04+ scientific implementation that depends on blocked source parameters;
- new Cosmic Atlas destinations;
- new black-hole physics models, tilted Kerr, GRMHD, interior-horizon rendering, or a Kerr-Schild migration;
- a general visual redesign;
- dependency churn merely to use newer versions when current pinned versions are not the cause of a concrete problem;
- a framework rewrite;
- server accounts, analytics, telemetry, multiplayer, or cloud backends;
- fake cross-browser claims based only on user-agent emulation;
- fake mobile performance claims based only on a desktop viewport;
- unsupported GPU timing claims when timestamps are unavailable;
- weakening golden thresholds, parity tolerances, validation counts, or scientific disclosures to make the release gate pass.

---

# Workstream 0 — Baseline release audit and evidence ledger

Perform a release-oriented audit before patching. The point is to discover cross-system defects and missing evidence, not to mechanically rerun tests and assume health.

Audit at least these domains:

1. bootstrap/application lifecycle (`src/main.ts`, app setup, renderer initialization, teardown/restart paths);
2. renderer ownership and shared kernels (`src/renderer/*`, capability decisions, resize/DPR, backend creation, post/temporal resources, renderer disposal);
3. Atlas destination lifecycle and shared services (`src/atlas/*`, destination enter/leave, cancellation, time, camera rig, particles/ribbons/volumes, shared renderer handoff);
4. black-hole destination and all shared physics/render hooks affected by capability or lifecycle changes;
5. canonical state, preset import/share/restore, invalid-state handling, schema normalization and backward compatibility;
6. UI/control/status layers on desktop and narrow/mobile layouts;
7. pointer/touch/keyboard interactions and OrbitControls conflicts;
8. browser tests and test-only hooks for gaps where unit coverage masks integration failures;
9. scripts and production build/deployment configuration;
10. assets, generated binaries, data manifests/checksums, licenses/attribution/NOTICE requirements;
11. benchmark/golden infrastructure and the missing M10 observer-mode evidence;
12. docs/About/help/fidelity disclosures against what the runtime actually ships.

Create/update the repository's durable campaign/state evidence using its native `.agent` system. If there is a native campaign ledger/status section, record findings there; do not invent a competing control plane.

Classify findings by severity and evidence:

- Critical: release-blocking crash/security/data-loss/gross scientific falsehood;
- High: major renderer/physics/backend/control failure or hidden numerical failure;
- Medium: meaningful reliability/compatibility/accessibility defect with bounded impact/workaround;
- Low: polish or minor edge behavior.

Critical/High findings discovered in this campaign must be fixed and validated before closure. Fix coherent Medium defects when they materially improve release readiness and fit the campaign. Do not inflate scope with speculative refactors.

### Workstream 0 gate

- baseline HEAD and environment recorded;
- relevant existing gates rerun or intentionally staged for later full-run;
- release audit findings are enumerated with evidence;
- no discovered Critical/High issue is silently deferred;
- the campaign's subsequent workstreams are adapted to actual findings.

---

# Workstream 1 — M10 release-evidence closure: observer goldens + matched benchmarks

M10 scientific implementation is complete; this workstream closes release evidence only.

## 1A. Moving-observer goldens

Inspect `docs/cosmic-atlas/GOLDEN_IMAGES.md`, existing golden test helpers, current 36 committed goldens, and M10 observer presets. If the repository's established golden workflow can create deterministic baselines in the execution environment:

- add committed baselines for the intended M10 observer reference scenes, including circular, flyby and freefall; include the Kerr moving-observer scene if it is defined/available as a deterministic product preset and the existing workflow supports it without inventing a special unshippable state;
- ensure deterministic camera, simulation/proper time, observer parameters, backend, viewport, quality and seed metadata;
- run the golden suite twice from the same clean state and require stability within existing documented policy;
- keep old 36 goldens unchanged unless a real bug fix intentionally changes them and the change is scientifically justified;
- never regenerate expected images merely because a test fails;
- pair visually sensitive changes with numeric/physics probes where appropriate.

If the environment cannot truthfully produce the required backend/hardware golden evidence, record the precise limitation and do not manufacture PNGs from a different path while claiming equivalence.

## 1B. Moving-observer benchmark harness

Extend the existing `scripts/bench-black-hole*.mjs` path using the smallest coherent change so observer mode and deterministic observer phase/epoch can be selected as first-class benchmark inputs rather than only by incidental UI state.

Record matched evidence for at least:

- legacy/static compatibility baseline;
- circular observer;
- flyby observer;
- freefall observer;
- Kerr circular observer if supported by the preset contract.

Requirements:

- same documented viewport/internal size/quality tier where comparison is intended;
- warmup separated from steady-state sampling;
- median plus p95/p99 if the harness/report format supports them or is being hardened to Gate E requirements;
- explicit browser/backend/hardware metadata;
- rAF/frame deltas labeled CPU-side when GPU timestamps are unavailable;
- no inferred GPU milliseconds from CPU timing;
- deterministic observer time/phase;
- benchmark records committed only when they are reproducible and useful rather than transient noise.

Do not tune physics tolerances just to improve benchmark numbers.

### Workstream 1 gate

M10 release evidence is either fully materialized and validated, or any impossible hardware/environment portion is explicitly and narrowly marked `DEFERRED_ENVIRONMENT` with the rest completed.

---

# Workstream 2 — M11-01 browser/fallback compatibility matrix

Turn current browser/backend assumptions into an explicit tested matrix.

Inspect existing `tests/browser/smoke.spec.ts`, `atlas-webgl2.spec.ts`, capability logic, Playwright configuration, renderer initialization and fallback handling. Build the matrix around real supported behavior, not marketing breadth.

At minimum validate/document:

- primary Chromium-family WebGPU path where the environment supports it;
- explicit WebGL2 fallback paths only for destinations/features that genuinely support them;
- unsupported/failed-WebGPU states produce useful visible UI rather than blank canvas or uncaught rejection;
- capability probes cannot leave a half-initialized renderer/service graph;
- browser refresh/reload restores a valid READY/fallback/unsupported state;
- route navigation after a fallback/initialization failure does not leave stale resources;
- feature-gated WebGPU-only functionality remains disabled/truthful on fallback rather than emulated incorrectly.

If Playwright projects for Firefox/WebKit are locally available and the application contract claims support, run them where meaningful. Distinguish three things clearly:

1. actual renderer feature support;
2. browser-engine execution of the surrounding UI/fallback logic;
3. untested hardware/device combinations.

Do not claim WebGPU support merely because a test browser launches.

Create/update a durable compatibility matrix document with browser engine/version, backend, status, environment, limitations, and evidence date.

### Workstream 2 gate

- compatibility matrix is current and reproducible;
- supported and unsupported states are both tested;
- no blank-canvas/uncaught-error path remains for ordinary capability failures;
- cross-browser claims match evidence.

---

# Workstream 3 — M11-02 mobile, touch, responsive and DPR hardening

Audit and test the product as a touch-first narrow viewport as well as desktop.

Cover at least:

- portrait and landscape viewport changes;
- high DPR with internal pixel-density cap preserved;
- zero-size/container-transition recovery;
- touch/pointer input and OrbitControls/panel gesture conflicts;
- control-panel scroll and range/select/button operability without hover;
- minimum practical touch targets for primary controls;
- safe-area/inset behavior if fullscreen/mobile browser chrome affects layout;
- modal/panel focus and dismissal behavior if applicable;
- reduced-motion behavior for transitions where the product already exposes/supports it;
- orientation/resize while a destination is active;
- route changes after repeated mobile interactions;
- hidden/background/resume behavior on a mobile-sized session;
- no accidental page zoom/scroll trapping that makes the simulation unusable;
- text/status readability without requiring devtools.

Use Playwright device descriptors/emulation for layout/input regression coverage, while clearly separating this from real-device GPU/performance certification. If an actual mobile device is not available, do not label emulated desktop GPU timings as mobile performance.

When fixing shared CSS or event handling, rerun desktop navigation/control tests to catch regressions.

### Workstream 3 gate

- mobile/touch/portrait/landscape/high-DPR browser tests exist and pass in the available environment;
- no Critical/High interaction blocker remains;
- performance claims remain environment-truthful;
- desktop behavior remains intact.

---

# Workstream 4 — M11-03 renderer/device-loss recovery torture

Audit capability initialization and renderer ownership around `src/renderer/SharedRendererKernel.ts`, renderer coordinators, destination adapters, and any WebGPU device-loss hooks.

The hardened contract must ensure that a renderer/device failure cannot silently leave the app in a misleading READY state, duplicate a render loop, leak old resources, or continue sending work to a dead generation.

Implement/test, as the existing architecture supports:

- generation/token ownership for renderer instances or equivalent stale-callback rejection;
- explicit transition from READY to recovery/terminal error when a device/backend is lost;
- one bounded recovery attempt when safe and supported, or a truthful terminal user-visible state when automatic recovery is not defensible;
- cancellation of stale async initialization and resource-loader callbacks;
- no duplicate RAF/update loop after recovery;
- no stale resize/input listeners bound to an old renderer;
- no destination continuing to reference disposed renderer resources;
- repeated injected loss/recovery path does not grow active resource/listener counts without bound.

Use deterministic fault injection/test hooks where real GPU device loss cannot be triggered reliably in CI. Fault injection must exercise the same production recovery/state machine, not a fake parallel path.

Do not hide device loss by refreshing the page in tests unless the documented product recovery strategy is explicitly "reload required" and the UI says so.

### Workstream 4 gate

- device-loss/failure path has automated integration coverage;
- stale-generation callbacks are rejected;
- recovery or terminal behavior is explicit and accessible;
- repeated fault cycles do not duplicate render loops/listeners/resources.

---

# Workstream 5 — M11-04 lifecycle/resource-leak and reinitialize torture

Treat every destination and shared service as a resource owner with repeated lifecycle pressure.

Add/extend torture coverage for:

- repeated Atlas launch -> destination enter -> leave -> launch cycles;
- rapid route switching between black hole and multiple other destinations;
- repeated renderer dispose/reinitialize where supported;
- resize observers, RAF loops, DOM listeners, pointer listeners and timers;
- shared particle/ribbon/volume/trajectory services;
- texture/render-target/history/LUT ownership;
- canceled asset/data loads and late callbacks;
- temporal history invalidation on destination switch/reinitialize;
- benchmark/test hooks being removed or replaced cleanly;
- repeated preset/share-state restoration during route changes.

Prefer explicit instrumentation/counters around resource ownership when existing lifecycle tests cannot prove bounded behavior. Keep instrumentation debug/test-only if user-facing telemetry would violate the no-telemetry product boundary.

Use long-enough deterministic cycles to expose accumulation but keep CI/runtime bounded. Record before/after active listener/resource counts or equivalent strong evidence; a process merely not crashing is not sufficient leak proof.

### Workstream 5 gate

- repeated enter/leave/reinit cycles remain bounded;
- no duplicate loops/listeners survive disposal;
- cancellation prevents stale mutations;
- shared-service cleanup is validated across more than one destination.

---

# Workstream 6 — M11-05 accessibility and product-integrity review

Audit the actual DOM/control surface, not only CSS appearance.

Required checks/fixes:

- every actionable control has an accessible name and correct semantic role;
- keyboard users can reach and operate core navigation, presets, time controls, observer controls, and settings without pointer-only traps;
- focus order is coherent and visible;
- disabled/unsupported controls communicate status rather than merely changing color;
- status/error states are exposed in text and do not rely on color alone;
- canvas has a textual explanation/current-state companion outside the bitmap;
- range values/units that matter scientifically are available as text;
- Scientific/Cinematic/Debug distinction remains understandable to assistive-technology users;
- focus does not vanish into a disposed destination/control panel;
- modal/popover-like surfaces, if present, restore focus appropriately;
- mobile touch hardening does not break keyboard/pointer behavior;
- reduced-motion preferences are respected for nonessential transitions where practical without changing physical simulation semantics.

Use automated DOM assertions plus manual/browser inspection where needed. Adding a dedicated accessibility dependency is optional; only do so if it materially improves durable coverage and does not create unnecessary dependency churn.

### Workstream 6 gate

- core product flow is keyboard-operable;
- accessible names/roles/status text are validated;
- no release-blocking accessibility defect remains;
- documentation states any bounded limitations honestly.

---

# Workstream 7 — M11-06 assets, data, licenses and provenance audit

Audit every production-consumed external/adapted asset and dataset plus attribution requirements.

Cover at least:

- package license compatibility for pinned runtime dependencies;
- copied/adapted external code notices;
- LUT assets and their generator/reference provenance;
- Cosmic Atlas reduced binary/data assets and checksums;
- SXS/other cited simulation datasets and required attribution;
- textures/images/fonts if any are externally sourced;
- generated assets whose source recipe/manifest must remain reproducible;
- repository license/NOTICE/About attribution text;
- no API keys, tokens, private URLs, local absolute paths, caches, browser profiles or accidental raw source datasets in production output;
- asset schema/version/checksum validation before runtime trust where the existing architecture requires it.

For CA9, preserve the current documented source boundary: the restricted-three-body engine may remain, but published encounter parameters stay blocked until the legitimate paper source is available. Do not relabel placeholder exercise configuration as published data.

Produce a release-ready provenance/license summary that a future maintainer can verify from the repo alone.

### Workstream 7 gate

- no unknown-provenance production asset remains;
- required notices/attributions are present;
- checksums/schema validation remain intact;
- CA9's blocked source status is truthful;
- no secret/local-machine artifact is bundled.

---

# Workstream 8 — M11-07 production build, bundle and HTTPS/deployment readiness

Audit the production artifact from a fresh install/build perspective.

Required work/evidence:

- fresh lockfile install with supported Node version;
- `npm run check` from clean state;
- inspect production bundle composition and unexpected large chunks/assets;
- ensure source maps/debug hooks/test-only state are not accidentally exposed in a harmful way in production;
- verify relative/base asset paths and route/deep-link behavior for the intended deployment model;
- confirm HTTPS/secure-context requirements for WebGPU and any advanced browser APIs are documented and enforced by deployment guidance;
- confirm cache policy guidance for immutable/versioned assets vs HTML/app shell so releases do not strand stale asset manifests;
- no development server assumptions in runtime code;
- no network dependency required for the core black-hole experience unless explicitly documented;
- failed asset fetch/version mismatch produces a useful bounded state rather than silent scientific corruption;
- production preview smoke test, not only Vite dev-server tests.

Do not introduce a hosting-provider lock-in unless repository docs already select one. If no deployment target is configured, make the artifact and deployment contract provider-neutral and verify through local production preview/HTTPS guidance rather than pretending a live production deployment exists.

### Workstream 8 gate

- reproducible production build succeeds from clean checkout;
- production preview/browser smoke passes;
- secure-context/caching/deep-link requirements are documented;
- no obvious bundle/configuration release blocker remains.

---

# Workstream 9 — M11-08 final benchmark matrix and performance hardening

Build a final report from measured evidence, not a synthetic summary of old numbers.

Use the existing benchmark scripts and `docs/cosmic-atlas/PERFORMANCE_HARDWARE.md`/benchmark matrix. Cover representative shipped workloads that are executable in the current environment, including at minimum:

- black hole numerical path;
- black hole LUT path where supported;
- Kerr path;
- M10 moving-observer scenarios from Workstream 1;
- representative non-black-hole Atlas destinations with existing harnesses (compact merger, tidal disruption, quasar/AGN, black-hole merger) where they are part of release scope.

For each result record:

- commit SHA;
- browser/version;
- backend;
- adapter/hardware when queryable;
- viewport/internal dimensions and effective render scale/DPR;
- quality/preset;
- warmup/sample methodology;
- median and tail statistics available from the harness;
- GPU timestamp only when genuinely supported;
- explicit CPU-side label for rAF/frame deltas otherwise;
- known thermal/background-process limitations.

Audit performance regressions against prior records where comparable. Fix clear regressions when the root cause is understood and the fix does not compromise physics/visual gates. Do not undertake speculative shader micro-optimization solely because M11 mentions optimization.

### Workstream 9 gate

- final benchmark report is current for the release-candidate SHA or a clearly identified immediately preceding implementation SHA with no performance-affecting later changes;
- environment/measurement semantics are explicit;
- no false GPU/mobile/cross-device claim appears;
- major regression findings are fixed or documented as release limitations with severity.

---

# Workstream 10 — M11-09 user-facing physics, About, diagnostics and limitations

Bring documentation/help text into exact agreement with the shipped system.

Audit and update where necessary:

- README getting-started/build/runtime requirements;
- user-facing physics explanation for Schwarzschild, LUT, Kerr and observer modes;
- Scientific/Cinematic/Debug distinction;
- observer-mode domains and the M10 Boyer-Lindquist near-horizon stop-band limitation;
- CPU/GPU timing wording;
- backend/fallback limitations;
- Cosmic Atlas fidelity labels and data provenance;
- known CA8/CA9 limitations;
- compatibility/mobile expectations;
- accessibility/status behavior;
- license/data attribution;
- production deployment requirements;
- troubleshooting for unsupported WebGPU/device-loss/asset-integrity failure.

Any debug panel values shown as "physical" must have a documented definition and unit. Remove or relabel stale wording that overclaims accuracy/support.

### Workstream 10 gate

A user or future maintainer can determine what is direct physics, data-driven, procedural scientific approximation, or cinematic presentation; what browsers/backends are supported; and what known limitations remain without reading implementation code.

---

# Workstream 11 — M11-10 release-candidate cumulative gate

After implementation/hardening changes are complete, run the broadest cumulative validation the environment supports.

## Required local repository gates

At minimum:

- clean dependency install or equivalent clean-lockfile proof when feasible;
- `npm run format:check`;
- `npm run lint`;
- `npm run typecheck`;
- `npm run test` with exact pass count;
- `npm run build`;
- `npm run check` final aggregate from the intended release worktree.

## Required browser/integration gates

- full `npm run e2e` with exact pass count;
- if the previously observed high-worker OOM risk remains, use a stable documented worker count rather than treating infrastructure OOM as an application failure or hiding it;
- compatibility/fallback suite;
- mobile/touch/DPR suite;
- device-loss/fault-injection suite;
- resource/reinitialize torture suite;
- accessibility/core keyboard flow;
- Atlas navigation/lifecycle suite;
- observer-mode suite;
- all existing CPU↔GPU parity suites;
- Kerr integration/parity;
- LUT disk parity;
- visual golden suite, including new M10 observer goldens if materialized;
- repeat golden stability proof where required by workflow;
- production-preview smoke.

## Physics/scientific non-regression gates

Re-run the existing reference/parity suites required by `.agent/QUALITY_GATES.md`; do not assume M11 changes are "only infrastructure" when renderer lifecycle/capability/state fixes can alter scientific execution paths.

## Release condition

The release candidate is not complete unless:

- known Critical defects = 0;
- known High defects = 0;
- all runnable Gates A–H pass;
- every non-runnable required gate is explicitly `DEFERRED_ENVIRONMENT` with scope and reason;
- Gate I is satisfied to the extent allowed by actual evidence;
- no stale ACTIVE campaign text falsely claims unfinished work is complete;
- `.agent/STATE.md` contains the final M11 packet table, exact validation evidence, remaining Medium/Low debt, deferred-environment evidence, benchmark/golden references, compatibility matrix, and next legitimate action;
- user-facing docs match the final implementation.

Do not mark M11 complete merely because `npm run check` is green.

---

## Deep-audit continuation rule

Once all known M11 packet requirements appear complete, perform one final same-domain deep audit across the entire repository for release-critical regressions caused by or exposed by the campaign.

Look specifically for:

- stale alternate initialization paths bypassing new lifecycle guards;
- destinations that share services but lack the new cleanup behavior;
- state restore/import paths that can recreate invalid runtime conditions;
- unsupported/fallback branches that were not exercised by the happy-path tests;
- mobile/keyboard code paths that diverge from pointer desktop behavior;
- docs/test fixtures referring to removed or renamed controls;
- benchmark/golden scripts that select different runtime states than the UI;
- assets referenced outside the audited manifest/provenance chain;
- release-only production build behavior that differs from dev/E2E assumptions.

Fix clearly reproducible Critical/High defects found by this audit and add regression coverage. Fix coherent Medium defects when they are tightly coupled to M11 and low-risk. Do not manufacture unrelated work just to extend the session.

This final audit is mandatory precisely because changed-file-only review is insufficient for shared renderer/application hardening.

---

## Parallel/sub-agent policy

Parallel work is encouraged where ownership boundaries are real. Good independent lanes include:

- compatibility/fallback tests and matrix;
- mobile/touch/accessibility audit;
- asset/provenance/license audit;
- benchmark harness/report work;
- docs/About/deployment guidance;
- lifecycle torture tests that do not simultaneously rewrite the same central renderer modules.

Keep one owner for integration-sensitive modules such as renderer generation/device-loss state, shared renderer kernel, canonical state schema, route lifecycle ownership, and common test hooks. The orchestrating agent must integrate all worker output, inspect cross-effects, and run final cumulative validation itself.

Do not accept sub-agent claims without checking their diffs, tests and interaction with the rest of the codebase.

---

## Implementation quality constraints

- Prefer root-cause fixes over retries/timeouts that only mask races.
- Preserve deterministic behavior wherever tests/goldens/benchmarks depend on it.
- Keep runtime capability/error states explicit and typed rather than stringly patches scattered through UI.
- Keep scientific formulas and physical semantics out of presentation-only code.
- Do not duplicate resource ownership; each disposable object/service needs a clear owner.
- Make asynchronous generation/cancellation boundaries explicit where stale callbacks are possible.
- Do not add polling or global event listeners without lifecycle ownership and disposal.
- Keep production test hooks gated and non-invasive.
- Avoid new dependencies unless they materially improve release readiness and their cost/license is justified.
- Do not suppress console errors that represent real failures merely to green browser tests.
- Do not widen visual/physics tolerances without evidence and documentation.
- Do not auto-update goldens on test failure.
- Do not use fake browser/device metadata in benchmark reports.
- Keep no-telemetry/no-secret product boundaries intact.

---

## Git, commit, push and campaign-state requirements

During implementation, coherent checkpoint commits are allowed and encouraged when they make long-session recovery safer. The final campaign closure must satisfy all of the following:

1. all intended implementation, tests, docs, benchmark/golden records and `.agent/STATE.md` changes are committed;
2. `.agent/EXECUTION_PROMPT.md` is changed from `Status: ACTIVE` to `Status: COMPLETED` only after the acceptance gate genuinely passes; use `Status: BLOCKED` only for a genuine campaign-level blocker that prevents further meaningful implementation, not for one deferred environment check;
3. the final closure commit message is a detailed whole-session handoff, not a terse one-line summary. It should enumerate major workstreams completed, critical defects fixed, validation counts/results, compatibility/benchmark/golden evidence, remaining Medium/Low/deferred limitations, and release-candidate status;
4. reconcile safely with any newer `origin/main` before push; inspect and integrate newer valid work rather than overwriting it;
5. never force-push;
6. finish on local `main`;
7. push all intended commits to `origin/main`;
8. verify local `HEAD` equals `origin/main` after push;
9. verify the worktree is clean;
10. inspect hosted CI/status for the final SHA and record the result in `.agent/STATE.md`; if no applicable hosted checks exist, record that truthfully rather than inventing a pass.

The campaign is not finished while meaningful campaign work exists only locally or on another branch.

---

## Final report required from the executor

At completion, return a concise but information-dense report containing:

- starting SHA and final SHA;
- M11 packet completion table (`M11-01..M11-10`);
- key defects/root causes and fixes;
- M10 observer golden/benchmark closure status;
- exact unit/E2E/golden/parity pass counts;
- compatibility matrix summary;
- mobile/touch/accessibility summary;
- device-loss/resource-torture summary;
- production build/deployment readiness result;
- benchmark report locations and measurement caveats;
- license/provenance audit result;
- remaining Medium/Low issues and any `DEFERRED_ENVIRONMENT` gates;
- confirmation that known Critical/High defects are zero;
- confirmation that local `main == origin/main`, final worktree is clean, and final SHA was pushed;
- hosted CI/status for the final SHA.

If M11 cannot be completed because a genuine blocker remains, report the exact blocker, completed work, evidence, safe repository state, and the smallest next action. Do not describe a blocked campaign as complete.

---

## Stop condition after this campaign

Do not automatically begin CA9 or invent an M12 after M11 closes.

After a successful M11 release-candidate closure, stop and hand off. The next planner pass should re-evaluate whether CA9's Toomre & Toomre source blocker has been resolved and whether any remaining hardening defects justify another campaign. If no implementation-ready work and no meaningful hardening campaign remain, the correct planner outcome is to stop rather than manufacture work.
