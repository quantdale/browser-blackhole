# Observer frame ADR — relativistic observer modes (M10)

Status: LOCKED for M10. Any change to a locked item requires updating this
file, the CPU reference (`src/phenomena/black-hole/observer/`), the GPU
backends, and the tests together (EXECUTION_PROTOCOL §6).

Inherits every convention of `docs/KERR_BACKEND_ADR.md` (signature `-+++`,
G=c=1, M=1, signed a* on +Y, Boyer-Lindquist, backwards-ray momentum
orientation §1.6, invariant `g = (-k.u_obs)/(-k.u_emit)` §1.17) and
`docs/NUMERICAL_METHODS.md` §2 (Schwarzschild static tetrad). This ADR adds
the M10 observer layer ON TOP; nothing below redefines an inherited item.

## 1. Separation of concerns (locked)

| Concept | Owner |
| --- | --- |
| Look/view orientation (right/up/forward axes, FOV) | ordinary Three.js camera via CameraRig — PRESENTATION ONLY |
| Physical spacetime position of the observer | observer worldline owned by the physics layer |
| Timelike four-velocity `u^mu` | derived analytically (static/circular) or by geodesic integration (flyby/freefall) from mode physics — NEVER from camera motion |
| Observer tetrad / local orthonormal frame | constructed per event from `u^mu` + camera axes (§4) |
| Simulation/proper time | deterministic TimeController-driven proper-time clock (§7) |

The pixel-ray pipeline becomes:

    screen/view direction n (in observer frame)
    -> photon four-momentum k^mu = u^mu + n_a e_(a)^mu        (§5)
    -> existing conserved-quantity extraction (E, L_z, p_r, p_theta)
    -> existing geodesic integration UNCHANGED
    -> g = 1 / (-k.u_emit)                                     (§6)

## 2. Mode definitions (physical meaning, locked)

- `camera` (legacy name `free`) — PRESENTATION ONLY. Physics identical to a
  static observer at the camera position (the pre-M10 behavior exactly).
  No four-velocity coupling; frequency semantics unchanged. This mode exists
  so historical presets/URLs keep their meaning bit-for-bit.
- `static` — observer at fixed BL coordinates, `u = e_(t)` (beta = 0).
  Exists where the static worldline is timelike: Schwarzschild `r > 2M`;
  Kerr strictly outside the ergosphere `r > r_E(theta)` (KERR_BACKEND_ADR
  §1.8/§1.9). The compatibility anchor for the whole architecture.
- `circular` — TIMELINE equatorial circular geodesic (not the cinematic
  `orbit` flag, which remains a display-domain camera animation).
  Four-velocity from [BPT72] eqs 2.16/2.17 with signed-a* branch resolution
  per KERR_BACKEND_ADR §1.5; prograde/retrograde selected relative to spin.
  Existence: `r > r_ph(a*, sense)` ([BPT72] eq 2.18). Stability: `r >= ISCO`
  flagged stable, `r_ph < r < ISCO` allowed with an explicit UNSTABLE-orbit
  disclosure (the math is exact; the orbit simply is not stable).
- `flyby` — unbound equatorial timelike geodesic characterized by conserved
  specific energy `E > 1` and angular momentum `L_z`; initial data placed at
  the ascending node of the incoming asymptote. Scattering encounter;
  pericenter below the capture threshold classifies the worldline TERMINATED
  (captured) truthfully instead of fabricating a slingshot.
- `freefall` — geodesic drop starting AT REST RELATIVE TO STATIC OBSERVERS at
  a documented release radius `r0` (Schwarzschild: the classic `E = sqrt(f0)`
  radial drop; Kerr: `u(0) = e_(t)(r0)` giving conserved `E = sqrt(f_s(r0))`
  plus whatever `L_z`, `Q` that initial condition implies — frame dragging
  makes "zero L_z" a DIFFERENT statement than "dropped from rest", and this
  ADR selects dropped-from-rest). Evolves in PROPER TIME tau.

## 3. Horizon/plunge boundary decision (incl. Kerr-Schild)

