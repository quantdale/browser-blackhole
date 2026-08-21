# UI/UX and interaction specification

## 1. Layout

Desktop target:

- canvas occupies the main viewport;
- compact control panel on the right or left;
- collapsible sections;
- unobtrusive top-level preset/mode controls;
- optional telemetry overlay in Debug mode.

Mobile target:

- canvas remains primary;
- controls use a bottom sheet/drawer;
- camera gestures do not fight slider gestures;
- quality defaults are conservative.

## 2. Camera interaction

Initial mode uses Three.js OrbitControls or an equivalent wrapper:

- drag/touch orbit;
- wheel/pinch dolly;
- damping optional;
- min/max normalized radius chosen to avoid nonsensical clipping before physical observer modes exist;
- keyboard control optional but useful.

Do not let OrbitControls directly become the eventual relativistic observer model. It is an interaction mechanism feeding observer/camera state.

## 3. Panel structure

Order:

1. Preset / Scientific-Cinematic-Debug mode
2. Black Hole
3. Observer
4. Accretion Disk
5. Relativity
6. Visual
7. Rendering
8. Diagnostics / About Physics

Each scientific control shows units and a tooltip/help description. Rendering controls use terms like render scale and integration quality rather than pretending they are astrophysical.

## 4. Initial presets

Create deterministic presets as milestones make them possible:

- `Schwarzschild Classic` — default inclined disk, clearly visible lensing;
- `Face-on Disk` — symmetry/reference scene;
- `Edge-on Lensing` — emphasizes upper/lower disk images;
- `Photon Ring` — camera/exposure quality tuned for critical structure;
- `Doppler Demonstration` — strong but physically based approaching/receding contrast;
- later `Kerr Prograde`, `Kerr Retrograde`, `Plunge`.

Presets must specify physics and rendering state separately so a user can change visual quality without mutating the physical setup.

## 5. Parameter safety

All controls use bounded validated ranges. Extreme values that are scientifically interesting but numerically dangerous should be behind Advanced/Debug controls.

Examples:

- do not permit camera radius inside the horizon in ordinary Orbit mode;
- keep Kerr spin below exact extremality for standard presets;
- reject disk inner radius <= horizon unless an advanced plunging-emission model explicitly supports it;
- clamp exposure/bloom so accidental values do not make the page unusable.

## 6. Physical versus cinematic

Every state property must be classifiable as:

- physical/model parameter;
- observer parameter;
- numerical/render-quality parameter;
- display/post-process parameter.

The UI visual hierarchy should reinforce that distinction.

## 7. Educational overlays

Later, optional overlays can mark/describe:

- event horizon radius;
- photon sphere;
- ISCO;
- apparent critical curve/shadow boundary;
- disk plane/inner edge;
- approaching/receding side;
- selected ray trajectory in a separate diagram/debug view.

Do not draw these overlays into scientific screenshots unless explicitly enabled.

## 8. URL/shareable state

After state schema stabilizes, support encoded query parameters or hash state for presets. Version the schema and validate input. Never make this a blocker for the physics renderer.
