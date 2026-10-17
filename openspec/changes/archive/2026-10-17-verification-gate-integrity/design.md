# Design — Verification gate integrity

## Context

This repository has unusually good test *content*: real physics invariants, non-vacuity guards in
the browser parity specs, fail-closed asset validation, independent reference re-derivations. The
problem is not what the tests check. It is that a **passing result is not evidence that the check
ran over the corpus it names.**

The Kerr defects in `kerr-gpu-initializer-correctness` are the proof. The Kerr parity corpus exists,
is well built, and pins a far camera at the default framing. The defects are at close radii and on
the Kerr-plus-moving-observer path. Nothing in the suite was *supposed* to catch those — but nothing
in the suite was *able* to notice that its corpus had silently narrowed, either.

The same pattern appears six more times, in six different forms, across three test tiers and the
benchmark harnesses. This change closes the class.

## Goals / Non-Goals

**Goals**

- Make "green" mean "measured".
- Make degradation visible.
- Add the cheap checks that hosted CI can run to compensate for the GPU suite it cannot.

**Non-Goals**

- Not a test-coverage expansion. Writing tests for untested modules is a separate, larger activity.
- No loosening of anything. Every change here makes a gate stricter.
- No change to the capture protocol, the golden baselines' content, or any tolerance value.
- No attempt to host the GPU suite on hosted runners.

## Decisions

### D1 — Enforce the declared tolerance, or mark the test honestly

**Decision.** For the LUT terminal-direction tolerance, first attempt to actually enforce it. The
deferred assertion exists because the planar-frame comparison needed alignment work; but
`tests/unit/lutGenerate.test.ts` already performs the same comparison with a *matched-anchor* frame
and achieves 5e-4/1e-3. The technique exists in this repository.

If the alignment work proves out of scope, fall back to option (b): rename the test to say it is a
measurement, add a source comment, and remove the tolerance claim from the header. What is **not**
acceptable is the status quo — a header claiming a bound, a test named for that bound, and a
`void angErr;` that discards the measurement while the value is printed to stdout where it looks
like a gate.

**Rationale.** The `void x;` pattern exists because `noUnusedLocals` is strict. That is a compiler
constraint being solved in the wrong place. The correct fix is either to use the value or to not
bind it.

### D2 — Adopt the browser-spec non-vacuity pattern uniformly

**Decision.** Apply the pattern the parity specs already use — assert a minimum compared count
*after* the filters — to every unit test that can skip subjects.

This is explicitly a case of **the repository teaching itself**. `integrator-parity.spec.ts:275`,
`kerr-parity.spec.ts:272` and `neutron-star.spec.ts:487` all do this correctly, with a comment
explaining why. The unit tier was written by different hands and never received the convention.

**Expected discovery.** Adding the assertions will likely turn some currently-passing tests red
because their effective corpus is smaller than documented. Each such failure is a *finding*, to be
either fixed or explicitly documented as a reduced deliberate corpus. It is not to be resolved by
loosening the minimum to whatever the current count happens to be.

### D3 — Absolute content floors, generalised from the cinematic suite

**Decision.** Extract the luminance-grid computation already present in
`tests/browser/support/appHarness.ts` and have the scientific harness return `meanLuma` (and
optionally a spatial standard deviation) alongside the relative deltas. Assert a per-scene absolute
floor, as `cinematic-goldens.spec.ts:65-78` already does.

**Rationale.** The harness comment records two *measured* false passes caused by the absence of
exactly this check, and the mitigation applied was to tighten relative tolerances on 11 rows. That
reduces the window; it does not close it. An absolute floor closes it, and the machinery already
exists in this repository.

**Design constraint.** The floor must be per-scene, not global. `sparseContent` rows genuinely have
a small subject fraction; a single global floor would be unachievable for them or, worse, so low it
would pass a destroyed subject.

### D4 — Golden inventory as a CI check

**Decision.** Add a check asserting set equality between declared scene names and committed
baseline filenames, in both directions, running in hosted CI.

**Rationale.** The GPU golden comparison cannot run hosted, but a *file-existence* check can and
needs no GPU. This converts baseline deletion, rename and orphaning from invisible to blocking —
which is the cheapest available compensating gate for V-05.

### D5 — Test the production asset-resolution path

**Decision.** Add a test that reads `public/luts/index.json` and validates the family it selects,
and apply the same treatment to the BBH and GC data manifests.

**Critical property:** make the product's resolution logic a testable pure function so the test
exercises the same code the product runs, rather than re-implementing discovery. The current tests
scan `public/luts/` for the first directory containing a manifest — which is a different code path
from the one the app uses.

**Validation for this specific item:** point `index.json` at a non-existent family and confirm
`npm run test` fails. Today it passes. That asymmetry is the whole point.

**Also fix:** the product's index-resolution failure paths currently `return null` with no log at
all. A silent numerical-backend downgrade is a scientific-outcome change with no diagnostic, which
contradicts the repository's own fail-truthfully rule.

### D6 — Make skips blocking, not green

**Decision.** In the hosted smoke job, parse the machine-readable result and fail if fewer than the
expected number of tests executed, or if any test skipped. Where a forced-backend mechanism already
exists (`?backend=webgl2`, demonstrated in `smoke.spec.ts:118-127`), prefer forcing the known state
over skipping on an unknown one.

