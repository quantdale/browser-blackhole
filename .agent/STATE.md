# Durable project state

Last update: 2026-08-24 (M9 KERR CAMPAIGN) — **M9 KERR SPACETIME IMPLEMENTED
AND VALIDATED END-TO-END.** Kerr is the sixth production black-hole
experience state: a distinct numerical Boyer-Lindquist null-Hamiltonian
backend (CPU binary64 oracle + f32 TSL/WebGPU pass), signed dimensionless
spin through the canonical control channel, spin-dependent ISCO disk,
Schwarzschild-limit convergence gate, prograde/retrograde validation, Kerr
presets/goldens/benchmarks. Full Playwright suite 106/106; vitest 405/405;
all cumulative gates green; existing goldens and Schwarzschild/LUT behavior
unchanged.

## Current phase

**M9 COMPLETE (all packets M9-01..M9-10 / BH-200..BH-206).**
Next: CA7 Quasar/AGN per `docs/cosmic-atlas/ROADMAP.md`, or M10 observer
modes (Kerr-Schild migration decision recorded in KERR_BACKEND_ADR §1.10).

## M9 packet status

| Packet | Status | Evidence |
| --- | --- | --- |
| M9-01/BH-200 convention ADR | DONE | `docs/KERR_BACKEND_ADR.md` (all locked fields incl. formulation tradeoff BL vs KS vs separated; literature: BPT72/Chandrasekhar/MTW + Fujita Table 1 vectors; research CORRECTION found & recorded: static-tetrad phi-leg needs t-phi Gram-Schmidt — ADR §1.8) |
| M9-02/BH-201 CPU reference | DONE | `kerr/reference.ts`: binary64 RK4 BL-Hamiltonian over 5 vars w/ fixed E,L_z; full failure taxonomy (non-finite/null-constraint/carter-drift/max-steps/invalid-initial-state), Carter diagnostic, turn counts, disk-hit contract, path samples, signed azimuthal travel |
| BH-203 characteristic helpers | DONE | `kerr/characteristics.ts`: horizons, ergosurface(theta), BPT ISCO(signed-a*), photon orbit, emitter Omega/u^t/g — single authority, no duplication |
| M9-03..05/BH-202 GPU backend | DONE | `kerr/kerrIntegrator.ts`: fullscreen-triangle TSL material, compile-bound Loop(2048)+live uMaxSteps, flat-gate WebGL2-safe conditionals, bounded-magnitude NaN proxies, mirrored event policy, parity debug encoding, explicit magenta failures |
| M9-06 spin-aware disk | DONE | ISCO(spin) inner edge via centralized helper; `makeDiskEmissionNode` gained OPTIONAL live-inner binding (`innerRadiusRgLive`) so the Shakura-Sunyaev profile follows ISCO live without recompiles; Schwarzschild callers unchanged (goldens prove it); Kerr g=1/(u^t(1−Omega b_z)) raw into the shared g^3 node |
| M9-07 controls/persistence | DONE | `controlState.ts` normalizer (ONE authority); destination routes numerical/LUT/KERR passes per metric with truthful debug snapshot (`numerical-kerr`); 4 Kerr presets; dc/share/revisit/history persistence browser-proven |
| M9-08/BH-204 convergence | DONE | `tests/unit/kerrConvergence.test.ts`: a*=0 exact-limit agreement vs cpuReference (classification/minR/direction/hit-existence) + documented bounded LINEAR-in-\|a*\| departure bounds across ±{0.05..0.2} sweep |
| M9-09/BH-205 prograde/retrograde | DONE | BPT ISCO ordering vs published vectors; extremal limits; monotone ISCO; photon-orbit boundary; drag sign via signed phi travel; capture-basin ordering b_pro<b_0<b_retro matching known shadow edges (~2.7/5.1/6.7 measured); spin-sign+azimuth mirror symmetry; browser CPU/GPU parity corpus w/ non-vacuous backend proof |
| M9-10/BH-206 characterization | DONE | `benchmarks/results/2026-08-24-m9-kerr/` (5 records + SUMMARY) via honesty-gated `scripts/bench-kerr.mjs` (`npm run bench:kerr`); NO optimization performed (baseline-only, per plan §15) |

## Commit chain this campaign

```
58d2f0c feat: lock Kerr conventions (ADR) and validate binary64 reference physics (M9-01/M9-02)
34cfa7c feat: GPU Kerr numerical backend, live ISCO disk emission, metric/spin controls (M9-03..07)
3ec1c1c test: spin-zero convergence gate, prograde/retrograde suites, Kerr CPU/GPU parity + lifecycle; coordinate-pole stiffness fix w/ mirrored honesty gate (M9-08/09)
5942fa6 test: establish Kerr visual golden set; existing goldens unchanged
f8baa59 perf: characterize numerical Kerr backend (M9-10/BH-206 baseline)
0599136 docs: close M9 — ADR-018, cross-doc updates, durable STATE closure
```

Head at closure: **0599136** + this state fixup (final validation re-run: npm run check green incl. 405/405 vitest + build; full Playwright 109/109).

## Validation evidence (cumulative, this campaign's final state)

