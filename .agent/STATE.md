# Durable project state

Last update: 2026-08-22 — M5 + GATE D + CA4 CAMPAIGN COMPLETE

All three campaign goals landed and validated on `main`:
M5 productization (canonical product state, experience modes, real control
panel, production presets), Gate D deterministic visual-regression framework
(12 twice-stable goldens across BH/NS/hyperspace/diagnostic/Stellar
Explosion), and the CA4 Stellar Explosion destination (route, timeline,
shock/volume/particles/jet models, hypernova + long-GRB presets,
phase-gated resources, governor integration).

## Current phase

**CAMPAIGN GREEN; READY FOR NEXT FEATURE CAMPAIGN.**
Full gates: `npm run check` PASS (format/lint/typecheck/169 unit/build);
Playwright **43/43** PASS (19 pre-existing incl. forced-backend +
integrator-parity, 12 golden, 12 stellar-explosion). Working tree clean;
`main` synchronized with `origin/main`.

## Campaign summary (what landed, in order)

1. `feat: canonical atlas product state` — CosmicAtlasStateV1 gains
   `experience.mode` (scientific/cinematic/debug) and `debug.diagnosticsEnabled`;
   rendering gains `dynamicResolution` + manual `renderScaleOverride`
   (`host.setRenderScaleOverride`, effectiveRenderScale). PresetDescriptor gains
   optional `display` + `recommendedQuality` (physics/observer/display/quality
   defined SEPARATELY). Share links encode `mode=`. Host §13 bloom throttle:
   cinematic bloom suspended at LOW tier during active camera interaction,
   restored on settle. Black-hole production presets: face-on-disk,
   edge-on-lensing, photon-ring, doppler-demo (display-only differences).
2. `feat: atlas ui component kit` (worker A, own branch merged) — pure-DOM kit
   under src/ui/atlas/: collapsible sections, slider/select/toggle/button rows,
   readout list, timeline transport, mode switch + shell CSS with reduced-motion
   and focus-visible policies; unit tests for pure helpers.
3. `feat: canonical atlas product state (host)` — setExperienceMode applies
   documented per-mode DISPLAY defaults (scientific = bloom OFF, never required),
   setVisual/setQualityMode/setTargetFps/setDiagnostics; preset.display applied
   on activation.
4. `feat: atlas product shell` — atlasApp.ts rewritten as the product UI:
   top bar (brand / destination chips / experience-mode segmented switch /
   panel toggle), canvas-dominant content row, compact collapsible control
   panel rebuilt from registry state per active destination+preset (Preset /
   Timeline / Observer / Visual / Rendering / Diagnostics(debug) / About-
   Fidelity). Controls write ONLY canonical host state. Diagnostic chip appears
   only in Debug mode. Hook surface unchanged for specs.
5. `test: deterministic visual golden framework` (worker B branch, finished by
   integrator) — tests/browser/support/goldenHarness.ts + visual-goldens.spec.ts
   - docs/cosmic-atlas/GOLDEN_IMAGES.md. Perceptual tolerances per golden;
     element screenshots of #viewport (UI-change-immune); determinism contract =
     pinned tier + explicit resize re-apply + linear display chain +
     PAUSE-BEFORE-NAVIGATE clock freezing + camera-settle wait.
6. `feat: stellar explosion physics core` (worker C output adopted after its
   45-min timeout; validated by integrator) — types/physics/timeline/shockShell/
   density/emission/jet/ejecta/presets: C1 free-expansion→Sedov shock law with
   dR/dt>=0 invariant, log-compressed deterministic timeline mapping (1e-9
   roundtrip), CPU+TSL dual-face density field (shell × asymmetry × seeded
   value-noise clumping × falloff), kelvin-ramp emissivity evolution, bipolar
   jet with clamped delta^3 viewing response, tier-scaled ParticleService plans,
   5 presets. 23 invariant tests.
7. `feat: stellar explosion destination rendering + registration` —
   stellarExplosionModule.ts composes VolumeService (half-res path FIRST REAL
   USER, jitter OFF — see defect notes), ParticleService (tier capacities,
   phase-scaled population), emissive progenitor surface, jet factor folded
   into volume emission gain with beaming-inspired viewing response; rendered
   jet front capped at 3x contemporaneous shell radius (disclosed coherence
   scaling). Resource phase awareness: volume+particles off through
   progenitor/collapse, ramped flash→expansion. enter() pauses clock at preset
   phase for deterministic arrival. Registered at /atlas/stellar-explosion.
8. `test: SN browser coverage + goldens` — 12 browser tests (deep links x4
   presets x both backends, mid-timeline ejecta visibility, GRB on/off-axis
   geometric divergence, scrub/reset tolerance-based determinism, transition
   integration in/out, extended 32-switch resource stress) + six SN goldens
   with documented rationale.
9. `perf: SN benchmark matrix recorded` — scripts/bench-stellar-explosion.mjs;
   results in docs/cosmic-atlas/BENCHMARK_MATRIX.md §9.

## Validation evidence (this campaign)

