# UI design system — Orbital Playground

Status: implemented on `design/orbital-playground` (2026-11-13).
Supersedes the 2026-09 Instrument Console visual treatment. Scientific,
rendering, state, lifecycle and control semantics remain governed by the
existing architecture and physics specifications.

## 1. Product and surface audit

Cosmic Atlas is an interactive science workspace for curious explorers and
technically engaged learners. The primary task is to choose a phenomenon,
explore a curated scenario, move the camera, control time, and inspect the
model's fidelity. There is no account, remote API, billing or data-entry flow.

The frontend contains:

- One shared shell across eight production routes: Black Hole, Neutron Star,
  Stellar Explosion, Compact Merger, Tidal Disruption, Quasar / AGN,
  Black-Hole Merger and Galaxy Collision.
- Destination navigation, Scientific/Cinematic/Debug modes and inspector toggle.
- Presets, destination-specific model controls, timeline transport, observer,
  display, rendering, diagnostics, fidelity notes and the physics glossary.
- Synchronized waveform canvas/readouts for the black-hole merger.
- Boot failure, transition failure, retry/reload/dismiss actions, device-loss
  terminal and slow-preparation notice. These remain outside the inspector.
- The explicitly requested `?legacy=1` diagnostic route.
- A new native-dialog destination gallery, reached through Explore.

## 2. Refero reference lock and decision ledger

Live Refero MCP research used three visual angles (scientific/space,
playful creative tools, Linear technical products), full styles for all three
selected references, editor screens and discovery flows. During implementation,
settings-panel research checked the control-grouping direction again.

