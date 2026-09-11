# UI design system — "Instrument Console"

Status: **implemented** (2026-09-11). Supersedes the ad-hoc styling that grew
through M0–M5.

## 1. Purpose and scope

This document is the contract for the Cosmic Atlas product frontend:

- the design-token layer (`src/ui/tokens.css`);
- the component kit (`src/ui/atlas/components.ts` + `atlasPanel.css`);
- the product shell (`src/app/atlasApp.ts`).

It does **not** cover the legacy M0 diagnostic app (`?legacy=1`, `src/app/App.ts`),
which keeps its own minimal styling in `src/ui/styles.css`.

## 2. Design direction

The product is a scientific instrument for looking at relativistic objects, so
the interface is styled as an **instrument console**, not as a consumer admin
panel. Direction was grounded in design-reference research (Refero MCP,
`refero_search_styles` / `refero_search_screens`) against three archetypes:

| Reference | What was taken |
| --- | --- |
| *Gt-planar* — stark high-contrast utility UI | Void-black canvas, hairline borders, small zero-radius "instrument" boxes, compact letter-spaced technical labels, monochrome palette with one restrained accent |
| *Amie* settings — dark settings surface | Row = label + explanatory sub-label, filled-track sliders, pill switches, small-caps group headers, full-width selects |
| *Active Theory* — midnight console | Near-black layered surfaces, luminous accent used sparingly for state |

The resulting rules:

1. **Hairlines, not heavy strokes.** Separation comes from 1px
   `rgba(150,175,215,0.13)` rules, never from chunky borders.
2. **Near-zero radii.** 2–6px. Controls should read as instrumentation.
3. **Two type roles.** UI text in the system sans; every numeric readout,
   micro-caption and instrument label in the mono stack with tabular figures.
4. **One accent.** `--accent` (`#7fb4ff`) marks state and focus. Semantics
   (`--ok` / `--warn` / `--error`) are reserved for status.
5. **Uppercase only where decorative.** Micro-labels and group captions are
   uppercased; control labels never are (§6).

## 3. Token layer

`src/ui/tokens.css` declares values only (plus the element reset). It is
imported first by `src/ui/styles.css` so every later stylesheet can consume it.

| Group | Tokens |
| --- | --- |
| Layout geometry | `--atlas-topbar-h`, `--atlas-panel-w` |
| Surfaces | `--surface-void`, `--surface-0..3`, `--surface-float` |
| Hairlines | `--line`, `--line-strong`, `--line-focus` |
| Text | `--text`, `--text-2`, `--text-3`, `--text-inverse` |
| Accent / semantics | `--accent`, `--accent-ink`, `--accent-soft`, `--accent-line`, `--ok`, `--warn`, `--error` (+ `-soft`) |
| Typography | `--font-ui`, `--font-mono`, `--fs-micro..lg`, `--tracking-*` |
| Spacing | `--sp-1..8` (2, 4, 6, 8, 12, 16, 20, 24 px) |
| Radii | `--r-1..3`, `--r-pill` |
| Motion | `--dur-1` (120 ms), `--dur-2` (180 ms), `--ease` |
| Control metrics | `--ctl-h` (30 px), `--ctl-h-touch` (40 px) |

Legacy aliases (`--panel-bg`, `--panel-border`, `--text-dim`, `--accent`,
`--ok`/`--warn`/`--error`) are retained because both the product shell and the
legacy app read them.

## 4. Component inventory

All components live in `src/ui/atlas/components.ts` and are pure DOM factories:
`createElement` / `createElementNS` / `textContent` only — no dynamic HTML
parsing (Gate G injection policy). The module imports nothing from
`src/atlas` or `src/renderer`.

| Component | Root class | Semantics |
| --- | --- | --- |
| Collapsible section | `.atlas-section` | `<button aria-expanded aria-controls>` + labelled region |
| Domain group | `.atlas-group` | Decorative `<p>` caption; never interactive |
| Panel header | `.atlas-panel-head` | Destination identity block |
| Slider row | `.atlas-row--slider` | `<label for>` + `<input type=range>` + `.atlas-slider-value` |
| Select row | `.atlas-row--select` | `<label for>` + native `<select>` (role=combobox) |
| Toggle row | `.atlas-row--toggle` | `<button role=switch aria-checked>` |
| Button row | `.atlas-row--buttons` | `.atlas-btn`, `.atlas-btn--primary` |
| Readout list | `.atlas-readouts` | `<dl>`/`<dt>`/`<dd>` telemetry |
| Timeline transport | `.atlas-timeline` | Icon buttons + scrubber + rate select |
| Mode switch | `.atlas-mode-switch` | `role=radiogroup` of real radios |
| Waveform panel | `.bbm-waveform` | 2D canvas + text readout (BH Merger) |
| Icon | `.atlas-icon` | Inline `<svg>`, `aria-hidden` |

Range inputs are custom-styled but remain **native `<input type=range>`**: the
filled portion of the track is painted from a `--atlas-fill` percentage that
the component writes on every value change (WebKit reads it in
`::-webkit-slider-runnable-track`; Gecko uses `::-moz-range-progress`). Selects
stay native too, with `appearance: none` plus a data-URI chevron, so keyboard
and role semantics are untouched.

## 5. Layout and geometry contract (load-bearing)

`.atlas-topbar` is pinned to `--atlas-topbar-h` and `#panel` to
`--atlas-panel-w`. At the browser-test viewport of 1280 × 800 this produces:

| Element | Size | Position |
| --- | --- | --- |
| `.atlas-topbar` | 1280 × **73** | (0, 0) |
| `#viewport` (canvas) | **972.813 × 727** | (0, 73) |
| `#panel` | 307.188 × 727 | (972.813, 73) |
| `#scene` backing store | **972 × 727** px @ DPR 1 | — |

The visual-regression goldens screenshot the `#viewport` **element** and
compare pixels, and the golden harness re-drives `host.handleResize()` from
that element's bounding box. Any change to the topbar height or the panel
width therefore changes the internal render resolution and invalidates all 51
goldens (43 scientific + 8 cinematic).

Consequence: **chrome restyling is geometry-neutral.** Colours, typography,
spacing *inside* the topbar and panel, and panel scroll length are all free to
change; the two dimensions above are not. Cosmetic edits must be verified with
the measurement probe before being considered done.

### 5.1 Historical note — the 73 px topbar

The topbar height was previously *accidental*. `src/ui/styles.css` carried a
leftover `.atlas-nav { padding: 12px }` rule from the M0 skeleton, which
inflated the nav to 60 px, giving 60 + 12 (topbar padding) + 1 (border) = 73 px
and silently stealing 24 px of canvas height. The same file's
`.atlas-nav button` (specificity 0-1-1) also outranked the kit's
`.atlas-nav-chip` (0-1-0), overriding the chip padding, radius and border.

Those legacy rules were removed and the height is now **pinned explicitly** to
`--atlas-topbar-h: 73px`, so the canvas geometry is deterministic and
documented rather than a side effect. Pinning also means future content
changes in the topbar cannot drift the goldens.

## 6. Text-case contract (accessibility + tests)

`text-transform: uppercase` is applied **only** to decorative micro-type
(brand, group captions, panel-header subtitle, waveform captions).

It must never be applied to an element whose text is used as an accessible
name — nav chips, section titles, slider labels, radios, buttons — because
browsers fold `text-transform` into the computed accessible name, and
`tests/browser/accessibility.spec.ts` resolves controls by name
(`getByRole('radio', { name: 'Scientific' })`, `getByRole('button', { name:
'Observer', exact: true })`, …). Uppercasing a control label would silently
rename it.

Related: Playwright's `getByRole(name)` is **case-insensitive substring**
matching. The destination chip for the merger is `Black-Hole Merger` (hyphen),
which is why `getByRole('button', { name: 'Black Hole' })` resolves uniquely.
Do not introduce a new button whose name contains `Black Hole`,
`Neutron Star`, `Stellar Explosion`, or `Controls` — it would create a
strict-mode ambiguity.

## 7. Panel information architecture

Sections are rebuilt from registry state on every destination / preset / mode
change and grouped by control domain, which is the visual hierarchy required
by `docs/UI_UX.md` §6 (physical/model vs observer vs numerical vs display):

| Group | Sections |
| --- | --- |
| **Scene** | Preset → destination-specific controls → Timeline |
| **Observer** | Observer |
| **Display** | Visual |
| **Numerical** | Rendering |
| **Reference** | Diagnostics (Debug mode only) → About / Fidelity (+ glossary) |

Ordering bug fixed: destination-specific sections are collected into a list
and appended after Preset. Previously each destination branch called
`panelElement.append(...)` as it ran, and because those branches execute before
the shared sections are appended, the destination panel rendered **above**
Preset.

Every scientific control carries a one-line description rendered under its
label (`docs/UI_UX.md` §3, `docs/UI_CONTROL_CATALOG.md` §14), and a control
that has a description owns its whole row so its value is never truncated.
Descriptions are wired to their input through `aria-describedby`.

## 8. Status communication

The `.atlas-status` line carries a decorative `::before` dot driven by
`data-severity` (`ok` / `busy` / `error`). The element's **text content is the
message alone** — four browser specs assert `toHaveText('Atlas ready')`, so no
severity text may be prepended.

## 9. Destination selector

Chips are styled as instrument tabs with `.is-active` marking the current
destination. The strip scrolls horizontally and its scrollbar is hidden (a
visible scrollbar would change topbar height between destinations with
few/many chips). Because a hidden scrollbar removes the overflow affordance,
`atlasApp.ts` tracks scroll position and toggles
`.atlas-nav--overflow/--start/--end`, which drive a CSS edge-fade mask. The
mask is visual only and cannot affect layout.

## 10. Motion

Every transition is ≤ 200 ms and is disabled wholesale under
`prefers-reduced-motion: reduce`. Focus is always visible via `:focus-visible`
outlines and is never removed.

## 11. Verification

Chrome changes are checked with:

1. `npx tsc --noEmit` and `npm run lint`;
2. the geometry probe (topbar 73 / viewport 972.813 × 727 / canvas 972 × 727);
3. `tests/browser/accessibility.spec.ts` (keyboard flow, names, roles);
4. `tests/browser/mobile-touch.spec.ts` (bottom drawer);
5. a visual-goldens subset, which must pass **without** re-baselining.

Goldens are never regenerated to accommodate a cosmetic change.

## 12. Open items

- The panel has no search/filter; with 8 destinations × 7 sections it is still
  navigable, but a jump-to-section affordance would help at larger sizes.
- `--ctl-h` is 30 px for pointer devices. Coarse pointers rely on the 40 px
  `--ctl-h-touch` target; a dedicated coarse-pointer media query should set it
  explicitly once touch layouts are exercised on real hardware.
- The empty/loading state for a destination whose dataset fails to load is
  still a status string rather than a first-class panel state.
