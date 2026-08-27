# EXECUTION PROMPT — Browser Blackhole next campaign

Campaign date: 2026-08-26
Planning base: `main@df9692c1916cb82149cb8f30c7d5ad6adc6bfb41`
Mode: autonomous implementation with evidence-driven gates
Canonical audit: `docs/NEXT_CAMPAIGN_AUDIT_2026-08-26.md`
Canonical requirements/tasks: `openspec/changes/*`

**Status (2026-08-27):** **CAMPAIGN COMPLETE** — Phase A `m12-neutron-star-surface-lensing` (**COMPLETE** `a827563`), Phase B `m12-repository-integrity` (**COMPLETE** `5e01bbb`), Phase C `ca9-galaxy-collision` (**COMPLETE** `5680044` + `0b63ce9` checklist). All gates evidenced and pushed to `origin/main`.

**Superseded update (2026-08-27):** the "campaign complete" claim above predated hosted `main` CI going green — CI was red on every push at the time. A follow-on certification change, `openspec/changes/final-production-readiness`, found and fixed the root cause (hosted GPU-less runners cannot stably run the full browser suite; fixed by scoping hosted CI to `quality` + a cheap `browser-smoke`, with the full suite/goldens/Firefox as a documented local capable-runner gate) and independently re-verified every hard gate. See `docs/RELEASE_CERTIFICATION.md` for the authoritative current status — do not treat this file's Phase A/B/C status line alone as proof of hosted-CI-green release readiness.

## Mission

Execute the next Browser Blackhole campaign from the current repository state. Do not redo completed M0–M11 work. Do not treat the old roadmap order as more important than a proven production defect.

A deep repository audit found that the production Neutron Star destination currently overstates its scientific rendering fidelity: the specification and README require/claim compact-surface strong-gravity ray tracing, while the implementation explicitly states that photon paths remain straight and that backwards ray tracing to the material surface is not implemented. This is the first blocker.

After that is closed, harden repository truthfulness/evidence, then execute CA9 Galaxy Collision from a source-locked primary-source model.

## Required campaign order

### Phase A — M12-NS: Neutron-star direct surface ray tracing — BLOCKING

Open and execute:

`openspec/changes/m12-neutron-star-surface-lensing/`

Read all four artifacts before coding:

- `proposal.md`
- `design.md`
- `tasks.md`
- `specs/neutron-star-surface-lensing/spec.md`

Core outcome: observer rays in the Neutron Star destination follow the direct Schwarzschild exterior path and terminate on the material surface or escape to background. Surface/hot-spot emission must be evaluated at the geodesic hit coordinate. The solution must have a pure reference path, CPU/GPU validation, a dedicated browser suite, visual review and performance evidence.

Black-hole behavior is protected. Reuse existing canonical geodesic mathematics where possible, but do not destabilize mature Black Hole/LUT/Kerr code merely for abstraction elegance. Existing black-hole stable classification codes 0..6 must not be renumbered.

The weak-field thin-lens helper is not an acceptable substitute for this phase.

If the direct implementation cannot be validated without destabilizing existing physics, follow the OpenSpec controlled fallback: truthfully downgrade the neutron-star claim everywhere, document the blocker, and do not pretend the scientific gap is closed.

### Phase B — M12-RI: Repository integrity/evidence hardening

Only after Phase A closes or is explicitly contained per its fallback, execute:

`openspec/changes/m12-repository-integrity/`

This phase must resolve the audit’s proven repository drift without turning into an unrelated cleanup refactor:

- active instructions/current-state truthfulness;
- README/current capability status;
- exact dependency-pin policy vs `tsx` caret range;
- hosted CI browser job naming/scope ambiguity;
- black-hole-merger waveform fixed-wait flake;
- production benchmark command/evidence discoverability;
- neutron-star/CA9/GPU timing wording;
- final synchronization of state/backlog/OpenSpec.

Any visual/scientific output change during this phase is unexpected and must be investigated rather than accepted.

### Phase C — CA9: Galaxy Collision

Only after Phase A and B hard gates pass, execute:

`openspec/changes/ca9-galaxy-collision/`

CA9 begins with a mandatory source-lock stage. The previous repository statement that Toomre & Toomre (1972) is inaccessible is stale. Use the current public research sources:

