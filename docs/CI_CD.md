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

### browser-chromium (WebGL2 fallback; behavioral+parity)

- install the pinned Playwright Chromium browser (`--with-deps chromium`);
- build and serve the production artifact;
- run the Playwright `default` project **serially** (`--project=default --workers=1`) with the visual goldens excluded (`--grep-invert "golden:"`), **sharded** across independent runners (`--shard=N/6`);
- archive screenshot/console logs on failure.

Hosted runners provide no representative WebGPU adapter, so this job exercises the WebGL2 fallback path for every test that adapts to backend. It is a broad fallback-suite run, NOT a WebGPU validation: never read a green run as proof the WebGPU path rendered.

`--workers=1` is mandatory, not a speed choice: two software-WebGL2 (SwiftShader) render contexts starve each other on a 2-vCPU hosted runner, and because the atlas arrival/transition clock advances from `requestAnimationFrame`, a starved worker never reaches the `arrived` state within the 30s poll and the test times out. Sharding restores wall-clock across separate runners (no shared CPU), so behavioral+parity coverage is preserved, not narrowed. The GPU CPU/GPU **numerical**-parity corpuses stay in scope here: they decode rendered rays and compare against a binary64 CPU reference within f32 tolerance, which holds under the WebGL2 fallback regardless of the requested backend label.

### browser-firefox (compatibility matrix; WebGL2)

- install the pinned Playwright Firefox browser (`--with-deps firefox`);
- build and serve the production artifact;
- run only the `firefox` project (`--project=firefox`), which `playwright.config.ts` scopes to `compatibility-matrix.spec.ts` and pins to `workers:1`;
- archive screenshot/console logs on failure.

This is the engine-agnostic fallback/unsupported-logic matrix on a second engine. Firefox must be installed explicitly; a bare `npx playwright test` runs *all* projects, so previously the Firefox project launched with only Chromium installed and failed immediately (`Executable doesn't exist`). Splitting it into its own job with Firefox installed makes the declared second-engine coverage actually execute.

### visual (local capable runner)

The golden suite (`tests/browser/visual-goldens.spec.ts`, `golden:` titles) is a **local capable-runner gate**, deliberately excluded from the hosted browser job. Its committed baselines are hardware-WebGPU captures (`docs/cosmic-atlas/GOLDEN_IMAGES.md`) and cannot be pixel-matched against a software-WebGL2 (SwiftShader) render, so running them on a hosted runner would gate on the wrong environment. Run them where the baselines were captured; record the result as environment-deferred for hosted CI rather than silently green. Prefer an environment with reproducible browser/rendering characteristics. Mark platform-specific baselines clearly (`_GL2` suffix rows) only if the backends demonstrably diverge beyond shared tolerances.

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

Every job name and report must say what actually ran. The hosted browser job is `browser-fallback` (full Playwright suite on Chromium under WebGL2 fallback), never `gpu-test`, because the runner never acquired WebGPU. Environment-deferred gates are recorded explicitly, not silently marked successful.