**Rationale.** A skip is honest reporting; a green badge over a degraded run is not. The repository
already has the tool to make the test deterministic.

### D7 — Artifact freshness, or honest annotation

**Decision.** Add a CI step that regenerates the offline artifacts and fails on a diff. If Python is
unavailable on the runner, annotate the affected tests as verifying a *stored verdict* and list them
explicitly.

**Note on the Python gate.** `tools/cosmic-data/requirements.txt` excludes the `sxs` package on
Python 3.12+, so the BBH reducer cannot run on current interpreters. That makes full regeneration
unavailable on a hosted runner today. The galaxy-collision self-check *is* pure-stdlib and can run;
it should be wired now, and the BBH artifact annotated until the toolchain is fixed under
`operations-and-deployment-readiness`.

### D8 — Coverage as a reported signal

**Decision.** Add coverage reporting to the quality job; do not add a global threshold.

**Rationale.** A global threshold fights the deliberate design that `src/shaders/*` and the DOM
shells are covered by browser tests, not unit tests. The value is *visibility*: today nothing answers
"which module has no unit coverage at all". A report answers it without forcing an architecture
change. Note that `src/shaders/cameraRayMath.ts` — the CPU reference the browser parity gate depends
on — currently has zero unit coverage; the report should surface exactly that.

### D9 — Capability failure modes as data
**Decision.** Table-drive the capability decision tests over the documented failure-mode list,
widening the input type where the current two-boolean signature cannot express a case.

**Note.** The signature change is a prerequisite: "WebGPU present but missing a required feature" is
not expressible as `{webgpuAvailable: true}`. Where a documented case is genuinely unreachable, assert
that explicitly with a reason rather than omitting it silently.

### D10 — Declare timeouts proportionate to the work a test does

**Decision.** Any test that loads a large module graph (the destination modules, the renderer
library) declares its own timeout, and the gate is run repeatedly to prove determinism.

**Rationale.** This one was found by *running* the gate during the audit rather than trusting the
recorded certification, which is the point. `launchCatalog.test.ts` awaits the dynamic import of
roughly twenty modules that transitively pull in the 1 MB `three/webgpu`, sequentially, inside a
single test bounded by Vitest's default 5000 ms. Standalone it measured 2.38 s / 5.03 s / 2.41 s, and
it failed **2 of 3 full-suite runs** on a host that was not otherwise doing GPU work.

**Why this is P1 and not a nuisance.** The repository's entire trust model rests on gate integrity —
`AGENTS.md` forbids weakening tolerances to obtain a pass, and the whole V-lane exists because gates
were reporting success without measuring. A headline result that reproduces two times in three is
exactly the failure that model is meant to prevent, and it also undermines the recorded "631/631"
release evidence, which would then need re-certification rather than re-assertion.

**Note on the same test.** `launchCatalog.test.ts` is simultaneously too weak and too brittle: its
imports are wrapped in a `catch` that swallows failures (finding V-11), so a partial import can
collect fewer descriptors and still satisfy the `>= 8` floor, while the whole test can also time out.
D10 and V-11 must both be fixed; neither alone makes the test sound.

## Risks / Trade-offs
- **[Red tests on first run]** D2 will likely surface currently-passing tests as failing. → Mitigation:
  this is the designed outcome. Triage each as either a real finding or an explicitly documented
  reduced corpus. Record the list in this change's `tasks.md`.
- **[Content floors force re-capture]** The current sparse-content baselines are themselves
  near-empty — that is *why* the false passes happened. → Mitigation: raise a distinct, justified
  re-capture for those rows with the subject actually present. Never lower the floor to accommodate
  a weak baseline.
- **[Smoke job becomes flaky]** Forcing `?backend=webgl2` could fail on a runner without WebGL2 at
  all. → Mitigation: that runner should fail the job, which is the intended signal. If it proves
  flaky in practice, fail on a documented minimum count rather than a strict one, and say so.
- **[Coverage noise]** Coverage tooling adds a dependency and can slow the job. → Mitigation:
  report only; no threshold, so it cannot fail a build.

## Testing strategy

The acceptance test for this change is **negative**: for each requirement, deliberately break the
protected property and confirm the gate goes red.

- Set `public/luts/index.json` to a non-existent family → `npm run test` fails.
- Delete one golden PNG → the inventory check fails.
- Delete a subject from a sparse scene → that scene's content-floor assertion fails.
- Widen a LUT domain exclusion so all corpus rays are skipped → the compared-count assertion fails.
- Remove a required capability from a capability snapshot → the decision table fails.
- Run a benchmark harness with the renderer neutered → the harness exits non-zero (implemented in
  `benchmark-harness-integrity`; this change verifies the gate consequence).
- Add a production module with no tests → it appears at zero coverage in the report.

## Open Questions

None blocking. One scope judgement: whether to add unit tests for `src/shaders/cameraRayMath.ts`
here. Recommendation — **yes**, it is small, it is the CPU reference the browser parity gate depends
on, and leaving it with zero unit coverage is precisely the blind spot this change exists to close.