- NASA GISS publication record: `https://pubs.giss.nasa.gov/abs/to01000a.html`
- NASA NTRS record: `https://ntrs.nasa.gov/citations/19720056411`
- DOI: `10.1086/151823`

Retrieve/read the primary-source scan as a research input. Do not commit the full paper PDF unless redistribution rights are independently established.

Transcribe every production encounter parameter needed by the selected reduced reconstruction with exact page/section/figure/table provenance. Distinguish verbatim source values from repository-derived or figure-digitized values. If a material parameter cannot be established, mark CA9 `BLOCKED_SOURCE` and stop dependent production tasks. Never make up a plausible number.

The existing `tools/cosmic-data/restricted_three_body.py` prework is useful precisely because it distinguishes exercise/self-check behavior from production. Preserve that safety property. Production generation must consume explicit source-locked configuration and fail closed on missing/exercise/unverified fields.

Runtime Galaxy Collision dynamics must come from a compact, versioned, checksummed offline-generated trajectory/keyframe artifact. Browser runtime interpolates that data; do not build an O(N^2) live solver and do not use cinematic particle drift as the scientific trajectory source.

## Baseline protocol

At the start of the campaign and again at each phase boundary, record:

```bash
git status --short
git rev-parse HEAD
node --version
npm --version
```

Then establish a clean dependency/quality baseline:

```bash
npm ci
npm run check
```

Run phase-specific pre-change browser/parity/golden/benchmark baselines before touching the relevant implementation. If a baseline fails before your changes, classify it with evidence; do not silently inherit it as your regression.

## Source-reading protocol

Before changing a subsystem, read the complete relevant source rather than coding from file names or this prompt alone. At minimum Phase A must inspect:

- `src/phenomena/neutron-star/neutronStarModule.ts`
- `src/phenomena/neutron-star/physics.ts`
- neutron-star presets and related shared services
- `src/renderer/shared/LensingService.ts`
- `src/physics/schwarzschild.ts`
- `src/phenomena/black-hole/cpuReference.ts`
- the production Schwarzschild GPU/TSL path
- relevant ray/integrator parity tests
- neutron-star golden harness entries
- neutron-star sections of `PHENOMENA_IMPLEMENTATION.md` and `SCIENTIFIC_FIDELITY.md`

Phase C must inspect the complete data-pipeline/source docs, CA9 tool/tests and the CA8 SXS/data-driven precedent before designing another pipeline.

## Implementation discipline

### Scientific truth first

Every `DIRECT`, `DATA_DRIVEN`, and `PROCEDURAL_SCIENTIFIC` label is a behavior contract. Do not let documentation claim more than the renderer/data supports.

When a paper/source does not provide a value, the correct outcome is a blocker or a documented derivation with uncertainty—not a guess.

### Preserve mature invariants

Do not reopen post-M11 optimization decisions without new evidence. The previous campaign already investigated and deliberately rejected several tempting changes such as paused-frame skipping, integration-budget cuts, startup/bundle churn and low-value allocation micro-optimization.

Do not weaken numerical budgets, test tolerances, asserts, parity thresholds or quality gates to make a patch pass unless the change is independently justified by the scientific/numerical contract and documented.

### Test with the behavior

Add reference/unit/browser validation in the same work packet as the behavior it protects. Do not postpone all tests until the end.

For visual changes, establish physics/reference/parity correctness first. Then run existing goldens without update, inspect the diff, intentionally regenerate only affected baselines, and run the complete golden suite twice.

### Deterministic browser tests

Prefer observable state and `expect.poll`/condition-based waits over arbitrary sleeps. Do not fix a flaky test by increasing a fixed delay.

### Performance claims

Use the repository’s existing benchmark semantics. Record machine/backend/quality/internal resolution and whether a value is CPU/rAF-derived or true GPU timestamp data. Compare before/after on the same machine/config when claiming improvement/regression.

### Resource lifecycle

All destination GPU/scene/listener resources must attach/detach through existing scope/lifecycle contracts. Repeated navigation must remain bounded under the resource-leak suite.

## Commit/push protocol

Keep commits attributable to the current OpenSpec phase. A reasonable default is one or more implementation commits plus one closure/docs evidence commit per phase; do not force a single huge commit if it makes regression isolation worse.