DECISION: M10 deliberately STOPS BEFORE CROSSING the horizon. The product
promise for `freefall` is: follow the freely falling observer from release
down to a declared boundary band and render the approach with the true
moving-observer optics — it does NOT promise rendering from inside the
horizon.

Locked boundary semantics:

- Worldline equations are integrated in the regular-at-horizon form
  (`dr/dtau` from the timelike radial potential — finite at `r+`), so the
  WORLDLINE itself is numerically healthy arbitrarily close to `r+`. BL
  coordinate time `t(tau)` diverges logarithmically and is DISPLAY-CAPPED,
  never integrated through.
- Rendering terminates when the observer crosses
  `r_stop = r_+ * (1 + 1e-3)`. The destination enters an explicit
  TERMINAL_HORIZON_APPROACH state: playback freezes, the readout states what
  happened, and the last valid frame persists. No teleporting, no freeze
  masquerading as physics, no NaN.
- Distinct failure classes near the horizon (never collapsed):
  INVALID_OBSERVER_STATE (e.g. static mode inside ergosphere),
  TERMINAL_HORIZON_APPROACH (declared end of advertised domain),
  NUMERICAL_FAILURE (integrator diagnostics), CAPTURED (photon
  classification — unchanged meaning).

Kerr-Schild decision: **Boyer-Lindquist retained; ingoing Kerr-Schild is NOT
implemented in M10.** Evidence per KERR_BACKEND_ADR §1.10/§1.22: the KS
trigger was "plunge observers REQUIRE integrating across r+". Because the
advertised contract stops at `r_stop > r+` and photon traces still terminate
in the exterior band, the KS advantage (horizon-penetrating integration) is
never exercised, while its costs (8-var Cartesian state, heavier per-step
metric work, an r_KS = r_BL + M offset breaking the exact spin->0 comparison
chain) WOULD be. Migration triggers recorded for the future: (a) advertising
interior rendering, (b) integrating photons across r+, (c) persistent
near-horizon f32 conditioning failures demonstrated against the binary64
reference. The conversion record in KERR_BACKEND_ADR §1.10 stands.

## 4. Tetrad construction (universal, locked)

At the observer event with four-velocity `u^mu`:

1. Take the three camera axis WORLD directions (right R, up U, forward F =
   -view-z) — presentation inputs only.
2. Project each orthogonal to `u` with the spacetime projector
   `P(x)^mu = x^mu + (x.nu u^nu) u^mu` (signature `-+++`, `u.u = -1`),
   inner products via the BL/Schwarzschild metric at the event.
3. Normalize; assign `e_(1) = norm(P(R))`, `e_(2) = norm(P(U - (U.e1)e1))`,
   `e_(3) = norm(P(F - (F.e1)e1 - (F.e2)e2))`.
4. Handedness fixed by completing `e_(0) = u`; orientation sign preserved so
   mirror-flips cannot occur (asserted by a signed-volume test).

This construction needs ONLY `u` (no static fiducial), therefore it also
works inside the Kerr ergosphere for infalling observers where static frames
do not exist. `beta -> 0` reduces exactly to the camera-aligned static tetrad
of the validated paths.

## 5. Photon initialization (locked)

Per pixel, local unit direction `n = normalize(F + R x tanHalfFovY aspect +
U y tanHalfFovY)` — IDENTICAL reconstruction to today, now interpreted in the
OBSERVER frame. The photon four-momentum is

    k^mu = eps * ( u^mu + n1 e_(1)^mu + n2 e_(2)^mu + n3 e_(3)^mu )

with local energy scale `eps = 1` (affine scaling cancels everywhere it is
used). Orthonormality makes `k.k = 0` and `-k.u = eps = 1` BY CONSTRUCTION
(asserted to machine precision in tests).

Per-frame the CPU emits the 16 floats `{U, A1, A2, A3}` (coordinate
components of the four tetrad legs). Per pixel each backend computes

    k^mu = U + n1*A1 + n2*A2 + n3*A3
    E = -k_t,  L_z = k_phi,  p_r = g_rr k^r,  p_theta = g_thth k^theta

