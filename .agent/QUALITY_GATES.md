# Quality gates

These gates are cumulative. A later milestone inherits earlier gates unless the roadmap explicitly replaces one.

## Gate A — repository health

- clean dependency install from a fresh checkout;
- lockfile committed;
- formatting/lint/typecheck pass;
- unit tests pass;
- production build passes;
- no secrets or machine-specific absolute paths committed.

## Gate B — browser health

- application boots in the primary supported Chromium browser;
- no uncaught page exceptions;
- no unhandled promise rejection;
- WebGPU initialization failures are surfaced clearly;
- device loss has a visible recovery/error path;
- resize, DPR changes, and tab visibility changes do not corrupt renderer state.

## Gate C — physics correctness

- analytic Schwarzschild landmarks are encoded as tests: horizon `2 r_g`, photon sphere `3 r_g`, ISCO `6 r_g`;
- representative rays classify correctly as captured/escaped/disk-hit;
- large-impact-parameter deflection trends toward the weak-field limit;
- symmetry checks pass for Schwarzschild;
- GPU results remain inside documented tolerances versus reference calculations;
- physics constants/conventions are not duplicated inconsistently across modules.

## Gate D — visual correctness

- deterministic presets have golden/reference captures;
- image comparison tolerance is explicit and justified;
- lensing, disk duplication, shadow, redshift/Doppler asymmetry, and tone mapping each have at least one regression scene once implemented;
- screenshots are captured at a fixed viewport, DPR, seed, camera, and quality tier.

## Gate E — performance

- representative scene benchmark captures CPU frame time and GPU time where timestamp queries are available;
- internal resolution and ray-step statistics are recorded with benchmark results;
- no change marketed as an optimization without before/after evidence;
- Auto quality keeps interaction responsive by lowering work before visual failure;
- native DPR is capped by policy instead of blindly inherited.

## Gate F — compatibility

- primary WebGPU path passes on at least current Chromium desktop during development;
- fallback behavior is tested and explicit;
- unsupported browsers receive a useful capability message rather than a blank canvas;
- touch/pointer/keyboard interactions are smoke tested before production readiness.

## Gate G — release readiness

- production build contains no debug-only control that changes scientific output silently;
- credits/licenses for external assets and adapted algorithms are documented;
- major controls have help text/units;
- preset URLs/state serialization, if implemented, reject malformed values safely;
- performance defaults are conservative enough to avoid immediately overwhelming integrated/mobile GPUs.
