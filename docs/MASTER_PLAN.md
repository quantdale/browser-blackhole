# Master Implementation / Completion / Hardening Plan — `browser-blackhole`

Status: **audit-derived execution specification, revised after proposal review.** Prepared from a
read-only audit of product code at `main@dc0b3ba`, then corrected against current source at
`c0ee5f5`. No product code was modified to produce or revise this document.

Audit base: `main@dc0b3ba`. Planning revisions through `c0ee5f5` did not change product code, but
**every cited line must be re-derived at the current HEAD before implementation.** Do not treat an
audit line number as authoritative after the tree moves.

**Instruction precedence for implementation agents:** this document's file-serialization rules in
§7 override any earlier sentence that says lanes inside a phase may run in parallel. The OpenSpec
change artifacts remain the behavioural contracts, including the corrections in this revision.
Audit scope: 567 tracked files — 50,944 LOC `src/`, 22,116 LOC `tests/`, 7,092 LOC `docs/`,
8,289 LOC `scripts/` + `tools/`, 13,396 LOC `openspec/`.
OpenSpec toolchain: `openspec` 1.9.0, `spec-driven` schema.

Executable OpenSpec changes implementing this plan live under `openspec/changes/`. This document
is the canonical **why/what/order** record; the OpenSpec changes are the canonical **behavioural
contracts and task lists**. Where the two disagree, the OpenSpec change artifacts win for behaviour
and this document wins for priority and sequencing.

---

## 1. Executive Summary

### 1.1 What the project is

`browser-blackhole` is a browser-first, client-only relativistic renderer. The shipped product is
**Cosmic Atlas**: a persistent application shell hosting **eight production destinations** plus a
developer-only Diagnostic destination, each a lazily-loaded `PhenomenonModule` behind a single
Three.js `WebGPURenderer` with a truthful WebGL2 fallback.

- Flagship physics is genuine backwards-ray-traced general relativity: a GPU RK4 Schwarzschild
  null-geodesic integrator with a binary64 CPU oracle, a validated precomputed LUT acceleration
  backend, a numerical Kerr backend with signed spin, and a relativistic observer layer
  (static / circular / flyby / free-fall) built on comoving tetrads.
- Every destination declares a fidelity class (`DIRECT` / `DATA_DRIVEN` / `PROCEDURAL_SCIENTIFIC` /
  `CINEMATIC`) and the project treats that label as a contract.
- Delivery is a static `dist/` bundle. No backend, no API keys, no runtime network dependency.

### 1.2 Overall maturity

**High for a research-grade interactive product; uneven at the seams.** The core physics, the
resource-lifecycle discipline, the numerical-failure honesty model, and the scientific disclosure
practice are genuinely strong and rarely matched. The weaknesses are concentrated in four places:

1. **Correctness defects inside the newest, least-tested code paths** (Kerr camera-side
   initialisation, adaptive-quality resolution, two destination controls).
2. **Verification gates that report success without measuring the thing they claim to measure**
   (an un-gated declared tolerance, a golden suite with no absolute content floor, a benchmark
   refusal gate that cannot fail, offline-tool verdicts asserted from a stored JSON file).
3. **Contract drift between the code and the documents that govern it** (the root planning docs,
   the OpenSpec execution contract, the release certification, the deployment contract).
4. **Unbounded or unverified lifecycle surface in shared renderer services** and in the legacy
   diagnostic shell retained beside the product.

### 1.3 Major strengths (preserve these — they are the reason the rest is worth hardening)

- **Fail-loud over fail-fake.** Numerical failures render as explicit magenta with stable integer
  classification codes imported from a single module; they are never painted as the shadow.
- **Reference-first numerical discipline.** Every GPU path has a binary64 CPU oracle and a
  convergence or limit test. `kerrCharacteristics` checks ISCO against published BPT/Fujita vectors
  to 5e-9; `kerrConvergence` is a genuine a*→0 release gate that bounds departure rather than
  demanding spin-independence.
- **Resource ownership is explicit and mostly correct.** `ResourceScope` is idempotent, disposes in
  reverse order, aggregates disposer errors, and every long-lived renderer object is registered.
- **Measurement honesty is a lived rule, not a slogan.** Benchmarks carry `frameCpuMs` *and*
  `frameGpuMs` with an explicit `gpuTimingNote`; CPU and GPU time are never conflated; the hosted CI
  job states in its own comment that green says nothing about WebGPU.
- **A dark defensive surface.** No `TODO`/`FIXME`/`HACK` anywhere in `src/`; no secrets; no
  machine-local paths or source maps in `dist/`; no `innerHTML` on any dynamic value.

### 1.4 Is the primary remaining objective completion, hardening, or stabilisation?

**Feature completion is done.** All M0–M12, CA0–CA9 and the final production-readiness campaign are
recorded complete. Nothing in the roadmap justifies a new destination.

The remaining objective is **hardening and truthfulness**, in this order of weight:

1. Fix confirmed correctness defects in shipped code paths (P0/P1).
2. Make verification gates actually able to fail (P1).
3. Repair contract/documentation drift and the OpenSpec planning substrate (P1).
4. Close lifecycle, performance and operations gaps (P2).
5. Remove a few forms of dead and duplicated surface (P3).

### 1.5 Recommended end state

A repository where: every shipped physics path is correct and gated; every green gate provably
measured what it claims; every document an agent is instructed to read is true; the planning
substrate validates; and CI carries cheap compensating checks for the GPU work it cannot host.

---

## 2. Repository / System Overview

### 2.1 Major subsystems and boundaries

```text
index.html
  └─ src/main.ts                        boot-path selection (?legacy=1 vs /atlas/*)
      ├─ src/app/App.ts                 LEGACY M0 diagnostic shell (see §3.4)
      └─ src/app/atlasApp.ts            PRODUCT shell: topbar + panel + the one rAF loop
          └─ src/atlas/host.ts          CosmicAtlasHost — composition root
              ├─ atlasState.ts          canonical product state + URL/share codec
              ├─ TransitionDirector.ts  preparing→outgoing→hyperspace→arriving state machine
              ├─ NavigationController   selection, route sync, history
              ├─ governor.ts            tier ladder, FPS EMA, hysteresis, WorkBudget
              ├─ TimeController.ts      deterministic timeline
              ├─ ResourceManager.ts     per-destination scopes + bounded LRU
              └─ renderer/SharedRendererKernel.ts   the ONLY WebGPURenderer owner
                  ├─ capabilities.ts    conservative probe (never UA sniffing)
                  ├─ shared/ResourceScope.ts
                  ├─ shared/SharedPost.ts      HDR + bloom + present
                  ├─ shared/TemporalService.ts accumulation + reprojection
                  └─ shared/{Particle,Volume,Ribbon,Strand,FieldLine,Lensing,Trajectory}Service.ts
                      └─ src/phenomena/<destination>/   8 lazy-loaded modules
                          └─ black-hole/  schwarzschildIntegrator, kerr/, lut/, observer/
```

**Architectural boundaries that hold.** One renderer owner. One heavy destination at a time. One
global quality authority. Destinations never touch the host's internals; the host adapts *around*
destinations, never into their physics (CA-ADR-013). The `Phases`/lifecycle contract is
`prepare → enter → (update → render)* → exit → dispose`.

### 2.2 Primary execution flows

- **Boot:** `main.ts` → `atlasApp` → shell DOM → `host.init()` → capability probe → kernel init →
  nine parallel descriptor/preset dynamic imports → registry → routing sync → first intent →
  first `prepare()`.
- **Frame:** `atlasApp` rAF → `host.frame(dt)` → invalidation-mask gate (skip if nothing changed and
  the timeline is paused) → work budget → `kernel.renderFrame(plan)` → `governor.beginFrame` →
  `destination.update` → `destination.render` → temporal resolve → `post.present` →
  `governor.endFrame`.
