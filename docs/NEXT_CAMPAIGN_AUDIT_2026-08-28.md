# Fast repository audit — 2026-08-28

Audit target: `quantdale/browser-blackhole`
Audit base: `main@02d129fe29d3f4fa383c3ed5760d70b7381a0191`
Mode: rapid evidence-driven repository review for next-campaign selection

## Executive verdict

**Choose a Codebase Hardening Campaign, specifically the existing `whole-atlas-performance-optimization` OpenSpec. Do not start another feature campaign.**

The current intended product surface is already certified production-ready with eight Cosmic Atlas destinations. The final production-readiness change records P0=0 and P1=0, clean dependency install, 515/515 unit tests, 131/131 local capable-runner browser tests, 43/43 visual goldens twice-stable, a local Firefox second-engine gate, bounded resource-lifecycle coverage, a clean production build, and zero npm audit vulnerabilities.

The most valuable remaining work is therefore systemic performance hardening while preserving visual and scientific output. A detailed OpenSpec already exists at:

`openspec/changes/whole-atlas-performance-optimization/`

Its implementation checklist is still unexecuted at this audit base.

## What was inspected

This rapid audit checked:

- the complete recursive repository tree;
- the 146-path `src/` surface;
- the 122-path test/benchmark surface;
- CI workflow and package scripts;
- final production-readiness certification and defect ledger;
- M12 Neutron Star, repository-integrity, and CA9 completion checklists;
- renderer/kernel/resource/governor architecture;
- current OpenSpec project context;
- the complete whole-atlas optimization proposal/design/master plan/execution prompt/task state;
- current agent control-plane files;
- repository code-search hits for TODO/FIXME/HACK/placeholder markers.

No TODO/FIXME/HACK/placeholder code-search hits were found at the audit base.

## Verified current state

### Production surface

Eight production destinations are present:

1. Black Hole
2. Neutron Star
3. Stellar Explosion
4. Compact Merger
5. Tidal Disruption Event
6. Quasar / AGN
7. Black-Hole Merger
8. Galaxy Collision

The repository contains dedicated physics/data paths, browser suites, visual goldens, benchmark harnesses, resource-lifecycle coverage, compatibility tests, accessibility tests, device-loss tests, parity/reference tests, and release documentation.

### Release status

The final-production-readiness OpenSpec is fully checked off. Its ledger records no open P0/P1 defects. Hosted CI intentionally runs deterministic quality plus a cheap browser smoke; GPU-heavy behavioral/parity/golden and Firefox coverage remain documented capable-runner gates rather than falsely reported hosted-CI gates.

### Existing optimization evidence

The whole-atlas performance plan records the dominant cost concentration:

- Schwarzschild LUT: roughly 10 ms GPU render-pass cost in the recorded campaign setup;
- Schwarzschild numerical: roughly 41 ms;
- Kerr static: roughly 129 ms;
- most non-black-hole destinations: roughly 0.5–0.8 ms.

The plan also identifies avoidable work outside strong-field shaders.

## Findings / remediation map

| ID | Severity | Finding | Required action | Verification |
| --- | --- | --- | --- | --- |
| Q-01 | P1 operational | `.agent/START_HERE.md` and `.agent/EXECUTION_PROMPT.md` still state there is no active campaign, while `whole-atlas-performance-optimization` is already committed and ready. This can make an autonomous agent stop or start obsolete work. | Point the control plane to the active performance OpenSpec. | Fresh agent reading START_HERE reaches the optimization execution prompt first. |
| Q-02 | P2 performance | Stationary/paused scenes can continue flowing through update/render/post work when pixels have not changed. | Implement host-owned invalidation and wake-on-change rendering. | Paused stationary tests show near-zero destination draws between invalidations; all goldens pass. |
| Q-03 | P2 performance | Incoming destination rendering can occur beneath a mathematically fully opaque transition. | Expose transition occlusion state and skip hidden destination draws while preserving required state progression. | Draw counters prove suppression during opaque interval; hyperspace/reduced-motion gates pass. |
| Q-04 | P2 startup/resource | Heavy destination implementations and multiple black-hole strong-field passes are created/imported earlier than necessary. | Dynamic-load heavy destination implementations and lazy-create only the selected black-hole pass. | Smaller initial chunks, lower first-use cost, bounded resource counts, backend-switch tests pass. |
| Q-05 | P2 GPU | Volume quality knobs do not necessarily reduce the shader loop bound; static/zero-population particle systems and unchanged ribbon/trajectory buffers can do unnecessary work. | Add real active-step/work-budget controls, static/paused particle semantics, revision-gated uploads and conservative skipping/culling. | Dispatch/draw/upload counters fall under matched scenes; destination goldens/parity pass. |
| Q-06 | P2 strong-field | Kerr and numerical Schwarzschild remain the dominant GPU costs. | Optimize only after telemetry/work-elimination foundations; require equal-fidelity reference/parity evidence for termination/adaptive/classification prototypes. | Matched before/after GPU timing plus unchanged ray classifications/tolerances and twice-stable goldens. |
| Q-07 | P2 evidence | The performance checklist is still unchecked, so no optimization should be claimed complete. | Establish baseline artifacts first and mark tasks only with evidence. | Benchmark JSON includes SHA, adapter/browser/backend, quality, internal resolution and timing source. |