| Decision | Reference | Role and adaptation |
| --- | --- | --- |
| Dominant visual foundation | [Linear — instruments after midnight](https://linear.app), Refero style `3affd07f-e21e-46a4-8aee-26accba689a6` | Neutral near-black surfaces, silver sans typography, fine translucent edges, compact tool density and machined actions. Its acid proof-card colors are not reused as action tokens. |
| Tactile controls and gallery | [Pryzm — luminous specimens in darkness](https://pryzm.design), Refero style `50affde9-9d04-411e-956f-52f1079145db` | Compact 8–14px rounded control and specimen surfaces, ample negative space, output as the visual focus. Its marketing heading face is not moved into UI controls. |
| Canvas scale | [SpaceX — engineering at cinematic scale](https://spacex.com), Refero style `f3f3ccec-c601-4bb7-a3c7-e6f20c735990` | The actual rendered phenomenon supplies spectacle and color. No marketing hero, stock space photograph or ornamental gradient replaces the live output. |
| Workspace grouping | [Glorify editor](https://refero.design/pages/1f44ba73-0945-4dbc-962a-21484f6c8dba) | A contextual inspector beside a dominant canvas; global navigation stays above the workspace. |
| Search, empty results and recovery | [Discover and search GPTs](https://refero.design/flows/6899) | Search keeps the directory context, gives explicit empty feedback and offers recovery. No onboarding or authentication is added. |
| Control domains | [Kraken settings](https://refero.design/pages/b7ae7d3a-e535-426b-920d-76166b7df68e) and existing UI_UX specification | Distinct groups with restrained headings and clear active state; keep physical, observer, display and numerical controls separate. |
| Amber interaction accent and motion | User brief | Amber is an original interaction/selection color, not a Linear proof token or scientific color scale. Lift/press feedback and eased reveals add playfulness without animating the simulation differently. |

Preserve: dark neutral canvas, large live simulation, readable silver text,
compact rounded tools, high-contrast amber selection, sparse mono numerals.
Reject: generic dashboard cards around the canvas, marketing sections, fake
simulation thumbnails, decorative science claims, brand cloning, pastel
background bands and perpetual ornamental animation.

Media strategy: the real GPU simulation is the product media. The gallery uses
original geometric identity symbols, explicitly not scientific previews. There
are no external image or font requests and no new runtime dependency.

## 3. Tokens

`src/ui/tokens.css` owns values and the base reset.

| Role | Value |
| --- | --- |
| Canvas / inspector / card / raised | `#08090b` / `#101113` / `#191a1d` / `#222428` |
| Text / secondary / muted | `#f4f4f1` / `#bfc1c7` / `#92969f` |
| Interaction / ink on interaction | `#ffc876` / `#17120c` |
| Status success / warning / error | `#98d9b0` / `#ffd285` / `#ff9d9d` |
| Edges | white at 8% or 17% |
| Type | local Segoe UI Variable/system sans; Cascadia/SFMono/Consolas for data |
| Type scale | 10/12/13/14/16px UI; 24–30px destination; 30–34px gallery |
| Spacing | 2/4/6/8/12/16/20/24px; 28–32px large surfaces |
| Radius | 6/10/16px tokens; 12px sections; 24px gallery; pill actions |
| Motion | 160/280ms, `cubic-bezier(0.22, 1, 0.36, 1)`; 360ms gallery entrance |
| Targets | 36px desktop controls, 44px coarse-pointer panel controls |

Amber is for focus, interaction and selection. Success/error colors are for
status. None of these tokens enters a shader, physical model or color scale.
Numeric readouts use tabular figures. Uppercase is restricted to decorative
captions; control accessible names retain their authored text.

## 4. Layout and geometry

The desktop inspector is now on the **left**, explicitly permitted by
`UI_UX.md` §1. This changes its position but preserves the established render
rectangle. At 1280 × 800, DPR 1:

| Element | Size | Position |
| --- | --- | --- |
| Topbar | 1280 × 73 | (0, 0) |
| Inspector | 307.188 × 727 | (0, 73) |
| Viewport | 972.813 × 727 | (307.188, 73) |
| Canvas backing store at scale 1 | 972 × 727 | — |

Goldens capture the viewport element, not its page position. The topbar and
panel-width tokens remain 73px and `clamp(260px, 24vw, 320px)`; no golden is
re-baselined. The canvas receives no decorative overlays.

At 1100px and below, navigation gets a second row. At 720px and below,
experience modes get a third row and the inspector becomes an inset bottom
drawer capped at 48% of available content height. At 420px and below the
Controls label remains accessible while the visible face becomes icon-only.
The gallery uses four desktop columns and two mobile columns. Its own scroll
container keeps all eight choices reachable.
The destination strip scrolls the active chip into view after navigation,
including travel initiated from the gallery or a direct route.

## 5. Components, state and accessibility

The component kit remains pure DOM factories using `createElement`,
`createElementNS` and `textContent`. No dynamic markup parsing was introduced.
Native ranges, selects, radio groups and switch semantics remain intact.
Select help now joins the existing slider/switch descriptions via
`aria-describedby`.

Collapsible regions have explicit `[hidden]` enforcement so flex styling
cannot expose closed controls. Panel collapse retains existing inert/focus
handling. Open sections, focused control identity and per-tick reflection
continue through the existing rebuild mechanism.

The Explore gallery is view-only state: local search and native dialog
open/close. Its entries come from the production registry, and its selection
calls the existing `host.navigate(id)`. There is no second route, state or
physics owner. Search focuses on open; Escape, Close and outside-click close
it; native modal semantics contain focus and return it to the trigger.
Explore is disabled until initialization completes. An empty search has a
clear-results action. A single Escape closes the gallery even when the native
search field contains text. Fidelity comes from the descriptor, not marketing copy.
Each card exposes its description and fidelity through `aria-describedby`.
The gallery is removed on application disposal.

Groups remain Scene → Observer → Display → Numerical → Reference. Every
existing destination control, Debug readout, timeline action, waveform and
fidelity disclosure remains available. Loading/recovery cards stay outside
the inspector and use the original status/error sources and actions.
Initialization immediately exposes the real status message beside decorative,
screen-reader-hidden skeletons. The first control mount removes the skeletons;
a boot failure removes them as soon as the terminal surface appears.

## 6. Motion and verification

Hover uses a 1px lift (4px gallery cards); press scales to 0.96–0.97. Sections
reveal with a 5px translation. Loading indicators breathe only while busy.
Gallery cards enter in a 25ms stagger. All animation and transition rules are disabled under reduced motion,
including pseudo-elements. No decorative continuous render loop is added.

Verification uses the reference lock above and captured desktop/mobile,
gallery, expanded-control, empty and failure states. Browser tests cover the
new gallery's navigation, search/recovery, focus return, collapsed semantics,
320px width and reduced motion. Existing accessibility, touch, navigation,
recovery and scientific image suites remain authoritative. Current execution
evidence is recorded in `.agent/STATE.md`; historical release certification
is not a claim about this branch.