- **Transition:** intent → director → `prepare()` (lazy chunk load, generation-guarded, abortable) →
  outgoing → hyperspace (occlusion point disposes the outgoing destination) → activate → arriving →
  route commit → idle.
- **Asset integrity:** every runtime asset (LUT family, BBH merger, galaxy collision) is
  structurally validated, byte-length checked and SHA-256 verified before use, fail-closed.

### 2.3 Persistence and external integrations

- No database, no server, no auth, no external service at runtime.
- Offline-only scientific pipeline: `tools/cosmic-data/*.py` reduces pinned third-party sources
  (Zenodo SXS NR record; Toomre & Toomre 1972 via NASA GISS/NTRS) into compact checked binaries under
  `public/data/`. Not required to build or run the app.
- Runtime assets: `public/luts/` (Schwarzschild LUT family, content-addressed directory),
  `public/data/black-hole-merger/`, `public/data/galaxy-collision/`.
- Test hooks read the URL: `?preset=`, `?backend=webgpu|webgl2|unsupported`, `?view=`,
  `?dc=<json>`, `?mode=`, `?rm=`.

### 2.4 Build / test / release structure

| Concern | Mechanism | Where it runs |
| --- | --- | --- |
| Format | `prettier --check .` | CI |
| Lint | `eslint .` (typescript-eslint) | CI |
| Types | `tsc --noEmit`, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | CI |
| Unit | `vitest run` — 46 files, **631 tests** | CI |
| Build | `tsc --noEmit && vite build` | CI |
| Browser smoke | `playwright test tests/browser/smoke.spec.ts` (legacy M0 shell, WebGL2) | CI |
| Behavioural / parity / goldens | 44 further browser specs, 59 golden PNGs, Firefox project | **local capable-runner gate only** |
| Performance | 11 `scripts/bench-*.mjs` harnesses, committed results under `benchmarks/results/` | local |

This split is deliberate and documented: hosted runners have no GPU, so GPU-heavy suites cannot be
stable hosted gates. The cost of that decision is analysed in §4 (V-05, V-06) — it is correct in
principle but currently has no cheap compensating checks.

---

## 3. Current-State Assessment

### 3.1 Complete and healthy

Little or no work required:

- `src/physics/**` — constants, world frame, classification codes. Provenance-documented to the
  CODATA/IAU citation, with anti-regression tests (handedness, poles, unit-vector normalisation).
- `src/phenomena/black-hole/cpuReference.ts` + `schwarzschildIntegrator.ts` numeric contract —
  capture/escape/step policies are explicit, bounded, and shared with the offline LUT generator.
- `src/phenomena/black-hole/lut/{validate,runtime,textures}.ts` — fail-closed manifest/checksum
  validation with a genuine failure taxonomy.
- `src/renderer/shared/ResourceScope.ts` — ownership, idempotence, reverse-order disposal.
- `src/atlas/registry.ts`, `src/atlas/routes.ts` — total functions, never throw at navigation time,
  history-loop-free redirects.
- `tests/unit/{kerrCharacteristics,kerrConvergence,observerFrame,observerPhotonInit,lutGenerate,
  lutPipeline,lutSchema,state,timeController,governor,worldFrame,renderSize}.test.ts` — real,
  load-bearing invariant coverage.
- `dist/` build output — no source maps, no local paths, no secrets.
- CI quality job, `.gitattributes` line-ending policy, `.gitignore` curated-artifact negation.

### 3.2 Implemented but requiring hardening

- **Shared renderer services** (`ParticleService`, `VolumeService`, `StrandService`, `LensingService`)
  work but retain dead handles, lack post-dispose creation guards, or re-upload buffers per frame.
- **Adaptive quality governor** works and is well tested in isolation, but its tier ladder and its
  FPS signal are wired in ways that do not match their own documentation (§4 A-01, A-05).
- **Temporal accumulation** selects the interaction cap, but a saturated `historyAge / maxAge`
  ratio does not reduce blend weight when that cap is lowered (§4 R-01).
- **Browser test suite** — 45 specs with genuinely good non-vacuity discipline in the parity specs,
  but several rows can pass without measuring (§4 V-01…V-07).
- **Benchmark harnesses** — honest measurement, but the refusal gate and argument contract are
  broken in a subset (§4 B-01…B-05).
- **Offline data pipeline** — source-locked and fail-closed, with one silently-ignored parameter
  path and an unusable Python-version gate (§4 O-05, O-06).

### 3.3 Partial

- **Kerr backend.** The integration loop and the CPU reference are correct and mutually consistent;
  the *camera-side* initialisation in the GPU shader is not (§4 Q-01, Q-02, Q-03). The Kerr +
  moving-observer combination has no GPU parity test at all, which is why the defect survived two
  certified campaigns.
- **Spatial Atlas Continuous Navigation** — a complete, well-researched OpenSpec change at **0/123
  tasks**, gated behind a prerequisite campaign that is now itself incomplete. It is planning, not
  product.
- **Whole-atlas performance optimisation** — 188/246 tasks, with 58 remaining boxes that are
  research/prototype/optional items. The deferrals are honest and individually justified; the
  change's own status header is not (§4 D-02).

### 3.4 Missing

- No machine-checkable baseline capability specifications (`openspec/specs/` does not exist).
- No `openspec/config.yaml` — `openspec doctor` reports the root **unhealthy**.
- No committed host configuration satisfying the documented SPA-fallback deployment contract.
- No code-coverage tooling, and no cheap CI check that compensates for the GPU suites that cannot
  run hosted.
- No artifact-freshness gate for the committed offline-tool verdicts.
- No user-visible error surface for destination preparation failure (§4 E-01).

### 3.5 Problematic / defective

Confirmed defects, all reproduced by direct source inspection during this audit:

| Area | Defect |
| --- | --- |
| Kerr GPU | Camera-side `A = (r+a)²` instead of `(r²+a²)²` |
| Kerr GPU | Static `L_z` uses `g_tφ/f_s` instead of the ADR's `g_tφ/√f_s` |
| Kerr GPU | g-factor divides by `|E|` unconditionally, including the static path |
| Adaptive quality | Tier change never re-applies the drawing-buffer size |
| Adaptive quality | Every transition overwrites the user's manual quality mode with `auto` |
| Product UX | Failed destination preparation is console-only; no public error channel exists |
| Product UX | A stalled preparation has no timeout, so a hung data request is an unrecoverable dead end |
| AGN | Torus never renders after a zone change |
| Neutron Star | `observerInclinationDeg` control has no effect on rendering |
| Neutron Star | Preset fidelity note claims no ray-bent limb; the renderer produces one |
| Renderer | `renderScale` is applied twice; the HDR target is sized at `scale²` |
| Test harness | Zero-assertion `tests/unit/__probe.test.ts` in the CI gate |
| Benchmarks | All 9 per-destination harnesses' zero-render refusal cannot fail the process |

### 3.6 Uncertain (requires runtime / external validation)

- Whether the kinetic/perceptual severity of the Kerr camera-side defects manifests in the shipped
  default framing (mechanism is proven from source; magnitude needs a browser run).
- Whether the governor's submit-window FPS EMA actually walks the tier ladder *upward* on a
  GPU-bound machine.
- Whether the scientific golden tolerances are machine-specific fingerprints rather than regression
  detectors.
- Whether the cinematic SSIM threshold is doing independent work alongside the `meanLuma` floor.
- Golden capture-machine provenance for four baseline rows.
- Real-browser bfcache eligibility (documented as UNVERIFIED in the repo itself).

---

## 4. Findings Register

