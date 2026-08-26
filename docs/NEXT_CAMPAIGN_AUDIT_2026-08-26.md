# Deep repository audit — next campaign selection

Date: 2026-08-26
Audit base: `main@df9692c1916cb82149cb8f30c7d5ad6adc6bfb41`
Status: planning artifact; no production implementation is performed by this document.

## Executive verdict

The next implementation campaign MUST NOT begin with CA9 immediately.

The repository already ships Neutron Star as a production Cosmic Atlas destination, while its written product/specification claims a capability the implementation explicitly says is not implemented: strong-gravity backward ray tracing from the observer to the neutron-star material surface. The current neutron-star renderer draws a directly emitted sphere and evaluates redshift/hot-spot geometry, while photon paths remain straight. This is a scientific-fidelity and release-truthfulness defect in an existing production destination and therefore outranks new destination expansion.

The ordered next campaign is:

1. **M12-NS — Neutron-star surface-lensing fidelity closure (BLOCKING/HIGH).** Implement and validate Schwarzschild backward rays that terminate on the material surface or escape to the celestial background without changing validated black-hole output.
2. **M12-RI — Repository integrity / control-plane / evidence hardening.** Eliminate stale status/claims, dependency-policy drift, CI naming/scope ambiguity, benchmark coverage gaps, and the known fixed-wait browser flake.
3. **CA9 — Galaxy Collision.** Proceed only after the M12 blocker is closed and after a source-lock packet extracts the exact reproducible model parameters from the now-accessible primary-source scan. If the source cannot substantiate the required parameters, CA9 remains blocked; do not fabricate them.

OpenSpec change packages for all three workstreams live under `openspec/changes/`. `.agent/EXECUTION_PROMPT.md` is the canonical execution overlay and defines the dependency order.

---

## Audit method and coverage

The audit inventoried the complete recursive Git tree on `main` and reviewed the repository as a system rather than treating individual TODO markers as the backlog. The tree was not truncated. The review covered:

- agent/control-plane instructions (`.agent`, `.agents`, `.opencode`, `.claude`, `AGENTS.md`);
- CI, package/toolchain configuration, Vite/TypeScript/ESLint/Prettier/Playwright;
- product, architecture, physics, numerical-method, rendering, state, testing, performance, deployment, provenance, and Cosmic Atlas documentation;
- application/atlas lifecycle and routing;
- shared renderer kernel and rendering services;
- black-hole Schwarzschild/LUT/Kerr implementations and CPU references;
- all production Cosmic Atlas phenomenon modules and their source/data strategies;
- UI, navigation, test hooks, diagnostics, quality governor, transitions, resource management;
- unit/browser/parity/golden/resource/accessibility/device-loss suites;
- benchmark harnesses and committed benchmark evidence;
- offline data/LUT generation tooling;
- every tracked path including committed binary/golden/runtime assets by inventory, provenance/manifests, generators and validation contracts.

Binary PNG/LUT/runtime payloads were not manually interpreted byte-by-byte; their role, provenance, size/location, manifest/checksum path, generator/loader contracts, and regression consumers were audited. Source logic and text artifacts were inspected directly where they determine behavior or campaign priority.

No local checkout was executed during this remote planning audit. The implementation agent MUST re-establish the baseline with the repository commands before modifying production code.

---

## Severity model used

- **Critical** — corrupt data, unsafe release behavior, broken core boot, or systemic scientific falsehood with no containment.
- **High** — production physics/rendering behavior materially contradicts a shipped claim/spec; major regression or scientific-fidelity violation.
- **Medium** — control-plane/docs/CI/test/performance evidence can misdirect maintainers or hide regressions but does not currently prove broken runtime output.
- **Low** — maintainability, naming, duplication, or optional cleanup with no demonstrated user/scientific impact.

The campaign prioritizes proven defects over speculative refactors.

---

# Findings

## F-01 — HIGH — Neutron Star claims direct surface ray tracing, implementation explicitly does not

### Evidence

`docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` defines Neutron Star minimum viable visualization with:

- exterior spherical lensing fidelity `DIRECT`;
- backward ray tracing to the surface or background;
- a renderer flow of camera ray → strong-gravity path → surface hit/background escape;
- validation for surface hit/miss rays, apparent-radius/lensing trend, and GPU/reference ray comparison.

`README.md` describes the production destination as including “compact-surface ray tracing”.

In contrast, `src/phenomena/neutron-star/physics.ts` explicitly documents:

- photon paths surface-to-observer are **STRAIGHT lines**;
- no ray bending;
- the lensing DIRECT path “arrives later”.

`src/phenomena/neutron-star/neutronStarModule.ts` likewise states that backward ray tracing to the surface / ray-bent limb / apparent radius is **NOT YET IMPLEMENTED** and the surface is rendered with direct emission.

`src/renderer/shared/LensingService.ts` confirms that the existing full Schwarzschild pass is the black-hole pass, while the generic non-black-hole option is a weak-field thin-lens approximation explicitly unsuitable as a replacement for strong-field ray tracing.