| Command                               | Result                                                                                                       |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `npm run check`                       | PASS — prettier/eslint/tsc clean, vitest 169/169 (14 files), vite build OK                                   |
| `npx playwright test`                 | PASS — 43/43 (6 smoke, 7 navigation, 4 webgl2, 2 integrator-parity, 12 visual-goldens, 12 stellar-explosion) |
| visual-goldens rerun (x2 stability)   | PASS 12/12 twice consecutively                                                                               |
| SN live probe (all 4 presets, WebGPU) | zero pageerror/console errors; non-uniform frames default + scrubbed                                         |
| SN deep links forced WebGL2           | PASS (poll-past-lazy-compilation pattern)                                                                    |

Environment: Windows, Node v22.23.2, Edge headless (channel msedge),
hardware WebGPU adapter "amd rdna-2"; forced ?backend=webgl2 exercised by the
webgl2 spec files on every atlas route incl. stellar-explosion.

## Performance baseline (hardware WebGPU)

Stellar Explosion (BENCHMARK_MATRIX.md §9): most phases ~7 ms median
submission wall time at Low/Medium/High internal scales; heaviest GRB-jet
phase: Low 7.0/13.9 ms, Medium 13.9/20.9 ms (768x640), High 20.8/27.8 ms
(960x800) — comfortably inside the Medium >=30 FPS budget, 60 Hz median at
Medium. Black-hole true-Low baseline unchanged from previous campaign
(13.9 ms median / 20.8 p95 @ renderScale 0.6); bloom interaction throttle now
additionally protects it during cinematic-mode camera motion.

## Defects found and fixed this campaign

1. GOLDEN NS_SURFACE verification failure — destinations integrate their own
   clocks from frame dt, so pausing AFTER arrival left load-dependent rotation
   phase. Fix: harness pauses the shared clock BEFORE navigating (destination
   enters frozen at phase 0) + explicit camera-settle wait (<1e-4 delta).
2. SN volume flicker — temporalJitter WITHOUT accumulation read as animated
   grain (measured luminance oscillation 51<->137 between frames). Fix: jitter
   disabled in the destination (documented in-module); residual banding
   absorbed by step budget.
3. Tier-pin without resize — governor.configure({qualityMode}) changes
   renderScale but nothing re-drives canvas sizing; first Medium benchmark
   silently measured Low-resolution frames. Fix in bench harness + documented
   requirement for any deterministic capture flow.
4. Worker-C timeout adoption — sn-core worker hit its 45-min budget AFTER
   writing all files but BEFORE committing/validation; integrator adopted the
   orphaned output into main, ran gates (23/23 invariants, lint, tsc), fixed
   API mismatches, and committed with provenance noted.
5. Managed-worktree quirk — the uikit child received the MAIN checkout as its
   "worktree" (branch campaign/ui-kit checked out in situ). Integrator kept
   uncommitted work isolated by ownership discipline (child committed only its
   own paths) and fast-forwarded main afterwards. Watch for this if reusing
   parallel workers here.

## Quality-gate status (cumulative)

- Gate A repository health: PASS (commands above).
- Gate B browser health: PASS (43/43; no uncaught errors; backend reported).
- Gate C physics correctness: PASS for scope — SN model invariants executed
  (23 tests: monotonic radius, non-negative finite bounded density, seed
  reproducibility/morphology change, hypernova structural distinction, jet
  basis/opening-angle/viewing-response, timeline roundtrip/order/reset);
  black-hole parity corpus unchanged and still green.
- Gate D visual correctness: PASS — 12 goldens, documented tolerances +
  why/what-caught per row (GOLDEN_IMAGES.md), never auto-updated to green.
- Gate E performance/resource health: PASS for scope — SN matrix recorded;
  32-switch stress bounded (live scopes +1 cap, GPU bytes <1.75x baseline).
- Gate F compatibility: PASS — hardware WebGPU + forced WebGL2 across all
  routes including stellar-explosion.
- Gate H product integrity/accessibility: PASS for scope — keyboard-operable
  panel (native buttons/radios/ranges), visible focus, labelled controls with
  units, aria-expanded/pressed/checked semantics, mobile bottom-drawer layout,
  reduced-motion honored (transitions + CSS), Scientific/Cinematic/Debug
  visibly separated; debug-only surfaces hidden outside Debug mode.

## Deferred / known gaps (honest)

1. Post cost not yet isolated as a standalone number (bloom on/off A/B) —
   bloom remains threshold-gated display-side and is force-off during LOW-tier
   interaction; a dedicated post benchmark is nice-to-have.
2. Governor auto-recovery manual probe on a real vsynced 60 Hz display still
   outstanding (carried over; headless cadence makes it flaky as an automated
   gate).
3. SN physical sliders (energy proxy etc.) are preset-level, not live-bound;
   module reads validated state at prepare/enter. Live control binding would
   need destination-side uniform plumbing (follow-up campaign candidate).
4. Half-res volume composite is linear upsample without depth-awareness
   (VolumeService documented limitation; haloing acceptable at current scales).
5. Parity corpus g-factor extension still open (carried over).

## Next actions

1. Next feature campaigns in roadmap order: LUT/M8 backend (BH-160..165) or
   Kerr/M9 — NOT started in this campaign per mission stop condition.
2. Optional hardening: dedicated SharedPost A/B benchmark; live SN control
   binding; depth-aware half-res upscale in VolumeService.
