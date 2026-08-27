# CI, validation automation, and release pipeline

CI must distinguish deterministic code/physics gates from environment-sensitive GPU/browser gates. A green CI badge must never imply a GPU path was tested when the runner cannot provide that environment.

## 1. Required local aggregate

`npm run check` (or selected package manager equivalent) should eventually execute, in deterministic order:

1. format check;
2. lint;
3. TypeScript typecheck;
4. unit tests;
5. CPU physics/reference tests;
6. build.

Browser/visual/performance suites remain separate because they may require browsers, artifacts, or GPUs.

## 2. GitHub Actions jobs

Recommended jobs:

### quality

- checkout;
- setup exact Node/package manager;
- dependency install with lockfile frozen;
- format check;
- lint;
- typecheck;
- unit/reference tests;
- build.

### browser-smoke (Chromium, WebGL2 fallback; M0 boot/fallback smoke)

- install the pinned Playwright Chromium browser (`--with-deps chromium`);
- build and serve the production artifact;
- run ONLY `tests/browser/smoke.spec.ts` on the `default` project (`--workers=1`);
- archive screenshot/console logs on failure.

This is the reliable hosted browser gate. It boots the ROOT experience — which renders the **cheap diagnostic gradient**, not the heavy lensing/Kerr passes — plus the forced-WebGL2 gradient and the forced-unsupported terminal UX. Being backend-agnostic and cheap, it is stable on software WebGL2 while still proving the app boots to a truthful ready/fallback/unsupported terminal state, the WebGL2 fallback path renders, the canvas is non-zero, interaction/resize are safe, and the console/page error channels stay clean (section 5). It is NOT a WebGPU or full-scene validation.

Why the full behavioral/parity/golden suite is NOT a hosted job: hosted runners have no GPU, so heavy TSL lensing/Kerr shaders and the full-screen hyperspace transition compile/render at seconds-per-frame under software WebGL2, and hosted runner speed varies wildly run-to-run (a black-hole arrival measured 18s in one hosted run and >180s in another). No fixed timeout survives that variance, so the full suite cannot be a *stable* hosted gate. It is a local capable-runner gate instead (see below) — this is explicit environment routing, not silent coverage reduction.

### full browser suite / parity / goldens / second engine (local capable runner)