### Impact

This is not a cosmetic README issue. A production destination is marked/represented at a higher scientific fidelity than the renderer currently delivers. Existing goldens can preserve the wrong model indefinitely because they validate image stability, not the missing physical mapping.

### Required disposition

Block CA9 feature expansion until M12-NS closes. Either:

1. implement the specified direct Schwarzschild surface-ray path and prove it, **preferred**; or
2. if implementation proves infeasible, downgrade the production claim/fidelity everywhere and explicitly defer the feature.

The campaign is written to pursue option 1 and permits option 2 only as an explicit blocker/fallback decision, never as silent claim drift.

---

## F-02 — HIGH coverage gap — Neutron Star lacks dedicated physics/browser validation for its claimed direct path

The tracked test tree has committed neutron-star visual goldens (`NS_SURFACE`, `NS_PULSAR`, `NS_MAGNETAR`) but no dedicated `tests/browser/neutron-star.spec.ts` and no dedicated neutron-star physics test file comparable to the mature suites for compact merger, stellar explosion, TDE, AGN, Kerr, observer, LUT, etc.

The golden notes check surface emission, hot spots, beams and field lines. They do not establish Schwarzschild surface hit/miss correctness or CPU/GPU parity.

M12-NS therefore includes dedicated reference and browser coverage, not just a renderer patch.

---

## F-03 — MEDIUM — Autonomous startup instructions are stale and contradictory

`.agent/STATE.md` says the post-M11 optimization campaign is complete and there is no active planner prompt. The pre-audit `.agent/START_HERE.md`, however, still instructed a fresh executor to begin at M0 and execute the original M0 packet sequence.

For an autonomous coding agent this is operationally dangerous: a clean-context agent can spend a full run redoing historical work.

This planning commit replaces `.agent/START_HERE.md` and `.agent/EXECUTION_PROMPT.md` so the active OpenSpec campaign is unambiguous. Historical state remains evidence, not the active instruction source.

---

## F-04 — MEDIUM — CA9’s recorded source blocker is stale

`docs/cosmic-atlas/DATA_SOURCES_GALAXY_COLLISION.md` records Toomre & Toomre (1972), *Galactic Bridges and Tails*, as effectively closed-access for exact parameter extraction.

Current public-source verification found:

- NASA GISS publication page: `https://pubs.giss.nasa.gov/abs/to01000a.html`
- that page exposes a scanned PDF of the paper;
- NASA NTRS reprint record: `https://ntrs.nasa.gov/citations/19720056411`
- DOI: `10.1086/151823`.

This changes CA9 from “source inaccessible” to “source must be transcribed and validated”. It does **not** by itself grant blanket redistribution rights for the scanned paper. The implementation agent must not commit the paper PDF unless its redistribution rights are independently established. Facts/parameters may be transcribed with page/figure/table provenance.

`tools/cosmic-data/restricted_three_body.py` and `tests/unit/ca9Integrator.test.ts` are useful, deliberately non-production CA9 prework: exercise/default values are placeholders and production output must continue to refuse unverified source parameters.

---

## F-05 — MEDIUM — Dependency policy and manifest drift

`docs/DEPENDENCIES.md` states that direct versions are exact pins and that `^`/`~` ranges are not used. `package.json` currently declares `tsx` as `^4.23.12`, and the dependency table does not account for that direct tool dependency.

Required action: decide the canonical policy, then make `package.json`, lockfile and documentation agree. Given the repository’s reproducibility posture, the expected remediation is an exact `tsx` pin with a regenerated/verified lockfile, not weakening the policy text.

---

## F-06 — MEDIUM — Benchmark evidence coverage is inconsistent with the Cosmic Atlas matrix

The repository contains benchmark harnesses for black hole, Kerr, compact merger, TDE, AGN, stellar explosion and black-hole merger. `package.json` exposes most of them but omits a script for the existing `scripts/bench-stellar-explosion.mjs`. No neutron-star benchmark harness is present even though the Cosmic Atlas benchmark matrix defines Neutron Star as a production destination with performance expectations.

M12-RI should make every production destination discoverable through a consistent package-script contract and add a neutron-star harness/evidence row without inventing cross-machine performance claims.

---

## F-07 — MEDIUM — Hosted CI browser job’s name/comment and actual command do not express the same contract

`.github/workflows/ci.yml` frames the browser job as a fallback/smoke job but invokes `npx playwright test`. Playwright’s default project targets the suite broadly; individual capability skips decide what actually executes.

This is not proof the CI is wrong, but it is an ambiguous gate contract. M12-RI must choose and encode one intent:

- **smoke-only**: call an explicit smoke project/spec/tag; or
- **fallback browser suite**: rename/comment/document it as such and keep the broad command.

Do not silently narrow coverage merely to make CI faster.

---

## F-08 — MEDIUM — Known fixed-delay browser flake remains a reliability debt

The latest durable state records a black-hole-merger waveform cursor synchronization flake under multi-worker GPU load and notes that the test uses a fixed ~400 ms wait. It passed rerun, so this is not a current release failure, but fixed sleeps are load-sensitive and undermine deterministic autonomous gates.