and feeds its EXISTING integrator. Trajectory numerics do not change.

Static-mode equivalence gate: for `mode=static`, `{U, A1..A3}` reproduce the
existing init mappings EXACTLY (Schwarzschild NM §2/§7; Kerr ADR §1.8
including the orthogonalized phi-leg) — asserted numerically against
`cpuReference` / `initKerrRay` outputs.

## 6. Frequency and aberration (locked)

- Aberration is not a separate effect: it FOLLOWS from decomposing `n` on the
  boosted tetrad legs (different `E, L_z, b_z` per pixel versus a static
  observer at the same event). No screen-space distortion is applied anywhere.
- Frequency: `-k.u_obs = 1` identically, so

      g_total = 1 / (-k.u_emit) = 1 / ( u^t_emit (E - Omega L_z) )   [equatorial circular emitters]

  replacing the previous `1 / (u^t (1 - Omega b_z))` (which implicitly took
  `u_obs = static-at-infinity`, numerator `E`). The positive-denominator gate
  is unchanged in shape. Liouville `g^3` application stays centralized in the
  shared emission node. Emitter motion is counted exactly once (in
  `-k.u_emit`); observer motion exactly once (via `u` inside `k`). Rotating
  the VIEW CAMERA alone changes neither unless it changes the decomposition
  relative to a moving `u` — rotating while COMOVING is physically inert up
  to aberration, which is the correct behavior.
- Radiometric convention unchanged: specific intensity `I_obs = g^3 I_emit`;
  no bolometric mixing.

## 7. Time semantics (locked)

- Worldlines evolve in PROPER TIME `tau` (seconds of observer time scaled by
  the geometric time unit `t_g = GM/c^3` for display).
- The destination advances `tau += timeScale * dt` ONLY from the frame-loop
  delta delivered through `FrameContext.time` (same determinism class as
  every other destination animation), GATED on the atlas transport pause
  state (`services.time.snapshot().paused`). Paused => frozen worldline,
  live rendering/UI. No `performance.now()` reads in the physics layer.
- Preset load / enter resets `tau = 0` and re-seeds the worldline from
  control parameters deterministically. Reset/replay/scrub semantics follow
  the atlas transport.
- Coordinate time `t(tau)` is computed alongside for display and diverges
  logarithmically at the horizon; display caps at a documented magnitude and
  the TERMINAL state takes over (§3).

## 8. State and compatibility (locked)

- Production authority: the black-hole destination control record gains a
  versioned `observer` sub-record (mode + mode-specific parameters +
  validation ranges), normalized by the ONE destination normalizer
  (`normalizeBlackHoleControls`), persisted through the existing
  `VersionedDestinationState` channel with schemaVersion bump and a total
  migration: absent/malformed observer fields normalize to `mode='camera'`,
  making every pre-M10 preset/URL byte-compatible in MEANING.
- The legacy boolean `orbit` flag REMAINS the cinematic camera animation and
  is never aliased to the physical circular observer. UI labels keep the two
  visually distinct ("Cinematic Orbit" vs "Physical Circular Observer").
- Canonical app-level `AppState.observer.mode` enum gains no new members;
  the destination record maps to it for app-surface consumers.

## 9. Supported-domain matrix (locked)

| Mode | Schwarzschild | Kerr |
| --- | --- | --- |
| camera | all r > 2M (legacy semantics) | same, effective spin 0 rule unchanged |
| static | r > 2M | r > r_E(theta), off-axis |
| circular | equatorial, r > 3M (photon orbit); unstable flag below r=6 | equatorial, r > r_ph(a*, sense); unstable flag below ISCO(a*) |
| flyby | equatorial, E > 1, periastron > capture band | equatorial (Q=0), same policy |
| freefall | r0 > 2M, drop to r_stop | r0 > r_E(theta0) (start must be static-rest-capable) or any r0 > r_stop with explicit non-static seed disclosure; drop to r_stop |

Unsupported combinations route to INVALID_OBSERVER_STATE with a truthful
reason string surfaced in UI/debug — never silently degraded.