Run on a WebGPU-capable machine (the environment the goldens' hardware-WebGPU baselines were captured on):

```bash
npm run e2e                                    # full default project: behavioral + numerical parity + visual goldens
npx playwright install firefox && npx playwright test --project=firefox   # second-engine compatibility matrix
```

- The **numerical CPU/GPU parity** corpora (`integrator-parity`, `kerr-parity`, neutron-star parity) decode rendered rays and compare against a binary64 CPU reference within f32 tolerance.
- The **visual goldens** (`tests/browser/visual-goldens.spec.ts`, `golden:` titles) compare against hardware-WebGPU baselines (`docs/cosmic-atlas/GOLDEN_IMAGES.md`); they cannot be pixel-matched on software WebGL2 and are therefore capable-runner-only. `ARRIVAL_TIMEOUT_MS` (env-overridable, `tests/browser/support/appHarness.ts`) covers slower local machines.
- **Firefox** headless has no WebGL context on a GPU-less host, so the second-engine compatibility matrix also runs on a capable local machine, not hosted CI.

Record each local-gate result (with counts and the machine/backend) as evidence in the release certification; mark it environment-deferred for hosted CI rather than silently green.

### docs/link

Optional later: validate internal Markdown links and required agent-state fields.

### benchmark

Do not run authoritative GPU performance benchmarks on arbitrary shared hosted runners. Use manual/self-hosted/known hardware and upload structured results.

## 3. Lockfile rule

CI installs exactly from the committed lockfile. Dependency updates are explicit changes with build/browser verification.

Do not use floating `latest` installs in CI.

## 4. Caching

Cache package-manager downloads, not generated test truth. Never cache build artifacts in a way that can skip compilation of changed shader code.

Playwright browser caching is acceptable if version-keyed correctly.

## 5. Browser smoke requirements

Smoke test should fail on:

- page crash;
- unhandled rejection;
- uncaught exception;
- unexpected console error;
- renderer initialization timeout;
- missing canvas;
- zero-size render surface;
- missing status/backend label;
- fatal asset load.

The test must distinguish expected warnings for unsupported WebGPU from real failures.

## 6. Deterministic browser test API

Expose development/test-only hooks behind build environment or a namespaced global, for example:

```ts
window.__BLACKHOLE_TEST__ = {
  loadPreset(id),
  setFixedTime(t),
  setViewportQuality(...),
  waitForStableFrame(),
  getRuntimeStatus(),
  captureProbe(x, y)
}
```

Keep this API small and documented. Production may omit it if feasible.

### URL decision overrides

Dev/test-only query parameters force backend/debug decisions so fallback UX
stays exercisable on capable machines (implemented in `src/app/testHooks.ts`,
consumed by both application shells):

- `?backend=webgpu|webgl2|unsupported` — pins the renderer decision. On the
  root route it overrides the capability decision directly. On `/atlas/*`
  routes it forwards `webgpu`/`webgl2` to the shared kernel (`forcedBackend`
  option): `webgl2` boots `WebGPURenderer` pinned to its WebGL2 backend, and
  a forced `webgpu` that fails will not silently degrade. `unsupported` is a
  root-app terminal-UX concept; atlas boot failures surface through the atlas
  status line instead.
- `?view=diagnostic|environment|off` — root-route initial debug view.

Capability telemetry always reports the REAL probes regardless of overrides.

## 7. Visual regression strategy

Golden capture requires fixed:

- browser version;
- viewport;
- DPR/internal scale;
- preset;
- seed/time;
- temporal sample count;
- backend;
- tone-mapping path.

A visual diff failure should upload:

- expected;
- actual;
- diff image;
- metadata JSON;
- console/runtime status.

Do not auto-update goldens in CI.

## 8. Physics fixture generation

Fixture generation is a separate explicit command, never part of normal tests. Suggested:

`npm run physics:fixtures -- --case <id>`

Generation must:

- use converged high-precision/reference settings;
- write generator commit/method/settings;
- show old/new diff;
- require review.

Normal tests only consume committed fixtures.

## 9. Shader compilation coverage

Once multiple variants exist, browser tests should instantiate/compile each supported variant even if it is not default:

- numerical Schwarzschild;
- LUT Schwarzschild;
- Kerr numerical;
- forced WebGL2-compatible subset.

A dormant shader variant that no longer compiles is a failing build.

## 10. Capability injection tests

Where real hardware conditions are unavailable, unit-test decision logic with synthetic capability snapshots:

- WebGPU available/full features;
- WebGPU unavailable + WebGL2 available;
- no supported GPU backend;
- timestamp query missing;
- LUT feature/resource failure;
- reduced texture limits.

Do not mock GPU numerical correctness through these tests; they validate product decision logic only.

## 11. Device-loss/error tests

Implement injectable renderer lifecycle faults so browser tests can verify:

- device lost -> visible recovery state;
- successful recreation -> rendering resumes;
- repeated failure -> actionable terminal message;
- temporal/resources reset;
- no duplicate frame loops/event handlers.

## 12. Pull-request gate policy

Before M2:

- quality + browser smoke blocking where supported.

M2 onward:

- physics reference tests blocking.

M3 onward:

- core visual goldens blocking in deterministic environment.

M6 onward:

- benchmark report required for performance-sensitive changes, initially informational.

M8 onward:

- numerical/LUT equivalence suite blocking.

M9 onward:

- Kerr spin-zero convergence blocking.

## 13. Branch/commit policy for autonomous agents

At each coherent checkpoint:

- no unrelated files staged;
- all changed files reviewed via diff;
- tests recorded in checkpoint report;
- commit message identifies milestone/backlog IDs when useful;
- push branch;
- update `.agent/STATE.md` before handoff.

Do not rewrite shared history or force-push unless explicitly authorized.

## 14. Deployment preview

When hosting integration is added, PR previews should use the production build and HTTPS because WebGPU requires secure contexts in normal browser deployment.

Preview page must expose backend/status so reviewers know whether they saw WebGPU, fallback, or unsupported mode.

## 15. Production release gates

Release only when:

- cumulative quality gates pass;
- production build tested from clean install;
- HTTPS deployment verified;
- no source maps/secrets or development-only data unintentionally exposed;
- asset/provenance audit complete;
- browser matrix current;
- error UX tested;
- release benchmark report attached/linked;
- `.agent/STATE.md` and user docs reflect shipped state.

## 16. CI truthfulness rule

Every job name and report must say what actually ran. The hosted browser job is `browser-smoke` (M0 backend-agnostic boot/fallback smoke on Chromium under WebGL2 fallback), never `gpu-test` and never "full suite", because the runner never acquired WebGPU and cannot stably run the GPU-heavy scenes. The full behavioral/parity/golden suite and the Firefox second-engine matrix are local capable-runner gates whose results are recorded as evidence (section 2) and marked environment-deferred for hosted CI — recorded explicitly, never silently marked successful.
