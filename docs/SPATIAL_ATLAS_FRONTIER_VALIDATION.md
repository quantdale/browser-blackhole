# Spatial Atlas Continuous Navigation — Frontier Validation Report

**Audit date:** 2026-08-28
**Auditor role:** independent frontier-model reviewer / adversarial auditor / release certifier
**Subject:** `openspec/changes/spatial-atlas-continuous-navigation`

---

## Executive conclusion

```text
NOT_CERTIFIED
```

**Reason: the subject of certification does not exist.**

The audit was commissioned on the premise that "the `spatial-atlas-continuous-navigation`
implementation has already been completed by another model." That premise is false.
What was delivered upstream is the **planning campaign only** — seven documentation
commits, 3,679 insertions, touching `openspec/` exclusively. No runtime code, no tests,
no catalog data, and no route exist.

This is not a "partially implemented" or "subtly defective" verdict. Implementation has
not begun.

### Important fairness finding

**The repository's own artifacts are honest.** The planning model overclaimed nothing:

- `tasks.md` ships at **0 of 123 tasks checked**.
- Its very first prerequisite is unchecked and correctly names the blocker.
- `.agent/STATE.md` correctly names a *different* campaign as active.

There is no false completion claim inside the repository. The inaccurate claim exists
only in the audit commission itself. Per §1 of the audit charter ("distrust completion
claims"), the claim was tested and it failed — but the failure is upstream of the repo.

---

## Provenance

| Item | Value |
|---|---|
| Branch | `main` |
| Initial local HEAD | `ff34eb0` |
| Final HEAD (after `git pull --ff-only`) | `a022785` |
| Working tree initially clean? | **No** — 11 modified files, preserved untouched |
| Implementation commit range reviewed | `ff34eb0..a022785` (docs-only) |
| Performance-campaign session gate | `786d52b` (per the `ff34eb0` commit message) |

### The seven upstream commits (all documentation)

```text
a022785 docs(spatial-atlas): add EXECUTION_PROMPT.md
cacac41 docs(spatial-atlas): add tasks.md
e9423f1 docs(spatial-atlas): add MASTER_PLAN.md
0e88fd3 docs(spatial-atlas): add RESEARCH_BASIS.md
36d78db docs(spatial-atlas): add design.md
c0986cd docs(spatial-atlas): add proposal.md
75a384e docs(spatial-atlas): add README.md
```

### Evidence that no implementation exists

1. `git diff --name-only ff34eb0..origin/main | grep -v '^openspec/'` → **empty**.
2. `grep -rn "atlas/explore\|SpatialExplorer\|spatialCamera\|RealityClass" src/` → **zero matches**.
3. `tasks.md`: **0** `[x]`, **123** `[ ]`.
4. `src/atlas/` contains no coordinate, catalog, marker, label, or proxy module.

---

## The blocking constraint: implementation is *correctly* gated, not merely absent

Implementation has not begun because **the repository's own governing plan forbids it
right now.** This is a deliberate, documented sequencing rule, not an oversight.

`MASTER_PLAN.md` §1.3 — "Hard sequencing rule":

> Do **not** begin central Spatial Atlas runtime implementation on `main` while the
> performance campaign is actively modifying the same runtime.

It then enumerates blocked files, including `host.ts`, `TransitionDirector.ts`, the
global quality governor, the shared renderer kernel, and the resource manager.
`EXECUTION_PROMPT.md` restates the same gate as a mandatory prerequisite check.

### All three gate conditions are presently TRUE

| Condition | Status |
|---|---|
| Perf campaign still active | **TRUE** — `.agent/STATE.md` declares it the ACTIVE CAMPAIGN OVERRIDE |
| Perf campaign incomplete | **TRUE** — its `tasks.md` stands at **25 / 246** (~10%) |
| Perf campaign mutating shared runtime | **TRUE** — see below |

Uncommitted working-tree edits sit in exactly the files the rule blocks:

```text
 M src/atlas/host.ts                    <- explicitly blocked
 M src/atlas/TransitionDirector.ts      <- explicitly blocked
 M src/renderer/SharedRendererKernel.ts <- explicitly blocked ("shared renderer kernel")
 M src/atlas/atlasState.ts
 M src/atlas/types.ts
```

`ff34eb0` closed a **session**, not the campaign — its own message reports a gate run,
and the checklist still holds 221 unchecked items.

**Conclusion:** beginning SA implementation now would violate the repository's stricter
documented rule and would collide with in-flight uncommitted work. Not starting it is
the correct action, and the absence of implementation is a *scheduling* state, not a
defect.

---

## Requirement coverage — SA0 through SA12

Every milestone carries the same status for the same reason. Marked `NOT_IMPLEMENTED`
rather than `DEFERRED_ENVIRONMENT`: the environment is fully capable (this machine
reaches hardware WebGPU); the subject simply does not exist.

| Milestone | Scope | Status |
|---|---|---|
| Prerequisite | Perf campaign closed/paused | **FAILED** (gate open, 25/246) |
| SA0 | Post-performance re-audit | NOT_IMPLEMENTED (blocked by prerequisite) |
| SA1 | Coordinate + catalog foundation | NOT_IMPLEMENTED |
| SA2 | Explorer skeleton `/atlas/explore` | NOT_IMPLEMENTED |
| SA3 | Spatial camera | NOT_IMPLEMENTED |
| SA4 | Discovery: markers / labels / picking / search | NOT_IMPLEMENTED |
| SA5 | Semantic zoom + scale bands | NOT_IMPLEMENTED |
| SA6 | Entry handoff + prewarm | NOT_IMPLEMENTED |
| SA7 | Exit handoff / return to atlas | NOT_IMPLEMENTED |
| SA8 | Production source-locked spatial data | NOT_IMPLEMENTED |
| SA9 | All current destinations integrated | NOT_IMPLEMENTED |
| SA10 | Advanced continuity | NOT_IMPLEMENTED |
| SA11 | Hardening | NOT_IMPLEMENTED |
| SA12 | Release | NOT_IMPLEMENTED |

---

## Audit sections that cannot return a verdict

The following charter sections were **not executed**, because executing them would
measure nothing about Spatial Atlas. Reporting a PASS or a numeric result for any of
them would be fabrication.

| § | Section | Status |
|---|---|---|
| 7 | Performance audit | NOT_IMPLEMENTED — no Explorer to measure |
| 8 | Resource-lifecycle torture | NOT_IMPLEMENTED — no Explorer↔destination cycle exists |
| 9 | Compatibility audit (SA scope) | NOT_IMPLEMENTED |
| 10 | Visual-quality review | NOT_IMPLEMENTED — no scene to inspect |
| 11 | Existing-destination regression | NOT RUN — see note below |
| 12 | Shortcut scan of implementation | NOT_IMPLEMENTED — no implementation to scan |
| 13 | Test-quality audit | NOT_IMPLEMENTED — no SA tests exist |
| 14 | Adversarial runtime scenarios | NOT_IMPLEMENTED |
| 15 | Product-vision comparison | NOT_IMPLEMENTED — `/atlas/explore` does not exist |

**Note on §11.** The existing destination suites were deliberately not re-run. No
Spatial Atlas change exists that could have regressed them. The last recorded full gate
(`ff34eb0`, measured at `786d52b`) reports `npm run check` 539/539 unit, browser 206/206
including all 40 visual goldens, and Firefox 4/4 on hardware WebGPU. That figure is
**inherited evidence, not a gate this audit executed**, and is reported as such.

---

## What *was* auditable: plan-quality review

Since the commissioned implementation review was impossible, the audit pivoted to the
one lane the spec authorizes before performance closure — planning and non-overlapping
research. Reviewing 3,679 lines of plan *before* 123 tasks of implementation is
higher-leverage than the review originally commissioned.

### Scientific truthfulness of the plan — STRONG

Charter §6 names eight specific traps. **The plan anticipates and correctly handles all
eight.** This is the strongest part of the delivered work.

| Destination | Charter concern | Plan §21 treatment | Verdict |
|---|---|---|---|
| Black Hole | Must not claim unmodelled measured properties | Sgr A* anchor permitted; "do not assign uncertain spin as fact"; Schwarzschild/Kerr left untouched | CORRECT |
| Neutron Star | Real anchor ≠ exact reconstruction | "A real coordinate does not mean the renderer is an exact reconstruction"; `REPRESENTATIVE_MODEL` unless source-backed | CORRECT |
| Stellar Explosion | Needs explicit temporal semantics | Requires event epoch; "marker must not imply the star is exploding 'right now'" | CORRECT |
| Compact Merger | No fake precise GW marker | Kept conceptual/reference; "Do not create a fake precise marker"; notes probabilistic sky/distance localization | CORRECT |
| Tidal Disruption | Separate real hosts from representative sims | Representative until a specific event/preset is sourced | CORRECT |
| Quasar / AGN | Real location, representative morphology | Real anchors curated; "procedural host morphology must be disclosed as representative" | CORRECT |
| Black-Hole Merger | `SXS:BBH:0001` is an NR reference, not localized | `REFERENCE_SCENARIO`; "Do not place it at a random observed merger location" | CORRECT |
| Galaxy Collision | Toomre model ≠ Antennae | `REFERENCE_SCENARIO`; "Do not label it 'Antennae' … unless a new data-driven model is actually added" | CORRECT |

The `RealityClass` union matches the charter exactly, and the per-class placement rules
are sound. §20 additionally forbids inventing a sky position on exit handoff when the
target entity has no real spatial coordinate.

### Precision architecture — CORRECT

`design.md` D-04 and `MASTER_PLAN.md` §2.1 specify the right architecture rather than
gesturing at one: authoritative binary64 → reference-frame transform → **focus/camera-relative
subtraction in binary64** → scale-band normalization → `Float32Array` / GPU, with the
explicit rule "Do not upload absolute astronomical positions directly to f32 GPU
attributes." High/low split encoding is correctly deferred as evidence-triggered (D-05)
rather than paid everywhere up front. Planned acceptance includes focus-rebase
invariance and a stationary-camera projected-jitter threshold.

Multi-domain units (AU / pc / kpc / Mpc / `r_g`) are specified with explicit boundary
conversions, avoiding the single-universal-unit trap the charter warns about.

### Findings against the plan

| ID | Severity | Finding |
|---|---|---|
| PLAN-01 | **Documentation / P3** | `RESEARCH_BASIS.md` contains **zero URLs** (0 matches for `https?://` across 352 lines). The primary source for the central precision architecture is cited only as "The linked Three.js Reddit post, published 2026-08-28." The technical claims drawn from it are independently correct, and the plan shows good judgment in explicitly refusing to copy its depth-buffer technique blindly — but the provenance is unverifiable, which sits awkwardly against the repository's own source-locking standard (D-12). Recommend replacing with citable primary sources (the WGSL specification for f32 semantics; JPL/Horizons for ephemerides) at SA0-03. |
| PLAN-02 | Improvement | `tasks.md` entries are bare one-line checkboxes that defer all acceptance detail to `MASTER_PLAN.md`. Workable, but SA0-03 should attach explicit per-task acceptance criteria before execution, so completion cannot be claimed by checkbox alone — precisely the failure mode this audit was commissioned to catch. |
| PLAN-03 | Observation | The plan's recorded host / governor / transition / kernel API assumptions were captured *before* the performance campaign began mutating those files. This is exactly SA0-02's stated purpose and is already scheduled; recorded here so the re-audit is not skipped. |

---

## Defect count

| Severity | Count | Notes |
|---|---|---|
| P0 / Critical | 0 | None found; none reachable — no implementation exists |
| P1 / High | 0 | Same |
| P2 / Medium | 0 | Same |
| P3 / Low + Documentation | 1 | PLAN-01 (uncited research basis) |
| Improvement | 1 | PLAN-02 |
| Observation | 1 | PLAN-03 |

No repository defect was repaired, because none was found. Charter §17 ("fix every
confirmed P0/P1/P2") had no confirmed defects to act on. **No code was changed by this
audit.**

---

## Remaining limitations

- No Spatial Atlas runtime behavior, performance, resource, visual, compatibility, or
  accessibility property has been validated, because none exists.
- The `786d52b` full-gate figures quoted above are inherited from a prior session's
  record and were not re-executed in this audit.
- Plan review is a paper review. A sound plan is not evidence of a sound implementation;
  SA0–SA12 still require full execution and independent certification.
- The 11 uncommitted working-tree files were deliberately left untouched and are
  **unreviewed** by this audit — they belong to the active performance campaign.

---

## Recommended next action

Spatial Atlas is **correctly queued and correctly blocked**. Two coherent paths:

1. **Finish the active campaign first (recommended, and what the plan mandates).**
   Resume `whole-atlas-performance-optimization` at 25/246, close it, certify it, and
   record the certified SHA — which then satisfies the SA prerequisite and unblocks SA0.
2. **Explicitly pause the performance campaign with evidence**, per the prerequisite's
   own wording, then begin SA0. This first requires deliberately settling the in-flight
   uncommitted edits in `host.ts`, `TransitionDirector.ts`, and `SharedRendererKernel.ts`.

Either way, **another campaign is required.** Spatial Atlas cannot be certified until it
is built.
