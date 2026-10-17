# Design — Benchmark harness integrity

## Context

The performance campaign's credibility rests on a rule the repository states repeatedly and mostly
follows: never conflate CPU/rAF timing with GPU timestamp timing, never report a number without
matched machine and configuration metadata, and never claim a win without before/after evidence.

The harnesses implement the *measurement* discipline well. What they do not implement is the
*refusal* discipline. A harness that cannot render correctly still emits a record; the record is
well-formed, plausible, and accepted. The only defence is an exit code that nine of the eleven
harness scripts overwrite on the way out.

That is a single-line defect with campaign-wide consequences, and it is the reason the four P0/P1
physics defects in `kerr-gpu-initializer-correctness` were certified: the evidence produced by this
layer was not always describing a real run.

## Goals / Non-Goals

**Goals**

- Make every refusal actually refuse, in the harness and in the orchestrator.
- Make every record describe the run that produced it.
- Give regression claims an enforced comparability precondition.

**Non-Goals**

- Not a measurement change. What is sampled, how it is sampled, and how CPU and GPU time are
  separated all stay exactly as they are.
- Not a re-measurement. This change fixes the instruments; the campaign is not re-run here.
- Not a rewrite of the committed evidence. Historical records stay, including the four
  unattributable ones; they are annotated, never rewritten.
- Not a new benchmark dimension.

## Decisions

### D1 — Remove the trailing `process.exit(0)`; let the exit code stand

**Decision.** Delete the terminal `process.exit(0)` from the nine harnesses so `process.exitCode`
survives to termination.

**Rationale.** `process.exit(code)` sets the status; it does not defer to a previously assigned
`process.exitCode`. The two harnesses that are correct simply do not call `process.exit`. The fix
is therefore to make the other nine match the two that already work — the repository again
containing the correct pattern.

**Rejected alternative — replacing with `process.exit(1)`.** Also correct, but it loses any other
pending exit code and is a larger edit. Removing the line is the minimal change that matches the
working harnesses exactly.

### D2 — Validate the child inside the orchestrator, do not trust the exit code

**Decision.** `bench-cinematic-matrix.mjs` asserts `renderTelemetry.framesRendered > 0` and
cross-checks each child's reported backend, tier and viewport against what it requested.

**Rationale.** Exit codes are advisory across process boundaries; a child that is killed, that
crashes after writing its record, or that reports a zero-frame measurement with a zero status would
still be accepted. Validating the record the orchestrator actually consumed is the stronger check
and is D2's whole point: the orchestrator already validates backend and tier, so this extends an
existing validation rather than adding one.

### D3 — One argument contract for all child harnesses

**Decision.** Every harness parses `--channel`, `--width`, `--height` (and its existing arguments)
and derives its render area from the application's real `#viewport` rect.

**Rationale.** The two divergent harnesses were written before the matrix orchestrator existed and
were never migrated. The orchestrator assumes uniform CLI compliance; that assumption is currently
false. Making the assumption true is cheaper and safer than making the orchestrator detect
non-compliance for arbitrary future harnesses.

**Note on the `1280 - 320` magic.** Both affected harnesses subtract an assumed 320 px control
panel. The other eight read the real element rect. With the current layout the assumption happens
to be close, but "close" means the reported internal resolution may not match the actual one, which
is exactly the metadata the comparison gate depends on. D6 makes this observable.

### D4 — Commit attribution read, not assumed

**Decision.** Port the existing `currentCommit()` helper into the two harnesses. Add `schemaVersion`
and `kind` to their records.

**Rationale.** The other eight harnesses already do this. Again the repository contains the correct
pattern and two files missed it.

**For the four existing unattributable rows:** do not rewrite them. Annotate
`benchmarks/results/2026-08-28-ws0-baseline/SUMMARY.md` with which rows are commit-unattributable,
and state in `docs/PERFORMANCE_CERTIFICATION.md` that the "WebGL2 faster than WebGPU" finding draws
partly on those rows. Honest annotation of a limitation beats a fabricated value. Re-running those
four rows at a pinned SHA is a separate, evidence-gated activity.

### D5 — Refuse to write into certified evidence by default

**Decision.** Default the output directory to a run-scoped path. If the resolved path is a
directory containing a manifest for a different revision, refuse unless an explicit overwrite
variable is set.

**Rationale.** The current default is the campaign directory that was in flight when the harness was
written. It was never revisited. The overwrite risk is real: filenames are
`${phase}-${quality}-${label}.json`, so a re-run with the same labels silently replaces a certified
record — and `docs/BENCHMARK_MATRIX.md:213` explicitly forbids it.

### D6 — Implement the schema and the comparison gate

**Decision.** Add `benchmarks/schema.json` covering the union of the record shapes in use, and
`scripts/compare-benchmarks.mjs` implementing the mismatch list already written in
`docs/BENCHMARK_MATRIX.md` §12.

**Rationale.** The document exists specifically to prevent vague performance claims, and it ships
neither the schema that makes records machine-comparable nor the gate that enforces comparability.
Implementing it converts "these numbers look comparable" into an enforced precondition.

**Scope control.** The three historical record shapes differ. The schema covers the union and marks
older records `legacy`, so existing evidence is not invalidated — it is simply excluded from
automatic comparison, which is the honest treatment.

### D7 — One command surface; accumulate refusals

**Decision.** Add a package script for `bench-scenarios.mjs` and list it in the README. Change
`record.refusal` to accumulate.

**Rationale.** The most-cited harness in the campaign — referenced by `tasks.md`, `PERFORMANCE.md`
and `PERFORMANCE_CERTIFICATION.md` — is the only one not in the documented surface. The refusal
accumulator is a two-line change that makes a failed campaign matrix diagnosable.

## Risks / Trade-offs

- **[Harnesses start failing]** Fixing the exit codes means nine harnesses will exit non-zero in
  situations where they currently exit zero. → Mitigation: discover this on a scratch run first.
  Each non-zero exit is either a real finding or a harness bug; neither should be discovered during
  a certification run.
- **[Schema rejects historical records]** → Mitigation: `legacy` marking, never deletion.
- **[Comparison gate blocks legitimate comparisons]** Two runs captured minutes apart on a machine
  whose adapter string varies in a cosmetic way would be refused. → Mitigation: the override path
  exists and states which dimensions differed; that is the correct outcome — a human decides.
- **[CI coordination]** `.github/workflows/ci.yml` is touched by both this lane and
  `verification-gate-integrity`. → Mitigation: sequence them; do not edit that file concurrently.

## Testing strategy

The harnesses are not unit-tested today, which is itself part of the problem. Extract the
record-normalisation and refusal logic into a testable module and cover it:

- A record with zero rendered frames produces a refusal and a non-zero exit.
- An orchestrator given a child record with zero frames marks the workload failed.
- A harness invoked with a non-default viewport reports that viewport.
- A record produced without a readable revision reports a placeholder, not a fabricated hash.
- Writing to a certified directory without the override is refused; with it, succeeds.
- The comparison tool refuses a mismatched pair and names the dimensions; accepts a matched pair.
- The schema validator rejects a record missing a required field; accepts a legacy-marked one.

**Acceptance test (negative):** neuter the renderer's forced-continuous-render path and run
`npm run bench:neutron-star`. It must exit non-zero. Today it exits 0.

## Open Questions

One, not blocking: whether the GPU-time field, which currently reflects a single resolved frame
rather than a distribution, should be given a distribution in the same change. Recommendation —
**no**. That is a measurement-semantics change requiring its own evidence, and this change's
`design.md` records it as a known limitation to address separately. Fixing the instruments first
is the point.
