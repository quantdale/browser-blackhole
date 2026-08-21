# Definition of done

This document prevents “implemented” from meaning merely “code exists.” Completion is evidence-based and cumulative.

## 1. Work-packet done

A packet is done when:

- behavior matches packet/spec;
- implementation is integrated, not dead/unreachable code;
- tests/probes cover the invariant;
- impacted existing tests pass;
- errors/failures are surfaced correctly;
- code is typed/linted/formatted;
- no unrelated regression known;
- docs/state updated if contract changed;
- commit is reviewable/buildable.

## 2. Physics packet done

Additionally:

- convention/source is explicit;
- CPU/reference implementation or analytic test exists;
- convergence/tolerance justified where numerical;
- GPU selected-ray results compared where applicable;
- symmetry/limit case included;
- NaN/max-step is not hidden as physical output.

## 3. Renderer feature done

Additionally:

- renderer resource lifecycle owned/disposed;
- resize/reinitialize behavior considered;
- backend capability behavior explicit;
- deterministic browser test/screenshot exists where appropriate;
- no unexpected console error;
- debug view/probe can inspect the feature if it affects core physics;
- performance impact measured once benchmark infrastructure exists.

## 4. UI control done

Additionally:

- canonical AppState field exists;
- validation/range/units defined;
- invalidation class correct;
- accessible label/keyboard behavior;
- mobile layout usable;
- Scientific vs Cinematic semantics truthful;
- preset/reset behavior deterministic;
- no raw uniform mutation from UI.

## 5. Optimization done

Additionally:

- baseline benchmark captured;
- optimized benchmark uses matching metadata;
- median and tail improvement reported;
- physics/visual error not materially worsened beyond documented tolerance;
- complexity justified by gain;
- fallback/resource implications documented.

## 6. Bug fix done

Additionally:

- deterministic reproducer or strongest available evidence;
- root cause identified;
- regression test fails before/fixed after where feasible;
- same bug class searched in adjacent code;
- no test disabled/threshold arbitrarily loosened.

## 7. Milestone done

All milestone packets required for exit are done plus:

- roadmap exit gate demonstrated;
- cumulative quality gates evaluated;
- environment-deferred gates named precisely;
- no unresolved Critical/High defect in milestone scope;
- browser evidence current;
- performance/visual evidence current when milestone requires;
- `.agent/STATE.md` advanced;
- repository clean at checkpoint.

## 8. Release done

M11 plus:

- production deployment over HTTPS verified;
- WebGPU/fallback/unsupported UX verified;
- browser/mobile matrix documented;
- device-loss/error recovery verified;
- asset/license/provenance audit complete;
- accessibility review complete;
- benchmark report complete;
- no debug-only behavior changes scientific output silently;
- no secrets/dev-only endpoints bundled;
- user documentation distinguishes simulation approximations from physical claims.

## 9. Not done examples

The following are not completion:

- “looks right” without physics tests;
- shader compiles but no browser run;
- unit tests pass but build fails;
- 60 FPS claim without internal resolution/settings;
- Kerr image spins visually but spin-zero limit fails;
- LUT output looks similar but no equivalence/error study;
- CI green because GPU test silently skipped;
- numerical failures painted black;
- an agent wrote docs for tests that do not exist;
- implementation exists only behind unused code path.

## 10. Evidence hierarchy

Strongest to weakest:

1. analytic invariant + deterministic automated test;
2. converged independent reference fixture + automated comparison;
3. deterministic browser/golden test;
4. reproducible benchmark artifact;
5. targeted manual debug/probe evidence;
6. visual inspection;
7. implementation claim.

Use the strongest evidence practical for the feature.