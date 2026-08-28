# Tasks — Spatial Atlas Continuous Navigation

This is the executable checklist. `MASTER_PLAN.md` supplies rationale and acceptance detail.

## Prerequisite

- [ ] Active `whole-atlas-performance-optimization` campaign is closed or explicitly paused with evidence.
- [ ] Spatial branch rebased onto the resulting certified commit.

## SA0 — re-audit

- [ ] SA0-01 fresh checkout health/baseline.
- [ ] SA0-02 inspect final host/governor/transition/kernel APIs.
- [ ] SA0-03 author/lock Spatial ADRs.
- [ ] SA0-04 record pre-Spatial browser/resource/perf baseline.

## SA1 — coordinate/catalog

- [ ] SA1-01 astro coordinate math.
- [ ] SA1-02 ICRF reference-frame service.
- [ ] SA1-03 origin rebasing.
- [ ] SA1-04 high/low encoding utility/tests.
- [ ] SA1-05 angular-size/SSE helpers.
- [ ] SA1-06 entity schema.
- [ ] SA1-07 minimal curated catalog.
- [ ] SA1-08 deterministic build/validate tooling.
- [ ] SA1-09 precision/unit/source tests.

## SA2 — Explorer skeleton

- [ ] SA2-01 `/atlas/explore` descriptor/preset.
- [ ] SA2-02 lifecycle module.
- [ ] SA2-03 static background.
- [ ] SA2-04 first proxy anchors.
- [ ] SA2-05 ResourceScope ownership.
- [ ] SA2-06 debug snapshot.
- [ ] SA2-07 browser boot.
- [ ] SA2-08 repeated switch leak test.

## SA3 — spatial camera

- [ ] SA3-01 SpatialCameraController.
- [ ] SA3-02 logarithmic range.
- [ ] SA3-03 orbit.
- [ ] SA3-04 focus animation.
- [ ] SA3-05 cancellation/retarget.
- [ ] SA3-06 dynamic clip policy.
- [ ] SA3-07 touch/pinch.
- [ ] SA3-08 reduced motion.
- [ ] SA3-09 focus deep link.
- [ ] SA3-10 precision browser probes.

## SA4 — discovery

- [ ] SA4-01 instanced marker layer.
- [ ] SA4-02 projected physical size.
- [ ] SA4-03 marker/proxy crossfade.
- [ ] SA4-04 hierarchy aggregation.
- [ ] SA4-05 DOM/SVG label overlay.
- [ ] SA4-06 collision/priority.
- [ ] SA4-07 stable placement.
- [ ] SA4-08 screen-space picking.
- [ ] SA4-09 search index.
- [ ] SA4-10 accessible object list.
- [ ] SA4-11 focus card.
- [ ] SA4-12 tests.

## SA5 — semantic zoom

- [ ] SA5-01 ScaleBandController.
- [ ] SA5-02 visibility policies.
- [ ] SA5-03 unit normalization.
- [ ] SA5-04 cross-band overlap.
- [ ] SA5-05 hysteresis.
- [ ] SA5-06 label budgets.
- [ ] SA5-07 motion tuning.
- [ ] SA5-08 screen-space LOD.
- [ ] SA5-09 stress data.
- [ ] SA5-10 forced WebGL2.

## SA6 — entry handoff

- [ ] SA6-01 spatial handoff descriptor.
- [ ] SA6-02 prefetch scheduler.
- [ ] SA6-03 module prefetch.
- [ ] SA6-04 minimum-ready target.
- [ ] SA6-05 compileAsync.
- [ ] SA6-06 transition presentation modes.
- [ ] SA6-07 continuous handoff.
- [ ] SA6-08 angular matching.
- [ ] SA6-09 rollback.
- [ ] SA6-10 race suite.
- [ ] SA6-11 Black Hole integration.
- [ ] SA6-12 Neutron Star integration.

## SA7 — exit handoff

- [ ] SA7-01 return affordance.
- [ ] SA7-02 Explorer matched target.
- [ ] SA7-03 snapshot exit.
- [ ] SA7-04 zoom-out boundary.
- [ ] SA7-05 browser history.
- [ ] SA7-06 conceptual fallback.
- [ ] SA7-07 repeat tour.

## SA8 — production spatial data

- [ ] SA8-01 source policy.
- [ ] SA8-02 source manifest.
- [ ] SA8-03 Horizons tool where needed.
- [ ] SA8-04 compact object anchors.
- [ ] SA8-05 historical events.
- [ ] SA8-06 quasar/AGN anchors.
- [ ] SA8-07 reality/fidelity audit.
- [ ] SA8-08 provenance UI.
- [ ] SA8-09 time semantics.
- [ ] SA8-10 reproducibility.

## SA9 — all current destinations

- [ ] SA9-BH.
- [ ] SA9-NS.
- [ ] SA9-SE.
- [ ] SA9-CM.
- [ ] SA9-TDE.
- [ ] SA9-QSO.
- [ ] SA9-BBM.
- [ ] SA9-GC.

## SA10 — advanced continuity

- [ ] Evaluate ICRF real-star background.
- [ ] Evaluate richer galaxy proxies.
- [ ] Evaluate better exposure/background continuity.
- [ ] Evaluate proper motion/deep time.
- [ ] Keep rejected experiments documented.

## SA11 — hardening

- [ ] SA11-01 on-demand Explorer idle.
- [ ] SA11-02 draw call audit.
- [ ] SA11-03 label CPU audit.
- [ ] SA11-04 transform precision/perf.
- [ ] SA11-05 asset/KTX2 audit.
- [ ] SA11-06 prefetch limits.
- [ ] SA11-07 resource plateau.
- [ ] SA11-08 mobile.
- [ ] SA11-09 WebGL2.
- [ ] SA11-10 Firefox.
- [ ] SA11-11 device loss.
- [ ] SA11-12 large-catalog stress.
- [ ] SA11-13 long-run performance.

## SA12 — release

- [ ] SA12-01 UI polish.
- [ ] SA12-02 accessibility.
- [ ] SA12-03 route policy.
- [ ] SA12-04 default-root decision.
- [ ] SA12-05 preserve fallback navigation.
- [ ] SA12-06 full browser tour.
- [ ] SA12-07 full unit suite.
- [ ] SA12-08 existing destination regressions.
- [ ] SA12-09 goldens twice stable.
- [ ] SA12-10 performance certification.
- [ ] SA12-11 provenance/license audit.
- [ ] SA12-12 user/technical docs.
- [ ] SA12-13 `.agent` control-plane update.

## Completion

Do not close this change until every justified blocking task is checked with evidence or explicitly rejected/deferred with a written reason and no P0/P1 remains.