| Gate | Result |
| --- | --- |
| npm run check components | prettier clean; eslint clean; tsc clean |
| vitest | **405/405** across 25 files (351 pre-existing + 54 new Kerr tests) |
| npm run build | PASS (vite production build) |
| Playwright FULL suite | **106/106 PASS** (97 pre-existing incl. all goldens/lifecycle/torture + 9 new Kerr specs: 2 parity backends + 7 integration) |
| Visual goldens | **27/27 twice-stable**: 24 pre-existing UNCHANGED + 3 new Kerr (KERR_ZERO_SPIN, KERR_HIGH_PROGRADE, KERR_RETROGRADE) established then verified stable on repeat runs |

Environment exercised: Windows 11 (10.0.26200), Node v22.23.2, Edge 151
(msedge channel), **hardware WebGPU (amd rdna-2)** for all browser suites AND
WebGL2 fallback for the parity matrix rows; deterministic unit/reference
suites run portable (CI-representative).

Environment note: this machine had `core.autocrlf=true`, which made
`format:check` fail repo-wide against the LF-enforcing `.prettierrc.json`;
fixed LOCALLY by setting `core.autocrlf=false` + re-smudge. Fresh checkouts
on Windows should verify this before Gate A (recorded as environment debt).

## Key architectural decisions (see ADRs for full records)

1. BL Hamiltonian (not separated-potentials, not Kerr-Schild) for M9:
   turning-point-free momenta, smallest state, EXACT a→0 coordinate identity
   with the validated Schwarzschild system; KS = designated M10 plunge path
   (KERR_BACKEND_ADR §1.10).
2. Static-tetrad research correction: orthogonalized phi-leg; init is
   machine-null by construction (test-falsifiable).
3. Disk-corotating SIGNED-spin resolution of all BPT +- branches (disk sense
   fixed to +Y; spin sign transforms physics) — preserves every legacy
   preset/URL byte-for-byte.
4. Live ISCO emission binding: optional uniform-driven inner edge in the
   shared disk-emission graph; default path bit-compatible.
5. Coordinate-pole honesty gate (parity finding): pole-aware step factor +
   escaped-rays-with min|sinθ|<0.04 reclassified as explicit failure,
   mirrored CPU/GPU so corpora skip identical rows.
6. Backend routing truth: kerr ⇒ numerical-kerr always; LUT inapplicable;
   effectiveSpin forced 0 under Schwarzschild.

## Benchmark findings (M9-10 baseline)

Hardware WebGPU, rAF CPU-side deltas only (frameGpuMs null — no timestamps):
a*=0 / −0.7 / +0.9 at low tier (583×436): median ~13.9–14 ms (real cost —
NOT vsync-masked like Schwarzschild's ~7 ms); prograde high-spin tail p95
27.7/p99 34.8 ms (winding rays); medium native 778×581: median 34.8 ms;
ultra 1600×1007: median 180.8 ms. Per-spin medians equal; tails differ.
NO optimization performed in M9 (correctness-first per plan §15); the
baseline above is the BH-206 gate input for any future optimization.

## Known debt / limitations (updated)

1. (Carried from M8) LUT items: gFactorRelativeErrorMax placeholder;
   captured-class LUT columns routed to numerical oracle; no disk Doppler
   asymmetry baseline; eager LUT loading. Untouched by M9 by scope policy.
2. Kerr performance headroom: medium/native ~35 ms median on rdna-2 — below
   60 fps at default tiers on THIS hardware; optimization (separated-form,
   tile classification, adaptive stepping) deliberately deferred until needed
   (BH-206 baseline now exists).
3. Coordinate-pole passage limitation: escaped rays grazing within
   sin(theta)<0.04 of the axis classify as explicit numerical failure
   (magenta) rather than presenting untrusted directions; polar-orbit views
   will show failure pixels until an axis-regularized formulation lands.
4. Numerical-failure pixel COUNTS are not yet aggregated into benchmark
   records (visible via debug classification views only).
5. Spin-axis tilt unsupported (+Y only), truthfully reported; M10 item.
6. Kerr WebGL2 fallback: parity corpus PASSES on webgl2 project rows
   (executed evidence), but broad hardware coverage is NOT certified here
   (single-machine campaign) — treat wide-GPU certification as open.
7. Atlas navigation uses replaceState (single history entry); "back/forward"
   persistence means revisit-cache restoration (browser-tested), not
   multi-entry popstate timelines — matches the existing architecture.

## Deferred environment gates

None NEW. (Wide-hardware WebGPU certification remains a general release-gate
item per QUALITY_GATES Gate F, unchanged from before M9.) All M9 gates ran
for real on hardware WebGPU + WebGL2 fallback on this machine.

## Critical/High defects remaining

**Zero known Critical or High defects.** The two High-class candidates found
during the campaign were fixed at root cause and regression-pinned:
(a) static-tetrad orthogonality error (would have broken ALL Kerr physics —
caught by machine-null init test before any GPU work shipped);
(b) coordinate-pole RK4 stiffness (wrong directions presented as valid —
caught by the parity corpus, fixed with mirrored step/honesty policy).

## Next actions

1. CA7 Quasar/AGN per `docs/cosmic-atlas/ROADMAP.md` (scale-zone
   architecture; LensingService.createThinLensDisplacement stays the AGN
   reduced model — never a substitute for the strong-field passes).
2. OR M10 observer modes: first decision = Kerr-Schild migration per
   KERR_BACKEND_ADR §1.10 if plunge worldlines are in scope; tetrad init is
   already isolated behind one function for additive observer families.
3. Opportunistic Kerr follow-ups (Medium/Low debt list above): failure-count
   telemetry into bench records; Kerr LUT exploration ONLY after a validated
   mapping study; axis-tilt support (rotate init data into spin frame).
