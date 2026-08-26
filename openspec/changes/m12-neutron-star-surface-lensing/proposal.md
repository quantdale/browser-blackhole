# Proposal: M12 Neutron-Star Surface Lensing Fidelity Closure

Change ID: `m12-neutron-star-surface-lensing`
Priority: **HIGH / BLOCKING**
Depends on: clean baseline only
Blocks: `m12-repository-integrity` final truthfulness closure and all CA9 runtime implementation

## Why

Neutron Star is currently a production Cosmic Atlas destination. The product/specification describes its exterior spherical lensing as `DIRECT` and requires backward ray tracing to a material surface or background. The implementation explicitly states that photon paths are still straight lines and that backwards ray tracing to the surface is not implemented.

This is a shipped scientific-fidelity mismatch. Existing visual goldens prove only that the current image is stable; they do not prove the missing strong-field mapping.

The next campaign therefore closes this gap before expanding Cosmic Atlas.

## What changes

- Add a direct Schwarzschild neutron-star surface-ray path in which camera rays are integrated through the exterior spacetime and terminate on a material surface at `R > 2 r_g` or escape to the background.
- Produce a refined surface-hit location/direction suitable for surface emission and hot-spot evaluation rather than merely knowing that a ray crossed a radius.
- Apply the existing static-surface gravitational redshift convention to emission from the actual geodesic hit point.
- Preserve the existing documented approximations: spherical static exterior, no frame dragging, no Doppler/aberration, no atmosphere transfer, no interior solution.
- Add a pure CPU/reference implementation or reference wrapper for surface hit/miss classification and apparent-radius validation.
- Add GPU/reference parity/debug evidence for representative rays/pixels.
- Add dedicated neutron-star unit/browser coverage and performance evidence.
- Review and intentionally regenerate neutron-star goldens only after scientific correctness is independently established.
- Prove that validated black-hole Schwarzschild/LUT/Kerr behavior did not change as collateral damage.
- Update fidelity documentation and user-facing claims to exactly match the landed model.

## Preferred outcome

Neutron Star leaves this change with the originally specified `DIRECT` exterior surface-lensing claim justified by code and tests.

## Controlled fallback

If a direct surface-ray implementation cannot pass the required physics/parity gates without destabilizing validated black-hole behavior, do not fake closure. Instead:

1. leave the implementation task incomplete;
2. downgrade every production/documentation claim that currently says or implies direct compact-surface ray tracing;
3. record the blocker and a follow-up change;
4. do not begin CA9 until the repository no longer overclaims current fidelity and the owner explicitly accepts the deferred gap.

The fallback is a truthfulness containment path, not equivalent scientific completion.

## Non-goals

- Hartle-Thorne/Kerr neutron-star exterior or frame dragging.
- Doppler boosting/aberration from rotating surface elements.
- time-of-flight delays.
- realistic atmosphere/radiative transfer.
- oblate stellar shape.
- magnetohydrodynamic magnetosphere simulation.
- rewriting the black-hole integrator for stylistic cleanliness.
- changing global stable black-hole ray classification codes 0..6.

## Success criteria

The change is complete only when:

- representative inbound rays demonstrably hit a material surface before the would-be horizon;
- escape rays sample the background;
- hit points are finite, deterministic and geometrically consistent;
- apparent surface size follows an analytic Schwarzschild reference case within documented tolerance;
- surface redshift ordering remains correct;
- CPU/GPU classification/parity evidence is green;
- black-hole parity/goldens remain unchanged unless a separately justified defect is found;
- neutron-star browser behavior/presets remain deterministic under pause/scrub/navigation;
- resource and performance budgets are respected;
- public/scientific docs match the implementation exactly.