## Correct next phase

**Performance hardening only.**

Do not add new astrophysical destinations until this campaign is either completed or intentionally stopped with evidence. Current product functionality is sufficient for the certified scope; the best return is removing waste and improving constrained-hardware behavior without degrading visuals or scientific fidelity.

## Smallest effective execution sequence

1. **WS0 — Baseline + telemetry**
   - clean install/check;
   - full eight-destination benchmark matrix;
   - GPU/CPU/draw/resource counters;
   - archive baseline under `benchmarks/results/`.

2. **WS1 — Frame invalidation + page visibility**
   - render only on semantic invalidation where scenes are static;
   - wake on input/time/control/asset/resize/quality/transition changes;
   - stop nonessential hidden-tab work and reset timing cleanly on resume.

3. **WS2 — Transition occlusion + warmup**
   - skip destination pixels guaranteed to be hidden;
   - overlap safe `compileAsync` work during opaque transition windows;
   - preserve transition visuals and cancellation behavior.

4. **WS3 — Startup + lazy resource construction**
   - split lightweight descriptors from heavy implementations;
   - dynamic-load Black Hole and Neutron Star implementations;
   - replace eager black-hole pass tuple with active-pass lifecycle.

5. **WS4 — Shared work-elimination**
   - real volume active-step budgets;
   - static/paused/zero-population particle semantics;
   - revision-gated ribbons/trajectory uploads;
   - SharedPost invalidation and measured bloom work;
   - global WorkBudget integration.

6. **WS5 — Strong-field optimization**
   - Schwarzschild LUT/numerical;
   - Kerr step census/termination/adaptive/classification experiments;
   - keep only measured equal-fidelity wins.

7. **WS6 — Destination-specific cleanup**
   - Neutron Star, Stellar Explosion, Compact Merger, TDE, AGN, BHM, Galaxy Collision;
   - eliminate unchanged CPU generation/upload/update work specific to each.

8. **WS7 — Compatibility/resource/release certification**
   - forced WebGL2 capable runner;
   - Firefox second-engine gate;
   - full behavioral/parity suite;
   - full goldens twice-stable;
   - repeated-navigation resource plateau;
   - matched before/after benchmark reruns;
   - author `docs/PERFORMANCE_CERTIFICATION.md`.

## Acceptance rules

- No performance claim without matched evidence.
- Do not weaken scientific tolerances or classify failed rays as success.
- Do not regenerate visual goldens merely to hide an optimization regression.
- Preserve WebGPU preferred + WebGL2 fallback.
- Preserve DATA_DRIVEN semantics for BHM/GC and DIRECT/reference contracts for strong-field paths.
- Revert or reject optimizations whose gain is noise, whose complexity is unjustified, or whose fidelity/resource behavior regresses.
- Environment-unavailable gates are `DEFERRED_ENVIRONMENT`, never PASS.

## Completion definition

The campaign is complete only when all justified high-value tasks in `openspec/changes/whole-atlas-performance-optimization/tasks.md` are implemented or explicitly rejected with evidence, all eight destinations have matched before/after data, idle/occluded waste is materially reduced, strong-field changes preserve parity, resource growth remains bounded, WebGPU/WebGL2 contracts remain sound, full relevant gates pass, documentation is synchronized, and `docs/PERFORMANCE_CERTIFICATION.md` records the final evidence.

The canonical autonomous execution instructions are:

`openspec/changes/whole-atlas-performance-optimization/EXECUTION_PROMPT.md`