M12-RI should replace the wait with a state/event/polling postcondition tied to the behavior being asserted.

---

## F-09 — MEDIUM — User-facing/runtime status text contains stale release facts

At the audited base, README/status material still contains historical statements such as M11 being “in progress” and older GPU-timing wording that predates the post-M11 timestamp-timing work described in `.agent/STATE.md` / performance documentation.

The same truthfulness pass must also correct the Neutron Star claim after M12-NS so docs describe exactly what ships.

---

## F-10 — LOW/NO ACTION — Several tempting optimizations were already investigated and deliberately rejected

The post-M11 state records evidence-based non-changes for paused-frame skipping, integrator step/bisection budgets, startup pipeline compilation, bundle splitting, and tiny JS allocation reductions. The next campaign must not reopen these merely because they look attractive in isolation.

Any revisit requires new evidence and must preserve parity/goldens. No speculative optimization is part of this campaign.

---

# Architecture/system observations

## Strong foundations to preserve

- The black-hole numerical stack has unusually strong CPU/GPU/parity/golden discipline.
- Stable ray-classification codes and canonical Schwarzschild CPU math are already documented.
- LUT/Kerr backends are isolated behind explicit service contracts.
- Atlas lifecycle/resource scopes and route normalization are mature enough to host additional destinations without rewriting the shell.
- Quality governor, diagnostics and test hooks provide useful deterministic forcing.
- Cosmic Atlas modules generally label `DIRECT`, `DATA_DRIVEN`, and `PROCEDURAL_SCIENTIFIC` boundaries rather than conflating them.
- CA8’s SXS pipeline is a good precedent for CA9: raw source → audited offline reduction → compact versioned runtime artifact → checksum/provenance → runtime interpolation.

## Boundaries that must remain intact

- Do not renumber the black-hole stable classification codes 0..6.
- Do not replace the strong-field path with `createThinLensDisplacement`; its own contract says it is a weak-field educational approximation.
- Do not make `ParticleService`’s cinematic drift into CA9 scientific dynamics. CA9 browser runtime should interpolate validated offline trajectories/keyframes.
- Do not introduce runtime network dependence for scientific datasets.
- Do not auto-update visual goldens to make changed physics pass.
- Do not change validated black-hole/Kerr trajectories as collateral damage from neutron-star reuse.

---

# Campaign dependency graph

```text
BASELINE
  |
  v
M12-NS  neutron-star direct surface ray tracing
  |  hard gate: physics + CPU/GPU parity + browser + goldens + BH non-regression
  v
M12-RI  repository truth/evidence/control-plane hardening
  |  hard gate: check + intended browser suite + docs/manifests consistent
  v
CA9-SOURCE-LOCK
  |  if exact source facts cannot be established -> BLOCKED_SOURCE and STOP CA9
  v
CA9-DATA-PIPELINE
  v
CA9-RUNTIME
  v
CA9-VALIDATION/PERF/RELEASE
```

Parallel work is permitted only where file ownership and scientific dependencies are independent. No CA9 runtime implementation may race ahead of source lock.

---

# Baseline and final gates

The executor must begin by recording versions and running, at minimum:

```bash
node --version
npm --version
npm ci
npm run check
```

Then run the appropriate browser/parity/golden baselines for the touched work. Existing environment-deferred WebKit/real-device items remain environment constraints; do not relabel them PASS without evidence.

Before each OpenSpec change is closed:

- all change-specific tasks are checked only with evidence;
- `npm run check` passes;
- browser tests relevant to the change pass;
- visual changes have reviewed golden diffs and intentionally regenerated baselines only after correctness is established;
- performance evidence is recorded on the same machine/config for before/after claims;
- no numerical/scientific claim exceeds implemented fidelity;
- docs/state/backlog are synchronized with code;
- no temporary downloaded papers, raw giant datasets, secrets, machine paths or ad-hoc benchmark junk are committed.

---

# Stop conditions

Stop dependent work and record a blocker rather than guessing when any of the following occurs:

1. a primary scientific parameter cannot be traced to a source location;
2. a license/redistribution question affects committing a third-party artifact;
3. a proposed shared Schwarzschild refactor changes black-hole parity/goldens unexpectedly;
4. CPU/GPU neutron-star surface-ray classifications cannot be reconciled within documented tolerance;
5. a CA9 reduction cannot reproduce its own source-lock invariants/checksums;
6. a failing gate is dismissed only as “flaky” without a proven harness/environment cause.

---

# OpenSpec artifacts

Active ordered changes:

- `openspec/changes/m12-neutron-star-surface-lensing/`
- `openspec/changes/m12-repository-integrity/`
- `openspec/changes/ca9-galaxy-collision/`

Canonical executor entry point:

- `.agent/START_HERE.md`
- `.agent/EXECUTION_PROMPT.md`

The executor should treat this audit as evidence/rationale and the OpenSpec change folders as the implementation contract.