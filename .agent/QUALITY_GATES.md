# Quality gates

These gates are cumulative. Later milestones inherit earlier gates. A gate that cannot run because of the execution environment is `DEFERRED_ENVIRONMENT`, never `PASS`.

## Gate A — repository health

Blocking requirements:

- clean dependency install from a fresh checkout using committed lockfile;
- exact supported Node/package-manager setup documented;
- `format:check` pass;
- lint pass;
- TypeScript typecheck pass;
- deterministic unit/reference tests pass;
- production build pass;
- no secrets, credentials, machine-specific absolute paths, editor junk, or accidental generated binaries;
- repository/scripts documented enough for a fresh agent to reproduce checks.

Evidence: exact commands and pass counts/status.

## Gate B — browser/runtime health

- application reaches explicit `READY`, compatible fallback, or useful terminal unsupported state;
- no uncaught page exception/unhandled rejection;
- no unexpected console error;
- actual backend displayed/queryable;
- canvas has valid positive internal dimensions;
- resize and high-DPR changes do not corrupt state;
- hidden/resume does not duplicate frame loop;
- renderer dispose/reinitialize does not duplicate listeners/resources;
- WebGPU initialization failures are surfaced;
- device loss has tested recovery/terminal error path once implemented.

Evidence: Playwright/runtime-status output plus screenshots/logs on relevant checkpoints.

## Gate C — physics/numerical correctness

Cumulative from M2:

- one centralized unit convention (`r_g=GM/c^2`, geometric `M=1` in normalized Schwarzschild core);
- landmarks tested: horizon `2`, photon sphere `3`, ISCO `6`, critical impact parameter `3 sqrt(3)`;
- static-observer tetrad/local-ray mapping satisfies null constraint;
- radial capture/escape pass;
- weak-field deflection approaches `4M/b` in valid regime;
- critical-boundary behavior captured by reference corpus;
- Schwarzschild rotational/spherical symmetry tests pass;
- CPU reference fixtures have convergence metadata;
- GPU selected rays agree within quantity-specific f32 tolerances;
- disk crossings converge under tighter settings from M3;
- frequency shift uses invariant `-k·u` and analytic static redshift test from M4;
- face-on symmetry/inclined Doppler ordering pass;
- normalized mass scale-invariance test passes;
- `MAX_STEPS`, non-finite, invalid state remain explicit;
- no scientific equation duplicated inconsistently across UI/shader/reference modules.

M8 adds numerical/LUT equivalence. M9 adds Kerr spin-zero and prograde/retrograde reference gates.

## Gate D — visual correctness

- deterministic seeds/time/camera/viewport/render scale for goldens;
- golden metadata records browser/backend/quality;
- diagnostic camera ray baseline from M1;
- Schwarzschild lensing baseline from M2;
- direct/higher-order disk scenes from M3;
- redshift/Doppler scene from M4;
- HDR/tone/bloom scenes from M5;
- debug views expose classification/steps and later required quantities;
- image thresholds explicit; goldens never auto-updated merely to green CI;
- physics probes accompany visually sensitive GR changes.

## Gate E — performance/resource health

From M6 onward:

- benchmark preset, internal dimensions, effective DPR/render scale, backend, browser/hardware, quality parameters recorded;
- shader/pipeline warmup separated from steady-state samples;
- median + p95/p99 frame times reported, GPU timestamps when genuinely supported;
- native DPR capped by policy;
- dynamic-resolution controller uses hysteresis and does not oscillate in test scenarios;
- moving/settling/stationary quality behavior tested;
- before/after evidence for claimed optimization;
- physics/visual tolerance revalidated after performance changes;
- render-target/LUT/history memory impact documented for large additions;
- hidden tab throttling is not misclassified as GPU benchmark result.

## Gate F — compatibility/degradation

- primary current Chromium desktop WebGPU path tested during development when environment supports it;
- `WebGPURenderer` WebGL2 fallback behavior tested only for features that genuinely support it;
- unsupported browser receives useful message, never blank canvas;
- WebGPU-only compute/storage features have explicit capability gating;
- touch/pointer/keyboard smoke before release;
- portrait/landscape/high-DPR behavior before release;
- HTTPS production context verified;
- OffscreenCanvas/Worker/SAB features, if introduced, have capability/deployment checks rather than assumptions.

## Gate G — resilience/security/provenance

- invalid presets/state fail safely;
- user state cannot inject JS/shader source;
- LUT/assets validate schema/checksum where specified;
- device-loss/backend recovery uses generation-safe lifecycle;
- no automatic remote telemetry/adapter-data upload;
- external dependencies/assets/data have license/provenance record;
- adapted external code preserves required notices;
- no unknown-provenance production asset;
- no secret/API key required or bundled for core app.

## Gate H — product integrity/accessibility

- Scientific and Cinematic controls visibly separated;
- control names/units match implemented equations;
- mass normalized/physical behavior explained correctly;
- unsupported future controls disabled rather than simulated deceptively;
- controls keyboard accessible and visibly labeled;
- mobile touch targets/gesture conflicts tested;
- canvas has textual explanation/current state outside bitmap;
- error/status states accessible without color alone.

## Gate I — release readiness

M11 only:

- Gates A–H pass or explicitly documented user-visible limitations accepted;
- clean production build/deployment verified from fresh checkout;
- browser/mobile compatibility matrix current;
- final benchmark report current;
- production presets and help text complete;
- diagnostic/debug-only controls cannot silently alter Scientific output;
- license/NOTICE/provenance audit complete;
- known Critical/High defects = 0;
- deferred environment gates resolved or explicitly accepted as release limitations;
- `.agent/STATE.md` records release commit and evidence.

## Severity policy

- **Critical:** crash/data/security issue, renderer unusable, gross scientific falsehood across ordinary output. Blocks checkpoint/release.
- **High:** major physics/rendering error, large regression, broken primary control/backend, hidden numerical failure. Blocks milestone.
- **Medium:** meaningful defect with workaround/limited scope. Must be tracked.
- **Low:** polish/documentation/minor edge case. Track or fix opportunistically.

Do not downgrade severity merely to advance milestone.