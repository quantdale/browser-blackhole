# Design — Destination control truthfulness

## Context

This change groups together defects that share one root cause: **a second, hidden source of truth
for a value the interface or the scene already owns.**

- The AGN module writes torus visibility from `state` qualified by `activeZone`, while a separate
  zone machine owns `activeZone` and never re-pushes. Two writers, one value.
- The Neutron-Star module exposes `observerInclinationDeg` in its public state while the camera rig
  owns the rendered observer. Two sources for one orientation.
- The dynamic-resolution toggle and the render-scale slider both write
  `renderScaleOverrideValue` with no reflection. One value, two controls, no agreement.
- The share decoder applies `experience` and then `sharedVisual`, but `setExperienceMode` writes the
  display defaults. One value, two writers, last-write-wins.

The Neutron-Star fidelity note is the same class of failure one level up: the note is a third source
of truth about the renderer, and it is stale.

The rule this change enforces is not "make the UI nicer". It is the rule already in `AGENTS.md`:
a control must have defined semantics, and a fidelity label is a contract.

## Goals / Non-Goals

**Goals**

- One source of truth per user-visible value.
- No user-visible claim that contradicts the runtime.
- No production-reachable debug surface.

**Non-Goals**

- No change to any physical model or preset default.
- No panel redesign, no visual restyle, no new controls.
- No golden re-baselining to hide anything. Correcting a *note* never changes a frame; if a frame
  changes, the frame was previously wrong and that is justified individually.
- No full accessibility programme; this closes the specific confirmed defects.

## Decisions

### D1 — AGN torus visibility is a pure function of `state.torusVisible`

**Decision.** Drop the `&& this.activeZone === 'nuclear'` term from the `setVisible` call.

**Rationale.** `applyZoneVisibility()` already sets `group.visible = (id === activeZone)` for every
zone group. Group-level exclusivity is therefore complete on its own. The extra term is redundant
when correct and wrong when stale, because it couples a state push to a value the state push does
not own. Removing it makes the torus correct in every zone by construction, and idempotent.

**Rejected alternative — re-push state on zone change.** Reachable, but it preserves two writers for
one value and will recur the next time a second consumer of `activeZone` appears.

**Also fixed here:** the debug snapshot must report *effective* visibility, not raw state. Reporting
raw state made diagnostics contradict the frame, which is what allowed this defect to survive
review.

### D2 — Neutron-star inclination is one live value shared by the control and the rig

**Decision.** `observerInclinationDeg` remains an exposed control. A user change sets
`CameraRig` polar angle. An orbit gesture writes the resulting polar angle back to canonical state
and the displayed control. A preset may seed the rig when the destination enters; after that seed
is applied, the field is not a second live source and is not a passive readout.

**Rationale.** `AGENTS.md` forbids an exposed control with no visual effect. Reporting the rig
while leaving the slider inert would satisfy a readout and still violate that rule. Bidirectional
binding preserves orbiting: the latest user action, whether slider or orbit, writes the same value.

**Rejected alternatives.** A readout-only field leaves the shipped control inert. Removing the
control is a larger product change than the defect requires and is not this change's choice.

### D3 — Correct the fidelity note against the implementation

**Decision.** Rewrite the `surface` preset's `fidelityNote` and the `physics.ts` header to describe
the shipped `surfaceLensingGpu` DIRECT path, keeping the genuinely omitted effects (Doppler,
aberration, frame dragging, atmosphere).

**Rationale.** `docs/cosmic-atlas/PHENOMENA_IMPLEMENTATION.md` §2 already documents the shipped
DIRECT surface-ray model and its validation against `surfaceRayReference.ts`. The code and the
implementation doc agree; only the preset note and the module header are stale. This is a
M12-NS documentation-drift artefact.

**Note on direction.** This correction *understates* the current implementation in the wrong
direction — the product does more than the note claims. Fixing it makes the claim accurate, not
more impressive. That distinction matters given the project's disclosure discipline.

### D4 — Gate the test hook on a build-time opt-in

**Decision.** Install `__ATLAS_APP__` only when a development or test opt-in is present, preserving
the exact shape `tests/browser/support/atlasHook.ts` declares.

**Critical sub-decision:** the Playwright suite runs against `vite preview`, which serves the
**production** build. So the opt-in must be settable for that build, not only for `vite dev`.
Recommended: a `VITE_*` environment variable consumed at build time, set by the Playwright webServer
command. Getting this wrong silently breaks the entire browser suite, so it is called out
explicitly rather than left to the implementer.

**Rejected alternative — leaving it, since it is a "test" hook.** Rejected because
`captureFrame()` performs a synchronous framebuffer readback on demand and
`forceContinuousRenderForTest()` pins the GPU. A capability-gated precedent already exists in
`statusPanel.ts:88`.