Priority: **P0** corruption/security/catastrophic or release-blocking · **P1** major
correctness/reliability/architecture/product defect · **P2** material hardening ·
**P3** polish. Confidence: `confirmed` = verified in source during this audit; `indicated` = strong
code evidence needing a runtime check; `suspected` = plausible, needs investigation.

Every finding below is implemented by a named OpenSpec change. IDs are stable.

### Q — Physics / numerics (change: `kerr-gpu-initializer-correctness`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| Q-01 | Kerr GPU camera-side Kerr quartic `A` computed as `(r+a)²` instead of `(r²+a²)²` | P0 | resolved | `kerrIntegrator.ts:464` vs `:555`, `reference.ts:215`, `photonInit.ts:282`, `metric.ts:38` |
| Q-02 | Kerr GPU static `L_z` uses `g_tφ/f_s`; ADR and all CPU paths require `g_tφ/√f_s` | P0 | resolved | `kerrIntegrator.ts:486` vs `reference.ts:453`, `docs/KERR_BACKEND_ADR.md:145` |
| Q-03 | Kerr g-factor divides by `\|E\|` unconditionally, diverging from the gated Schwarzschild form | P1 | resolved | `kerrIntegrator.ts` ~700 vs `schwarzschildIntegrator.ts:432-437` |
| Q-04 | LUT capture sentinel is read through a linear filter, so classification is interpolated at `b_c` | P1 | resolved | `lensingGpu.ts:399-405`, `textures.ts:66-69`, `generate.ts:455-461` |
| Q-05 | LUT GPU hard-codes the `x→u` axis mapping; the manifest's `axisX` never reaches the shader | P2 | resolved | `lensingGpu.ts:200-205` vs `lut/domain.ts:20-22` |
| Q-06 | Escape criterion is radius+momentum only; the documented remaining-deflection proxy is dead code | P2 | confirmed | `docs/NUMERICAL_METHODS.md:151` vs `schwarzschild.ts:460-468` (no production caller) |
| Q-07 | Kerr `massRg ≠ 1` mixes `a*` and `a = a*·M` (latent; `massRg` is pinned to 1 today) | P3 | resolved | `kerrIntegrator.ts:458-464` vs `reference.ts:207-213` |
| Q-08 | Physical constants duplicated 4–5× (spin clamp, capture ε, ISCO, `B_CRITICAL_RG`) | P3 | confirmed | `state.ts:152`, `controlState.ts:95`, `characteristics.ts:40`, `kerrIntegrator.ts:160` |

### E — Reliability / error surfacing (change: `transition-error-user-visibility`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| E-01 | Destination preparation failure is console-only; no public error channel exists | P1 | confirmed | `types.ts:942-948` (`TransitionPublicState` has no `error`), `host.ts:499-509`, `atlasApp.ts` never reads it |
| E-02 | The atlas shell's own remediation builder has no callers; the product terminal state is a code + raw message | P1 | confirmed | `hostStatus.ts:497` vs `atlasApp.ts:1227-1235` |
| E-03 | A failed lazy-chunk load (bad deploy / offline) silently reverts with no user explanation | P1 | confirmed | `TransitionDirector.ts:578-581` + `host.ts:499-509` |
| E-04 | Overlay can be left frozen opaque if device loss occurs during `outgoing` | P2 | suspected | `TransitionDirector.renderOverlay` early-returns on null renderer |
| E-05 | A stalled destination preparation never terminates: no prepare timeout exists, so a hung data request leaves the app in `preparing` forever | P1 | confirmed | `TransitionDirector.ts:277` sets only `slowLoadThresholdMs` (900 ms), which merely emits a status event (`:602-610`); the only `abort()` calls are retarget (`:416`), cancel (`:471`) and dispose (`:986`); the loaders pass the signal to `fetch` (`galaxy-collision/loader.ts:74,90`, `black-hole-merger/loader.ts:70,86`) but nothing times it out |

### A — Adaptive quality / rendering authority (change: `quality-ladder-resolution-integrity`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| A-01 | Governor tier change never re-runs `handleResize`, so dynamic resolution is inert | P1 | confirmed | `host.ts:517` vs the only `handleResize` callers (`atlasApp.ts:1106`, `host.ts:568`, `host.ts:1025`) |
| A-02 | Every transition overwrites the user's manual quality mode with `auto` | P1 | confirmed | `host.ts:488` hardcodes `{ baseQualityMode: 'auto' }`; `TransitionDirector.ts:872` |
| A-03 | `runtimeTelemetry().size.renderScale` reports the tier's nominal scale, not the applied one | P1 | confirmed | `host.ts:1215` vs `kernel.effectiveSize()` |
| A-04 | `renderScale` applied twice: the HDR/post target is sized at `css·dpr·scale²` | P1 | confirmed | `SharedRendererKernel.ts:542,555,561` + `SharedPost.ts:173-174` |
| A-05 | Governor FPS EMA measures the CPU submit window, not frame cadence; its own test harness models a different measurement | P1 | indicated | `governor.ts:238-260` called only from `SharedRendererKernel.renderFrame`; `tests/unit/governor.test.ts:6-8,28-32` |
| A-06 | Governor activity clock advances only on rendered frames, so `activityMode` latches at `interaction` while idle | P2 | confirmed | `host.ts:725-730`, `governor.ts:238-262` |
| A-07 | Render-scale table duplicated in `governor.ts` and `visualWorkBudget.ts` | P3 | confirmed | `governor.ts:81-86` vs `visualWorkBudget.ts:11-77` |

### U — Product correctness / control truthfulness (change: `destination-control-truthfulness`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| U-01 | AGN torus never renders after a zone change: `setVisible` is evaluated against a stale `activeZone` | P1 | confirmed | `quasarAgnModule.ts:873` vs the zone machine at `:699-701` and `applyZoneVisibility` at `:864-868` |
| U-02 | Neutron-Star `observerInclinationDeg` never reaches a uniform or transform; it is a passive readout | P1 | confirmed | `neutronStarModule.ts:201,297,627,789,873`; observer direction comes from `getOrbit()` at `:733-742` |
| U-03 | Neutron-Star preset fidelity note claims "no ray-bent limb yet" while the shipped DIRECT path produces one | P1 | confirmed | `neutron-star/presets.ts:47-49`, `physics.ts:24-26` vs `surfaceLensingGpu.ts:513-633` |
| U-04 | `__ATLAS_APP__` test hook ships unguarded in production; exposes forced continuous render, pixel readback and navigation | P1 | confirmed | `atlasApp.ts:1277-1284`, `host.ts:779` |
| U-05 | Share `mode=` overwrites share `e`/`b`/`bs`/`t=` values | P2 | confirmed | `atlasApp.ts:1021-1031` + `host.ts:941-948` |
| U-06 | Deep-linked `dc=` controls are not reflected in the panel for six of eight destinations | P2 | confirmed | `atlasApp.ts:1065-1076` vs `:558-562,778-782,854-857` |
| U-07 | Dynamic-resolution toggle and Render-scale slider mutate one field with no reflection | P2 | confirmed | `atlasApp.ts:518-535` vs `host.ts:1153` |
| U-08 | Timeline rate select permanently displays `0.25x` while the clock runs at `1x`; `setRateLabel` has zero callers | P2 | confirmed | `components.ts:611-617,640-642` vs `TimeController.ts:156` |
| U-09 | Focus is destroyed on every destination switch and on panel rebuilds | P1 | confirmed | `atlasApp.ts:260` (`replaceChildren`), `:363`, signature at `:1185-1190` |
| U-10 | Collapsed mobile drawer stays in the accessibility tree and tab order | P2 | confirmed | `atlasPanel.css:900-908` (`display:block`) vs the comment at `:763` claiming `[hidden]` |
| U-11 | Collapsible regions' `aria-labelledby` points at the region's own id | P3 | confirmed | `components.ts:131-132` vs `UI_DESIGN_SYSTEM.md:73` |
| U-12 | Slider value badges are not programmatically associated with their input | P3 | confirmed | `components.ts:262,269-273` |
| U-13 | `?rm=1` is parsed then discarded; `setReducedMotion` has no external caller | P3 | confirmed | `atlasState.ts:585-591`, `atlasApp.ts:1015-1032` |
| U-14 | FOV slider range (20–120) contradicts the canonical range (10–150) | P3 | confirmed | `atlasApp.ts:415-425` vs `atlasState.ts:50` |
| U-15 | `serializeForUrl` writes `p=`; the route parser reads `?preset=` | P3 | confirmed | `atlasState.ts:434-436` vs `routes.ts:163-176` |
| U-16 | AGN time coordinate is the only one without a finiteness guard | P2 | confirmed | `quasarAgnModule` `update()` vs four sibling modules |
| U-17 | Galaxy-Collision rebuilds and uploads a 3,200-instance cloud in a mode that hides it | P2 | confirmed | `galaxyCollisionModule` `applyPhase()` vs `update()` |
| U-18 | Compact-merger `STAR_TINT` literal 6×10⁵ K silently saturates at the helper's 4×10⁴ K ceiling | P2 | confirmed | `compactMergerModule.ts:109` vs `compact-merger/emission.ts:68` |
| U-19 | Three divergent temperature→linear-RGB implementations | P3 | confirmed | `compact-merger/emission.ts:67`, `stellar-explosion/emission.ts:58`, `neutron-star` local helper |

