# Celestial Environment V2

Status: implemented as an additive, deterministic presentation layer.

The scientific environment contract remains `sampleStarfieldRadiance()` in
`src/shaders/starfield.ts`: a seeded cube-face cell field with sparse HDR
stars and a linear background. It is unchanged when the cinematic detail
factor is zero, which keeps scientific parity and debug captures stable.

`makeCinematicStarfieldParams()` adds three bounded components to the same
world-direction sampler:

- a low-amplitude diffuse galactic band;
- a denser unresolved stellar population with deterministic warm/cool
  temperature colors and a bounded HDR brightness distribution;
- seeded dust/nebular modulation tied to the galactic band.

The GPU implementation in `starfieldGpu.ts` uses the same cube-face direction
convention and hash stream as the scientific field. It does not use frame
order, camera position, wall-clock time, or random texture state. Direct
Schwarzschild, Kerr, LUT, and neutron-star surface passes expose a live
`setEnvironmentDetail()` value. The host drives it from
`VisualWorkBudget.environmentDetail` only in Cinematic mode; Scientific and
Debug set it to zero.

Non-fullscreen destinations use `createCinematicBackdrop()`, a single
inside-facing sphere. Its sparse stars, unresolved detail, band, and dust are
controlled by the same seed and by the global detail budget. The backdrop is
camera-synchronized but its angular content is world-frame stable, so camera
movement does not regenerate or rotate the environment.

No external texture or asset is introduced. All terms are linear HDR values
and pass through the shared post exposure/tone-mapping path. The environment
is illustrative/procedural; it is not a survey-data reconstruction and does
not claim physical dust radiative transfer.

Validation:

- CPU unit tests cover deterministic/additive behavior and scientific zero
  detail parity (`tests/unit/starfield.test.ts`).
- The existing scientific goldens continue to exercise the zero-detail path.
- Cinematic destination captures and forced-WebGL2 browser gates exercise the
  GPU sampler/backdrop compilation. Dedicated environment-range and angular
  stability rows remain part of the campaign's final cinematic gate.
