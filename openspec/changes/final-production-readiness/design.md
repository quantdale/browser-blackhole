# Design: Final production-readiness certification

## Root-cause analysis (evidence-first)

Source: hosted run `33039618290`, HEAD `7d6d19d`, job `browser (Chromium, full suite; WebGL2 fallback)`.
Full failed log archived during investigation; aggregate outcome counts:

| Outcome | Count | Mechanism |
| --- | --- | --- |
| `[default]` pass | 68 | got a clean CPU slot; app boots and arrives correctly (one passed at 46.9s) |
| `[default]` fail | 69 | 66 × `Expected "arrived"/Received "transitioning"` (30s poll) + test-level 60s/120s timeouts |
| `[firefox]` fail | 12 | `browserType.launch: Executable doesn't exist` — Firefox never installed |
| skipped (`-`) | 46 | 42 visual goldens (serial-describe cascade behind the first golden's timeout) + 4 mobile-touch |

No line reports a functional assertion mismatch, golden pixel-tolerance failure, magenta failure-pixel, or NaN. Every failure reduces to (a) Firefox-not-installed or (b) software-WebGL2 CPU starvation.

### Why 2 workers starve on the hosted runner

`playwright.config.ts` sets `fullyParallel: true` and lets Playwright pick workers (= 2 on a 2-vCPU runner). Hosted runners have no WebGPU adapter, so every scene renders through software WebGL2 (SwiftShader) on the CPU. Two concurrent heavy render contexts contend for the same 2 cores. The atlas transition/arrival state is driven by a `requestAnimationFrame` clock; when a worker is CPU-starved its rAF callbacks stall, the transition never completes, and the 30s arrival poll fails with `transitioning`. This is contention, not a defect — proven by the 68 passes in the same run.

### Why the visual goldens cannot run in the hosted job

`docs/cosmic-atlas/GOLDEN_IMAGES.md` documents the committed baselines as **hardware-WebGPU** captures (`BH_CLASSIC`, `NS_*`, `KERR_*` explicitly "hardware WebGPU baseline"); only `ATLAS_DIAGNOSTIC` is backend-free. Comparing a software-WebGL2 render against a WebGPU-hardware baseline is a cross-backend, cross-hardware pixel comparison that the perceptual tolerances (meanAbsDelta 2–8) are not designed to survive. The goldens are therefore a **local capable-runner gate** (as `docs/CI_CD.md` §40 already stated) and must be excluded from the hosted job, not silently cascade-skipped behind a timeout.

## CI topology

```
quality (ubuntu)  ── format/lint/typecheck/unit/build            [unchanged, already green]
   │
   ├─ browser-chromium (ubuntu ×4 shards, fail-fast:false)
   │     npx playwright test --project=default --workers=1 \
   │        --grep-invert "golden:" --shard=N/4
   │     138 behavioral+parity tests, ~35/shard, serial per shard
   │
   └─ browser-firefox (ubuntu)
         install firefox; npx playwright test --project=firefox
         4 compatibility-matrix tests, workers:1 (config-pinned)
```

Design decisions:

- **workers=1, not a higher timeout.** The failures are starvation, not a slow app; inflating timeouts would hide contention and lengthen every run. Removing concurrency removes the mechanism. (Stop-condition rule: never fix a starvation timeout by increasing a fixed delay.)
- **Sharding restores wall-clock without re-introducing contention.** Each shard is a separate runner with its own 2 vCPUs and a single worker, so shards never share a CPU. 138 tests ÷ 4 ≈ 35/shard. `fail-fast: false` so a red shard does not cancel the others and self-attributes.
- **Goldens excluded via `--grep-invert "golden:"`.** Verified surgical: only `visual-goldens.spec.ts` titles contain `golden:` (138 selected vs 181 default-total vs 43 goldens). This is not coverage-narrowing-for-speed; it routes a hardware-WebGPU gate to the environment it was designed for.
- **Parity corpuses stay in scope.** They request `?backend=webgpu|webgl2` but do not skip when WebGPU is unavailable; the app falls back to WebGL2 and the test still validates the *numerical* parity of decoded rays against a binary64 CPU reference within f32 tolerance — valid on software WebGL2.
- **Firefox as its own job.** The `firefox` project is `testMatch`-scoped to `compatibility-matrix.spec.ts` and `workers:1` in config; installing Firefox and selecting the project makes the declared second-engine coverage real. This suite has never executed green on a hosted runner, so its first green run is treated as a genuine unknown, not a formality.

## `.gitattributes` line-ending fix

`* text=auto eol=lf` with `*.png binary` / `*.bin binary`. A one-time `git add --renormalize .` touches only 4 stray CRLF-blob data files (`black-hole-merger/manifest.json`, `reduction-report.json`, `galaxy-collision/gc1.manifest.json`, `tests/unit/fixtures/bbm-parity.json`); their content diff ignoring whitespace is empty, they are JSON-parsed (not raw-hashed — the `.bin` is the checksummed artifact and stays `binary`), and the 63 data-loader/parity unit tests pass unchanged. All other text blobs were already LF (autocrlf normalized them on commit).

## Truthfulness constraints (carried from prior campaign rules)

- Never weaken assertions/tolerances/budgets merely to pass.
- Never mark an environment-unavailable gate PASS; record it DEFERRED_ENVIRONMENT with the reason.
- Never claim a browser/engine is supported without an executed green run.
- Never auto-update goldens to hide drift.
- A test dismissed as flaky must have its mechanism identified and fixed, not retried until green.

## Validation plan

1. Local (Windows, capable GPU where available): `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build`; `format:check` verified via a clean LF worktree; visual goldens run locally with evidence.
2. Hosted: push and observe real runs; require ≥3 consecutive green `browser-chromium` (all shards) + `browser-firefox`.
3. Record all results in the defect ledger and `docs/RELEASE_CERTIFICATION.md`.