Every phase-closing commit message/body must record:

- starting SHA;
- problem/requirement solved;
- architecture/important tradeoffs;
- files/subsystems materially changed;
- exact quality/parity/golden/browser commands and results;
- benchmark context/results where relevant;
- scientific sources/provenance for CA9;
- known limitations and environment-deferred gates;
- final phase status.

Push completed phase commits when the environment/repository authorization permits. Never force-push over unrelated work.

## OpenSpec task rules

- Work through `tasks.md` in order unless a documented dependency allows safe parallelism.
- Mark `- [ ]` to `- [x]` only when evidence exists.
- A blocked task stays unchecked and gets a blocker note in the appropriate source/state document.
- Do not mark an entire section complete because a similar global suite exists; satisfy its explicit requirement or explain the accepted existing evidence.
- When implementation details legitimately differ from the suggested design, preserve the spec requirement and document the better design decision rather than blindly following pseudo-code.

## Phase A hard acceptance gate

Do not advance to Phase B until all applicable M12-NS requirements are proven, including:

1. material-surface hit/escape semantics;
2. refined finite hit coordinate suitable for shading;
3. analytic apparent-limb reference case in the stated `R > 3 r_g` regime;
4. CPU/GPU representative ray parity;
5. dedicated neutron-star unit/browser coverage;
6. reviewed neutron-star golden updates only after reference/parity success;
7. Black Hole/LUT/Kerr non-regression for every shared path touched;
8. performance/resource evidence;
9. truthful docs/fidelity labels;
10. `npm run check` + full available browser gate.

If a direct implementation is contained by the fallback instead, Phase B may proceed only to make the repository fully truthful; CA9 remains blocked unless the campaign owner explicitly accepts that deferment.

## Phase B hard acceptance gate

Do not advance to CA9 until:

1. active agent instructions cannot restart M0–M11 accidentally;
2. README/state/docs describe current M11/M12 reality;
3. dependency policy matches manifest/lock;
4. hosted CI browser scope is explicit and command-aligned;
5. the known waveform fixed-wait flake has a behavioral wait and stress evidence;
6. production benchmark commands/evidence are discoverable and matrix text is accurate;
7. integrity work caused no unexplained visual/scientific drift;
8. full available quality/browser gates pass.

## CA9 hard acceptance gate

Do not mark CA9 production until all of these are true:

1. selected encounter parameters are source-locked with exact provenance or explicit documented derivation;
2. no exercise placeholder can pass production config validation;
3. deterministic offline generation/self-checks pass;
4. a compact versioned runtime artifact has schema/manifest/checksum/reproduction instructions;
5. loader rejects corrupt/unsupported data boundedly;
6. CPU reference interpolation and pinned runtime/GPU probes agree;
7. timeline scrub is reversible/deterministic;
8. scientific tracer motion derives from offline data, not cinematic drift;
9. route/presets/resources/fallback/browser behavior pass;
10. goldens are reviewed and twice-stable;
11. benchmark/performance/resource evidence passes or a documented non-deceptive quality strategy exists;
12. provenance/fidelity docs state the reduced-model limitations;
13. `npm ci`, `npm run check`, full available Playwright and complete visual gates pass.

## Stop conditions

Stop the dependent workstream and record evidence rather than improvising when:

- a required primary-source value cannot be established;
- committing a third-party scientific artifact has unresolved redistribution rights;
- neutron-star CPU/GPU surface-ray classifications cannot be reconciled;
- a shared ray refactor causes unexplained black-hole parity/golden drift;
- CA9 generator output is not deterministic/reproducible;
- artifact parser/interpolator cannot prove bounded/error behavior;
- a test is dismissed as flaky without identifying and fixing a test/environment mechanism;
- an unavailable browser/device/backend is the only missing gate—record it as environment-deferred, not PASS.

## Definition of campaign completion

The campaign is complete when every unblocked OpenSpec change is implemented, validated, documented, committed and pushed; all completed task checkboxes reflect evidence; durable state/backlog identify the true next work; and no production scientific claim exceeds the model actually running in the browser.

Campaign is complete — no active OpenSpec change. See `.agent/STATE.md` for durable evidence and next actions (deployment verification if a target is chosen).