### R — Renderer services / lifecycle (change: `shared-renderer-service-lifecycle`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| R-01 | Lowering the interaction history cap does not reduce saturated blend weight: `historyAge / loweredMaxAge` remains at the 0.94 ceiling | P1 | confirmed | `TemporalService.ts:232-240,265`; the cap is selected, but the ratio is saturated. Do not “fix” it by dividing accumulated age by the lowered cap |
| R-02 | `StrandService.setQuality` re-uploads the colour buffer every frame and overrides `setVisible(false)` | P1 | confirmed | `StrandService.ts:331-337,343`; called every frame from `host.ts:741` |
| R-03 | `ParticleService` compute dispatch ignores the population throttle (full capacity every frame) | P2 | confirmed | `ParticleService.ts:621` (fixed at build) vs `:838-850` |
| R-04 | `renderer.info` is read as per-frame telemetry but never reset in the Atlas lane | P2 | confirmed | `SharedRendererKernel` `readRendererInfo`; three resets only inside `setAnimationLoop`, which the Atlas never uses |
| R-05 | `LensingService` has no post-dispose creation guard; a pass created after `dispose()` leaks | P2 | confirmed | `LensingService.ts:158-176` vs `RibbonService`/`StrandService` |
| R-06 | `ParticleService`/`VolumeService` retain disposed handles for the page lifetime | P2 | confirmed | `ParticleService.ts:1034,1099-1100`; filtered only at read time |
| R-07 | Present/copy TSL graphs rebuilt every frame (two unconditional `graphKey = null`) | P2 | confirmed | `SharedPost.ts:289-292,319-329,664-735`; `host.ts:713` |
| R-08 | Per-frame debug/allocation churn on the present path | P2 | indicated | `SharedPost.ts:305`, `TemporalService.ts:281,359-392` |
| R-09 | Resize silently clamps to `maxTextureSize` without surfacing the reduction | P3 | confirmed | `SharedRendererKernel.ts:544-547` vs `docs/FAILURE_RECOVERY.md:192` |
| R-10 | `handleResize` is not gated on `deviceLost` | P3 | confirmed | `SharedRendererKernel.ts:526-527` vs `:389-394` |
| R-11 | CPU particle loop indexes velocity at the position stride (correct only while the strides coincide) | P3 | confirmed | `ParticleService.ts:802-804` vs `:270-275` |
| R-12 | Galaxy-Collision loader has no dataset cache; every arrival re-fetches and re-hashes 4.6 MB | P3 | confirmed | `galaxy-collision/loader.ts` vs `black-hole-merger/loader.ts:97` |