### D5 — Apply share fields in specificity order

**Decision.** Apply `experience` before `sharedVisual`, so the more specific encoded values win.
Equivalently: `setExperienceMode` must not overwrite fields that a share payload is supplying.

**Rationale.** Both writers are correct in isolation; the ordering was arbitrary. The URL author
encoded both fields on purpose, so the more specific one must win.

### D6 — Reflect every control at the interface tick, not at build time

**Decision.** Move control reflection from build-time initialisation to the existing interface
reflection tick, covering destination controls, the paired resolution controls and the playback
rate.

**Rationale.** The shell already has a 4 Hz reflection tick and already uses the pattern correctly
for the black-hole observer (`observerSync`). The gap is that only one section uses it. Generalising
the pattern the codebase already has is lower risk than inventing a new mechanism, and it makes
deep-linked payloads self-correcting regardless of module load timing.

**Sub-decision:** wire `transport.setRateLabel`, which exists and has zero callers. This is a
two-line fix for a permanently-wrong label. Also relabel the control to describe the effective rate
as a multiplier, since the effective rate is a product of a per-destination base rate and the user
rate.

### D7 — Preserve focus and collapse state by stable identity

**Decision.** Give controls stable identities, capture the focused identity and the expanded-region
set before a rebuild, and restore both afterwards. For the observer-mode select specifically,
reflect the value through the existing pattern instead of forcing a rebuild.

**Rationale.** `replaceChildren()` is the right primitive for a rebuild; the defect is that nothing
is restored. Keying chips and controls by a stable id is a small change that also lets the AGN fix
avoid a rebuild entirely.

**Accessibility state for the drawer:** add an explicit hidden/aria state alongside the CSS class.
The desktop collapse uses `display:none`, which removes content from the accessibility tree; the
narrow-viewport drawer uses a transform, which does not. Setting the hidden state in one place fixes
both presentations and makes the existing CSS comment true.

### D8 — Small confirmed fixes in the same lane

- **AGN time finiteness guard:** use the same `Number.isFinite(...)` convention as the four sibling
  destinations. No producer of a non-finite time was found; this is consistency plus defence.
- **Galaxy-Collision cloud rebuild:** early-return the secondary population block when its count is
  zero. The quality gate is already applied to draw state; apply it to the producer too.
- **Compact-merger temperature literal:** the 6×10⁵ K literal is clamped to 4×10⁴ K by the helper.
  Write the intended value or disclose the ceiling; do not rely on a silent clamp.

## Risks / Trade-offs

- **[AGN golden churn]** Fixing the torus changes frames for zone sequences where it was missing.
  → Mitigation: re-capture only the affected AGN rows, justify each with before/after evidence
  showing the torus is now present as documented, and prove the numerical goldens are unchanged.
- **[Browser suite breakage from hook gating]** A wrong opt-in silently breaks every browser spec.
  → Mitigation: make the opt-in part of the Playwright `webServer` command in the same commit, and
  run one browser spec immediately after wiring it rather than at the end.
- **[Focus restoration regression]** Restoring focus can itself move focus unexpectedly.
  → Mitigation: restore only when focus was inside the rebuilt subtree; never steal focus.
- **[Reflection at 4 Hz]** Moving reflection into the tick means values can lag by up to 250 ms.
  → Mitigation: acceptable for numeric readouts; the existing observer reflection already accepts it.
  Do not move reflection into the tick for anything that gates an input's own value.

## Testing strategy

> **Sequencing constraint.** This change edits `src/app/atlasApp.ts`. `transition-error-user-visibility`
> edits the same file to render the error surface. They must be **sequenced, not parallelised** — this
> change second, so it rebuilds the panel and focus model around a shell that already has an error
> surface. Two agents must not rewrite the product shell concurrently.

- **Unit — AGN torus.** A module-level test: prepare, change zone, update once, assert effective
  torus visibility matches the control.
- **Unit — hook gating.** A build-level assertion is required; see the risk note.
- **Browser — destination rows.** AGN zone sequence; Neutron Star inclination readout vs the camera
  orbit; deep-linked `dc=` payload reflected in the control.
- **Browser — accessibility.** Focus after a chip activation; focus and expanded state after an
  observer-mode change; collapsed drawer absent from the tab order.
- **Browser — share round-trip.** A URL with both `mode=` and display values; a URL with a `dc=`
  payload; serialise/parse symmetry.
- **Gates.** `npm run check`; the accessibility, navigation and destination specs; both golden
  suites.

## Open Questions

None. The neutron-star inclination binding in D2 is normative; do not reopen it as a seed-only
readout during implementation.