### V — Verification integrity (change: `verification-gate-integrity`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| V-01 | `lutEquivalence.test.ts` declares a 5e-3 rad tolerance, computes the error, prints it, and asserts nothing (`void angErr`) | P1 | confirmed | `lutEquivalence.test.ts:12` (header) vs `:178-186` |
| V-02 | Scientific golden suite asserts only a relative delta; no absolute content floor. The harness itself documents two measured false passes | P1 | confirmed | `visual-goldens.spec.ts:18-27` vs `cinematic-goldens.spec.ts:65-78`; `goldenHarness.ts:401-407` |
| V-03 | Several tests can skip every subject and still report passed | P1 | confirmed | `lutEquivalence.test.ts:106,115-116,176`; `kerrReference.test.ts:170,201,205`; `kerrConvergence.test.ts:58` |
| V-04 | The production LUT discovery path (`public/luts/index.json`) is read by no test; every failure returns `null` with no log | P1 | confirmed | `blackHoleDestination.ts:779-785` vs `lutRuntime.test.ts:24-33` |
| V-05 | 44 of 45 browser specs, both golden suites and the Firefox project never run in any CI job | P1 | confirmed | `.github/workflows/ci.yml:52` |
| V-06 | CI smoke can skip 2 of its 5 tests and still exit 0 | P1 | confirmed | `smoke.spec.ts:58,94` |
| V-07 | Offline-tool verdicts are asserted from a committed JSON report; the generator never runs in CI | P1 | confirmed | `ca9Integrator.test.ts:25-31,83`; absent from `ci.yml` |
| V-08 | `tests/unit/__probe.test.ts` is zero-assertion debug scaffolding in the CI gate | P2 | confirmed | whole file |
| V-09 | 8 committed `_WEBGL2` cinematic baselines are unreachable by any documented command | P2 | confirmed | `cinematic-goldens.spec.ts:20-23`; no script sets `CINEMATIC_GOLDEN_BACKEND` |
| V-10 | No code-coverage tooling anywhere | P2 | confirmed | `vite.config.ts:17-20`; `.gitignore:22-23` |
| V-11 | `launchCatalog` completeness guard is a floor over a scan that swallows import errors | P2 | confirmed | `launchCatalog.test.ts:63,84-86,119` |
| V-12 | Capability tests cover 3 of the 6 injection cases `docs/CI_CD.md` §10 requires | P2 | confirmed | `capability.test.ts:4-16` |
| V-13 | `void x;` statements mark computed-and-discarded values in two tests | P3 | confirmed | `lutRuntime.test.ts:255,272` |
| V-14 | `findShippedFamilyDir()` is `readdirSync`-order dependent | P3 | confirmed | `lutRuntime.test.ts:24-33`, `lutEquivalence.test.ts:34-45` |
| V-15 | `lutEquivalence.test.ts` shares mutable state across `it()` blocks via a setup test | P3 | confirmed | `lutEquivalence.test.ts:93-99` |
| V-16 | The two data loaders accept a manifest asset filename that could escape the asset directory; the LUT loader already rejects it | P2 | confirmed | `black-hole-merger/loader.ts:47,85` and `galaxy-collision/loader.ts:43,89` (validate as `typeof string`, interpolate into a fetch URL) vs `lut/validate.ts:170` which rejects `..`, `\` and a leading `/` |
| V-17 | The unit gate is not reliably reproducible: `launchCatalog.test.ts` times out under load (2 of 3 full-suite runs failed during this audit) | **P1** | confirmed | `launchCatalog.test.ts:56-92` sequentially `await import()`s every phenomenon presets/module and destination file, transitively loading the 1 MB `three/webgpu`, in one test against Vitest's default 5000 ms timeout; measured 2.38 s / 5.03 s / 2.41 s standalone and 2 of 3 full-suite failures |

### B — Benchmark harness integrity (change: `benchmark-harness-integrity`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| B-01 | All 9 per-destination harnesses' zero-render refusal cannot fail the process: `process.exit(0)` overwrites `process.exitCode = 1` (9 of 11 `bench-*.mjs` scripts; the 2 orchestrators are correct) | P1 | confirmed | `bench-{black-hole,kerr,neutron-star,compact-merger,tidal-disruption,quasar-agn,stellar-explosion,galaxy-collision,black-hole-merger}.mjs` |
| B-02 | Two harnesses ignore the matrix's pinned viewport and channel while the matrix records the requested values | P1 | confirmed | `bench-stellar-explosion.mjs:41-42`, `bench-galaxy-collision.mjs:41-42` vs `bench-cinematic-matrix.mjs:112-118,168-176` |
| B-03 | 4 of 18 committed baseline rows record `commit: "uncommitted"` | P1 | confirmed | `benchmarks/results/2026-08-28-ws0-baseline/{stellar-explosion,galaxy-collision}-{webgpu,webgl2}.json` |
| B-04 | `bench-black-hole-merger` defaults `--outdir` to a committed historical campaign directory and can overwrite it | P2 | confirmed | `bench-black-hole-merger.mjs:352-355` |
| B-05 | `bench-scenarios.mjs` — the most-cited harness — has no `package.json` script and is absent from the README | P3 | confirmed | `package.json:26-49` |
| B-06 | `bench-scenarios.mjs` overwrites `record.refusal`, losing the first failure reason | P3 | confirmed | `bench-scenarios.mjs:333,345,…` |
| B-07 | `docs/BENCHMARK_MATRIX.md` §11/§12 schema and comparison script are specified but do not exist | P2 | confirmed | `BENCHMARK_MATRIX.md:196-238` vs `benchmarks/` and `scripts/` |

### D — Specification and documentation truthfulness (changes: `specification-baseline-hygiene`, `documentation-truthfulness-realignment`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| D-01 | Four pre-existing OpenSpec changes fail `openspec validate --changes --strict` | P1 | confirmed | At `dc0b3ba`: 3 passed, 4 failed. At `c0ee5f5`: 13 passed, 4 failed. The same four fail: cinematic, whole-atlas performance, neutron-star surface, spatial atlas — RESOLVED 2026-10-03 in the specification-baseline-hygiene checkpoint |
| D-02 | Change status headers say "PLAN ONLY — NO IMPLEMENTATION" while the same folder's `tasks.md` says COMPLETE | P1 | confirmed | `whole-atlas-performance-optimization/proposal.md:4` + `MASTER_PLAN.md:4` vs `tasks.md:1019`; same in `cinematic-visual-fidelity-overhaul` — RESOLVED 2026-10-03 in the specification-baseline-hygiene checkpoint |
| D-03 | OpenSpec execution instructions still need a complete current inventory and archive policy | P1 | confirmed | The completed M12/CA9 order was an active misdirection; an interim correction now forbids re-executing it. Hygiene must still enumerate all 17 changes and write the archive policy — RESOLVED 2026-10-03 in the specification-baseline-hygiene checkpoint |
| D-04 | No `openspec/config.yaml`; `openspec doctor` reports the root unhealthy | P1 | confirmed | `openspec doctor` — RESOLVED 2026-10-03 in the specification-baseline-hygiene checkpoint |
| D-05 | No `openspec/specs/` — five completed changes were never archived, so no capability baseline exists | P1 | confirmed | `openspec list --specs` → "No specs found" — RESOLVED 2026-10-03 in the specification-baseline-hygiene checkpoint |
| D-06 | Root `AGENTS.md` required-reading list points at superseded single-destination docs | P1 | confirmed | `AGENTS.md:5-15` → `docs/PRODUCT_SPEC.md`, `docs/ROADMAP.md`, `docs/BACKLOG.md` |
| D-07 | `docs/RELEASE_CERTIFICATION.md` self-contradicts: 631/46 vs 515/35 for the same gate | P1 | confirmed | lines 39 vs 151 |
| D-08 | `docs/RELEASE_CERTIFICATION.md` claims `npm audit` = 0 vulnerabilities; it now reports 1 high | P1 | confirmed | lines 43/132/156/227 vs `npm audit` |
| D-09 | `docs/CI_CD.md` documents `npm run physics:fixtures`, which does not exist | P2 | confirmed | `CI_CD.md:156` |
| D-10 | `docs/cosmic-atlas/ARCHITECTURE.md` §2 lists a repository layout matching no shipped path | P2 | confirmed | `ARCHITECTURE.md:33-101` |
| D-11 | `docs/PHENOMENA_IMPLEMENTATION.md` §9–§11 describe three expansion destinations that do not exist | P2 | confirmed | `README.md:124` presents the file as current |
| D-12 | `docs/KERR_RESEARCH_PLAN.md` still frames Kerr as deferred | P2 | confirmed | line 3; M9 is complete |
| D-13 | `openspec/project.md` names two different "sources of truth" audit documents | P3 | confirmed | lines 34 vs 79 — RESOLVED 2026-10-03 in the specification-baseline-hygiene checkpoint |
| D-14 | Two galaxy-collision data-source documents carry different identifiers for the same source | P2 | confirmed | `DATA_SOURCES_GALAXY_COLLISION.md:13-16` vs `..._SOURCE_LOCK.md:15-18` |
| D-15 | Two competing control inventories, neither cross-referencing the other | P3 | confirmed | `UI_CONTROL_CATALOG.md:3` vs `cosmic-atlas/DESTINATION_CONTROL_CATALOG.md` |

### O — Operations, supply chain, deployment (change: `operations-and-deployment-readiness`)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| O-01 | No committed host configuration satisfies the documented mandatory SPA-fallback contract | P1 | confirmed | `docs/DEPLOYMENT.md:23-27`; no `_redirects`/`vercel.json`/`404.html` in repo |
| O-02 | `npm audit` reports 1 high-severity advisory (`brace-expansion` 5.0.9, dev-only) with `fixAvailable` | P2 | confirmed | `npm audit --json` |
| O-03 | CI has no `permissions`, `concurrency`, `timeout-minutes`, SHA pinning, dependency review or audit gate | P2 | confirmed | `.github/workflows/ci.yml` |
| O-04 | The BBH reproduction gate cannot run on Python ≥ 3.12 and fails with a bare `ImportError` | P2 | confirmed | `requirements.txt:3`, `reduce_bbh_merger.py:88` |
| O-05 | `restricted_three_body.py` silently ignores `r_in`/`r_out` in the production sampler branch | P2 | confirmed | `restricted_three_body.py:279-283` vs `:812-816` |
| O-06 | No Python version pin for the offline pipeline | P3 | confirmed | no `pyproject.toml`/`.python-version` |
| O-07 | `vite.config.ts` sets no `base`; sub-path hosting breaks silently | P3 | confirmed | `vite.config.ts:4-11` |
| O-08 | `mcp-preflight.mjs` uses `execFileSync(..., {shell: true})` and an over-broad `'~'` path rule | P3 | confirmed | `mcp-preflight.mjs:34-43,136-149` |
| O-09 | Reducer hardcodes `retrievedAt: "2026-08-25"` into a regenerated manifest | P3 | confirmed | `reduce_bbh_merger.py:495` |

### L — Legacy surface (deferred; no current change owns this lane)

| ID | Title | Pri | Conf | Evidence |
| --- | --- | --- | --- | --- |
| L-01 | ~1,900 LOC of M0 legacy shell (two app shells, two state schemas, two renderer lifecycles) retained behind `?legacy=1` | P3 | confirmed | `App.ts`, `state.ts`, `BlackHoleRenderer.ts`, `RenderCoordinator.ts`, `renderSize.ts`, `ResizeController.ts`, `controlPanel.ts`, `statusPanel.ts` |
| L-02 | The shared `src/shaders/diagnostic.ts` imports `DebugViewMode` from the legacy app state — a shared module depends on a legacy module | P3 | confirmed | `shaders/diagnostic.ts:30` |

L-01 and L-02 are **not completion criteria** of `shared-renderer-service-lifecycle` or
`destination-control-truthfulness`. Neither change may remove the legacy shell or retarget
`diagnostic.ts` as a side effect. They remain deferred until a change explicitly owns them.

---

## 5. Target Architecture / Desired End State

The end state is reached by **correcting and hardening the existing architecture, not by rewriting
it.** Every recommendation below preserves an existing strength or an existing contract.

**Correctness.** One authority per physical quantity. The Kerr GPU camera-side initialisation is
derived from the same `characteristics`/`metric` fragments the CPU oracle uses, so it cannot drift
again. A GPU-vs-CPU parity test exists for every reachable parameter combination, including the ones
currently untested (Kerr + moving observer; close-in Kerr camera radii).

**Adaptive quality.** One resolution authority. A tier change and a manual quality pin both reach
the drawing buffer through the same path, and `runtimeTelemetry().size` reports the size actually
applied. The governor's FPS signal is a frame-interval measurement, with CPU submit time retained
as a separate metric. The governor's unit harness and its production wiring measure the same thing.

**Error surfacing.** Every user-visible failure terminates in a state the user can see and act on:
transition failure, asset-load failure, device loss, unsupported backend. `TransitionPublicState`
carries the error. The shell renders remediation copy. `docs/FAILURE_RECOVERY.md` §3 is satisfied by
the product route, not only by the legacy route.

**Control truthfulness.** No control exists that does not affect rendered state; no control displays
a value that disagrees with canonical state; every fidelity note matches the runtime model; share
links round-trip exactly; deep-linked control payloads are reflected in the panel.

**Lifecycle.** Every long-lived service guards post-dispose creation, unlinks disposed handles, and
performs no per-frame work when its inputs are unchanged. Resize, device loss and tier changes are
all explicit transitions with observable state.

**Verification.** A green gate means the stated check ran *and* measured. Declared tolerances are
asserted or explicitly marked measurement-only. Skipped subjects are counted. Cheap CI checks
compensate for the GPU suites hosted CI cannot run: golden-inventory integrity, artifact freshness,
dependency audit, and a documented nightly self-hosted run.

**Planning substrate.** `openspec/config.yaml` exists; `openspec doctor` is healthy; every change
validates under `--strict`; completed changes are archived into `openspec/specs/` so capability
deltas can be written as ADDED/MODIFIED against a real baseline; every document in the required
reading list is true.

**Release criteria.** Gates A–I hold; no open P0/P1; the certification document carries exactly one
authoritative gate table with a commit and a date.

---

## 6. Implementation Roadmap

Phases are ordered by dependency and blast radius, not by size. Phase 0 is mandatory before any
behavioural change.

### Phase 0 — Baseline and safety

**Change: `specification-baseline-hygiene` (documentation-only; no product code).**

Establish the trustworthy planning substrate before anything else, because every later phase's
"completion" is judged against it.

- Add `openspec/config.yaml`; `openspec doctor` reports healthy.
- Repair the four changes that fail `--strict` (move the normative sentence into the requirement
  body; add the missing scenarios; or mark genuinely non-normative items explicitly).
- Give `spatial-atlas-continuous-navigation` real ADDED deltas or an explicit `skip_specs` marker.
- Correct the "PLAN ONLY" status headers on the two implemented changes; annotate the 58 deferred
  boxes with `DEFERRED`/`REJECTED` and the reason so the count is interpretable.
- Rewrite `openspec/AGENTS.md` to describe the real change set and ordering; make `project.md` name
  one sources-of-truth audit document.
- Adopt the archive policy; do not archive until the spec deltas are valid.

**Gate:** `openspec validate --changes --strict` passes for all changes; `openspec doctor` healthy;
each change's declared status matches its task state.

**Bounded follow-up (documentation-only):** `specification-baseline-review-corrections` applies the
Phase 0 review corrections from `docs/SPECIFICATION_BASELINE_CORRECTIONS.md` (wrong cinematic
final revision, vacuous neutron-star fidelity scenario, archived evidence paths, stage-qualified
counts). It landed and was archived 2026-10-03 (`008966a`); it did not re-open Phase 0 and did
not restart any closed campaign.

### Phase 1 — Critical correctness defects

**Changes: `kerr-gpu-initializer-correctness`, then `quality-ladder-resolution-integrity`, then
`transition-error-user-visibility`, then `destination-control-truthfulness`.** Kerr may proceed
in parallel with that host/shell sequence because it does not edit `src/atlas/host.ts`,
`TransitionDirector.ts`, or `src/app/atlasApp.ts`. The other three are one writer at a time, in
that order. See §7.

These are reachable from the shipped product, produce wrong output, and are invisible to the
current test suite. Each lands with the regression test that would have caught it.

1. Fix the Kerr camera-side quartic and `L_z` normalisation; add close-in-radius and
   moving-observer GPU parity rows.
2. Gate the Kerr g-factor by the observer-frequency flag exactly as the Schwarzschild pass does.
3. Add the LUT classification and axis-mapping guards.
4. Fix the AGN torus visibility, the Neutron-Star inclination control, and the fidelity note.
5. Gate `__ATLAS_APP__` behind a dev/test opt-in.
6. Make a tier change and a manual quality pin both re-apply the drawing-buffer size; fix the
   telemetry to report the applied size.

**Gate:** the new parity rows fail before the fix and pass after; the full goldens are unchanged
except where a fix provably corrects a defect (and each such golden change is justified in the
change's `design.md`); the KERR/OBSERVER/AGN/NS goldens pass twice-stable.

### Phase 2 — Failure visibility and renderer lifecycle

**Changes, in order: `transition-error-user-visibility` if it did not land in Phase 1, then
`shared-renderer-service-lifecycle`.** The lifecycle change starts only after both
`quality-ladder-resolution-integrity` and `transition-error-user-visibility` have landed. It does
not own L-01 or L-02.

- Publish transition failure, including a defined progress signal for stall detection, and render
  remediation in the shell.
- Add the post-dispose creation guards and handle unlinking to the shared services.
- Correct the temporal interaction weight without using `historyAge / loweredMaxAge`.
- Gate `handleResize` on device loss; surface the `maxTextureSize` clamp.

**Gate:** a forced preparation rejection produces a visible, accessible error with a recovery
action; the device-loss suite still passes; a create-after-dispose attempt throws for every
service.

### Phase 3 — Verification integrity

**Change: `verification-gate-integrity`.**

This phase is what stops the next campaign from re-introducing defects the same way.

- Assert the declared LUT terminal-direction tolerance, or mark the test explicitly
  measurement-only.
- Add an absolute content floor to the scientific golden suite and a golden-inventory assertion.
- Count compared subjects in every test that can skip them.
- Add a test for the production LUT index resolution path.
- Delete `__probe.test.ts`; resolve the `_WEBGL2` cinematic baselines; add coverage tooling.
- Add the cheap CI compensations: golden inventory, artifact freshness, capability injection table.

**Gate:** deliberately breaking any gated invariant now turns CI red. This is the acceptance test
for the phase.

### Phase 4 — Benchmark and measurement integrity

**Change: `benchmark-harness-integrity`.**

- Fix the exit-code inversion in the nine harnesses; assert `framesRendered > 0` in the matrix
  orchestrator.
- Honour `--channel/--width/--height` everywhere; have the matrix assert child-reported metadata
  matches what it requested.
- Re-run the four unattributable baseline rows at a pinned SHA and annotate the historical ones.
- Implement the `BENCHMARK_MATRIX.md` §11/§12 schema and comparison gate.

**Gate:** a neutered renderer makes every harness exit non-zero; a non-default matrix environment
produces rows that report the environment actually used.

### Phase 5 — Operations, supply chain, deployment

**Change: `operations-and-deployment-readiness`; `documentation-truthfulness-realignment`.**

- Ship a reference SPA-fallback host configuration and a deep-link test against a plain static
  server; document the sub-path/`base` assumption.
- Add CI `permissions`, `concurrency`, `timeout-minutes`, SHA pinning, dependency review and an
  audit gate; remediate the `brace-expansion` advisory.
- Pin the Python toolchain; fix the `r_in`/`r_out` defect and add a self-check; guard the `sxs`
  import failure.
- Realign the documentation set: mark superseded docs, fix the certification contradictions, add
  the missing script or remove its documentation, correct `ARCHITECTURE.md` §2, reconcile the two
  data-source documents.

**Gate:** `npm audit --audit-level=high` is green; the certification document has one authoritative
gate table; a deep link works against a plain static server with the committed config.

### Phase 6 — Final certification

Run the full §8 gate matrix on a quiet capable runner; re-certify; archive completed OpenSpec
changes into `openspec/specs/`; update `.agent/STATE.md` with the release commit and evidence.

---

## 7. Workstreams and file serialization

Independent file ownership may proceed concurrently. **Shared files are strictly serialized.** An
earlier sentence that says everything inside a phase can run in parallel is withdrawn.

| Order | Change | Exclusive files while it is active |
| --- | --- | --- |
| 0 | `specification-baseline-hygiene` | `openspec/**`, `openspec/AGENTS.md`, `openspec/project.md` |
| 1a, parallel with 1b–1d | `kerr-gpu-initializer-correctness` | `src/phenomena/black-hole/{kerr,lut,observer}/**`, Kerr/LUT parity specs |
| 1b | `quality-ladder-resolution-integrity` | `src/atlas/host.ts`, `src/atlas/TransitionDirector.ts`, `src/renderer/SharedRendererKernel.ts`, `src/renderer/shared/SharedPost.ts` |
| 1c, after 1b | `transition-error-user-visibility` | those same host/director files, plus `src/atlas/types.ts` and `src/app/atlasApp.ts` |
| 1d, after 1c | `destination-control-truthfulness` | `src/app/atlasApp.ts`, `src/ui/**`, destination modules |
| 2, after 1b and 1c | `shared-renderer-service-lifecycle` | `src/atlas/host.ts`, `src/renderer/SharedRendererKernel.ts`, `src/renderer/shared/**` |
| 3, after 1–2 | `verification-gate-integrity` | `tests/**`, `playwright.config.ts`, `.github/workflows/ci.yml` |
| 4, after 3 | `benchmark-harness-integrity` | `scripts/bench-*.mjs`, `benchmarks/**`; CI only after verification releases it |
| 5a, after 4 | `operations-and-deployment-readiness` | `.github/**`, deployment config, `tools/cosmic-data/**`, `vite.config.ts` |
| 5b, after 5a | `documentation-truthfulness-realignment` | `docs/**`, root `AGENTS.md`, certification docs |

### Rules

1. **One writer for `src/atlas/host.ts`, `TransitionDirector.ts`, `SharedRendererKernel.ts`, and
   `SharedPost.ts`.** Quality, transition, and lifecycle all edit those files. They run in the
   order above, never concurrently and never as an informal “coordinate with B”.
2. **One writer for `src/app/atlasApp.ts`.** Transition lands its error surface first.
   Destination-control work starts only after that change has landed.
3. **One writer for `.github/workflows/ci.yml`.** Verification, then benchmark, then operations,
   then documentation. Do not edit it from two changes at once.
4. **Shader physics remain single-owner.** Kerr may run beside the host sequence only while it
   stays inside its exclusive files.
5. **Goldens are evidence, not a negotiation.** A golden may change only after the physical change
   it reflects is independently validated, and every golden change must be justified in the owning
   change's `design.md`.
6. **`.agent/STATE.md` and `docs/RELEASE_CERTIFICATION.md` are written by the integrating agent**
   when a change closes. Lanes report evidence; they do not rewrite certification history.
7. **L-01 and L-02 are deferred.** No current change removes the legacy shell or retargets
   `src/shaders/diagnostic.ts`.

Phase 3 must not start before Phases 1–2: a verification change written against defective code
would encode the defect as expected behaviour. Phase 4 must not start before Phase 3.

---

## 8. Definition of Done

The repository is complete and hardened when **all** of the following are true and demonstrable.
No clause is satisfied by assertion.

### Functionality and correctness
1. Zero open P0 and P1 findings from §4.
2. Every reachable physics parameter combination has a GPU-vs-CPU-reference parity row that runs in
   a gate — explicitly including Kerr + moving observer and close-in Kerr camera radii.
3. Every user-visible control demonstrably changes rendered state or canonical state, and every
   displayed value equals the canonical value.
4. Every destination's fidelity label matches its runtime model; no user-facing note contradicts
   the implementation.
5. Destination preparation failure, asset-load failure, device loss and unsupported backend each
   produce a visible, accessible, actionable state with remediation copy.
6. A destination preparation that stalls terminates in a user-visible failure with a recovery action;
   a slow but progressing preparation is reported as in progress and is not aborted.

### Tests and verification
7. `npm run test` is green and every test either asserts or is explicitly marked as
   measurement-only.
8. No test can report passed having skipped every subject; subject counts are asserted.
9. Every tolerance declared in a test header is asserted.
10. The scientific golden suite has an absolute content floor and a golden-inventory assertion.
11. The production LUT index resolution path is covered by a test that runs in CI, and every
    runtime asset loader rejects an asset reference that could escape its asset directory.
12. Coverage tooling is configured and its summary is recorded, with no global threshold that
    contradicts the deliberate browser-only coverage of `src/shaders/*` and the DOM shells.
13. Committed offline-tool artifacts have a freshness gate, or are explicitly annotated as
    commit-unattributable.
14. No zero-assertion test file remains in the gate.
15. The unit gate is deterministic: five consecutive runs on a quiet host at the same revision
    produce an identical result, and no test's outcome depends on host timing.

### Build, lint, types
16. `npm ci && npm run check` is green from a fresh checkout at a pinned Node version.
17. `dist/` contains no source maps, no machine-local paths and no secrets.

### Security and supply chain
18. `npm audit --audit-level=high` is clean, or every remaining advisory is recorded with its scope,
    its justification, an owner and a review date.
19. The CI workflow declares `permissions`, `concurrency` and `timeout-minutes`; actions are pinned
    to immutable references with a mechanism that keeps them current.
20. Test/debug hooks are not reachable in a production build without an explicit opt-in.
21. No secrets, no required API keys, no unknown-provenance runtime asset.

### Performance and resources
22. A tier change demonstrably changes the drawing buffer, and telemetry reports the applied size.
23. The governor's unit harness and its production wiring measure the same quantity.
24. Every long-lived service guards post-dispose creation and unlinks disposed handles.
25. No per-frame buffer upload or TSL graph rebuild occurs on a settled, unchanged frame.
26. A resource-leak suite shows bounded residency across repeated destination switching.

### Reliability and lifecycle
27. Device loss is terminal, visible, and no renderer work is attempted after it.
28. Prepare/abort/dispose races are covered: no double dispose, no post-disposal mutation.
29. A stalled preparation terminates visibly; the case is covered by an automated test.
30. The documented deployment contract is exercised by a test against a real static server.

### Documentation
31. `openspec/config.yaml` exists; `openspec doctor` reports healthy.
32. `openspec validate --changes --strict` passes for every change.
33. Every document in the root `AGENTS.md` required-reading list is true of the current code.
34. Every command named in any document exists in the project's command surface.
35. The release certification has exactly one authoritative gate table with a commit and a date,
    and its `npm audit` claim is current.

### CI/CD and release
36. Cheap compensating checks run in hosted CI for the GPU work it cannot host: golden inventory,
    artifact freshness, dependency audit, capability injection table.
37. A documented self-hosted/capable-runner procedure exists for the full suite, and its most recent
    result is recorded.
38. A release can be produced and served from a fresh checkout with the committed host
    configuration.

### Repository state
39. Working tree clean; no generated caches, browser profiles, benchmark dumps or secrets tracked.
40. `.agent/STATE.md` records the release commit, the evidence, and the exact deferred items with
    their reasons.

---

## 9. Instructions for the Implementation Agent

1. **Read this document in full before changing code**, then read the OpenSpec change you are
   assigned. The change artifacts are the behavioural contract; this document is the priority and
   ordering record.
2. **Verify repository state first.** Record `git status --short`, `git rev-parse HEAD`,
   `node --version`, `npm --version`. If the tree is not clean, stop and reconcile before starting.
3. **Do not blindly trust this plan or an audit line number.** Findings were derived at
   `dc0b3ba`; this revision was checked at `c0ee5f5`. Re-derive the cited symbol against current
   source before editing. If the code has moved, reconcile the difference; do not silently choose
   the plan.
4. **Execute prerequisite work first.** Phase 0 gates every other phase. Within a phase, respect
   the lane ownership table in §7 and never take ownership of another lane's files.
5. **Preserve working functionality.** The physics contracts, the fidelity labels, the
   fail-loud rendering model, the resource-scope discipline, the golden baselines and the
   measurement-honesty rules are the reason the repository is worth hardening. Change behaviour only
   where a change artifact explicitly says to, and record why.
6. **Write the failing test first**, for every finding that has an automatable correctness
   criterion. A fix without a regression test that fails before and passes after is not complete.
7. **Never weaken an assertion, widen a tolerance, lower an integration budget, disable a test, or
   re-baseline a golden to make a gate pass.** If a gate is genuinely wrong, change it in its own
   change artifact with the reasoning recorded, not as a side effect.
8. **A golden may change only after the physical or behavioural change it reflects is
   independently validated**, and every golden change must be justified in the owning change's
   `design.md` with before/after evidence.
9. **Never conflate CPU/rAF timing with GPU timestamp timing**, and never report a performance
   number without matched machine, config, internal resolution, backend, quality and iteration
   metadata.
10. **Do not mark a task complete without satisfying its acceptance criteria.** An unchecked box
    with a `DEFERRED` annotation and a reason is honest; a checked box without evidence is not.
11. **Surface newly discovered high-impact defects** rather than absorbing them silently. Add them
    to the findings register in this document with an ID, evidence and priority, and raise a new
    change if they do not belong to an existing one.
12. **Keep the repository clean.** No generated artifacts, no caches, no browser profiles, no
    benchmark dumps, no secrets. One coherent concern per commit.
13. **Do not implement `spatial-atlas-continuous-navigation`.** It is a deliberate 0/123 product
    design, gated behind prerequisites, and is out of scope for hardening. Do not restart
    M0–M12, CA0–CA9, or the final production-readiness campaign; all are complete.
14. **Update this document as you go.** When a finding is fixed, struck out with its resolution
    commit. When an assumption is invalidated, correct it. This document must remain an accurate
    map at all times, because the next agent will rely on it.
15. **Run the full gate matrix in §8 before declaring the repository hardened**, then perform a
    final repository-wide certification pass and record the result in `.agent/STATE.md`.

---

## Appendix A — Audit method and coverage

**Diagnostics run by the auditor (all read-only, all green at the audit base):**

| Command | Result |
| --- | --- |
| `npm run format:check` | PASS — all files Prettier-clean |
| `npm run lint` (eslint) | PASS, 29.7 s |
| `npm run typecheck` (`tsc --noEmit`) | PASS |
| `npx vitest run` | PASS — 46 files, 631 tests, 8.2 s — **but not reliably reproducible; see V-17** |
| `npm audit` | **1 high-severity advisory** (see D-08/O-02) |
| `openspec validate --changes --strict` | **3 passed, 4 failed at audit time** (see D-01). Re-review at `c0ee5f5`: **13 passed, 4 failed**; the same four historical changes fail |
| `openspec doctor` | **unhealthy** — missing `openspec/config.yaml` (see D-04) |
| `openspec list` | 188/246, 0/123, five unarchived "complete" changes |

No build, Playwright/e2e or GPU work was performed; those require a capable runner and are out of
scope for a read-only planning campaign.

**Subsystem coverage.** `src/app/**`, `src/atlas/**` (19 files), `src/renderer/**` (19 files),
`src/phenomena/**` (8 destinations), `src/physics/**`, `src/shaders/**`, `src/ui/**`, `tests/**`
(46 unit + 45 browser + 4 harnesses), `scripts/**` (14), `tools/**` (9), `public/**`, `docs/**`
(77), `.agent/**`, `openspec/**`, `.github/workflows/ci.yml`, and the build/config/tooling files
were all read directly or analysed structurally, plus targeted symbol-level tracing across module
boundaries (host ↔ director ↔ kernel ↔ services ↔ destinations; loaders ↔ assets; harness ↔ CI).

**Not covered.** `dist/`, `node_modules/`, the 59 golden PNGs' pixel content, and the internals of
the offline Python trajectory models behind the shipped binaries. Those require runtime or
provenance validation and are recorded in §3.6 rather than asserted as clean.

**Inspected and judged not material** (recorded so the exclusion is explicit rather than silent):

- **Agent-harness integration layer** — `opencode.json` (two version-pinned MCP servers, both with
  telemetry flags disabled), `.agents/skills/goal/SKILL.md`, `.claude/commands/goal.md`,
  `.opencode/commands/goal.md`, `.kimi-code/AGENTS.md`, and
  `docs/agent-integrations/REPOSITORY_LOCAL_ADDONS_{MASTER_PLAN,HANDOFF}.md`. Four near-duplicate
  `/goal` definitions exist because four agent harnesses are supported; they state the same
  governance and the duplication is a deliberate portability cost. The layer is bounded,
  documented by a handoff, guarded by `scripts/mcp-preflight.mjs`, and explicitly constrains
  itself ("No MCP result may be treated as physics validation"). Not a defect. The one real issue
  inside it — `mcp-preflight.mjs`'s `shell: true` and over-broad path rule — is finding O-08.
- **No structured logger.** 25 `console.*` calls in `src/`, no logger abstraction. For a static
  client-side application with no backend, the console plus the existing `runtimeTelemetry` /
  `debugInventory` / `frameTelemetry` surfaces are the conventional and adequate observability
  model. Adding a logging framework would be unjustified churn.
- **No web attack surface requiring auth work.** No backend, no authentication, no authorization,
  no cookies, no `localStorage`/`sessionStorage`, no `postMessage`, no Workers, no `eval`, no
  `Function` constructor, and every dynamic `import()` is a static literal. The only `innerHTML`
  uses assign the empty string. URL parameters (`preset`, `backend`, `view`, `mode`, `rm`, `dc`)
  are allow-listed or schema-validated, and the `dc=` JSON parse is wrapped so a malformed payload is
  ignored rather than thrown. Security work is therefore confined to supply chain (O-02, O-03),
  the production debug surface (U-04), and asset-reference validation (V-16).

**Independence.** Every P0/P1 finding in this document was verified directly against the source by
the supervising agent, not accepted on a subagent's word. Where a claim could not be settled by
reading, it is marked `indicated` or `suspected` and carries the experiment that would settle it.
