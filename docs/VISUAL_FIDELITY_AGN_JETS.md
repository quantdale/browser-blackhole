# Visual fidelity — AGN jet volume proof of concept

Date: 2026-10-18
Branch: `visual-fidelity/agn-jet-volume`
Baseline HEAD before this slice: `a00ab5d`

This is a new initiative. It does not reopen the completed hardening campaign
and it does not implement `spatial-atlas-continuous-navigation`.

## 1. Confirmed defects (code + images)

Captured on this host before the change: Microsoft Edge, WebGPU
`nvidia lovelace`, timestamp queries available, viewport 1280×800, High tier,
internal 972×727, DPR 1. Scientific goldens are 973×727. Images live under
`artifacts/visual-fidelity/before/` (gitignored capture dump).

| Scene | Confirmed | Class |
| --- | --- | --- |
| AGN galactic | Extended jets are additive `CylinderGeometry` core/sheath pairs. At the radio-galaxy camera they are about one pixel wide, so the rasterizer drops them or leaves a hard spike through the host. No internal depth. | geometry/representation |
| AGN nuclear / blazar | The jet base is a few pixels inside the torus funnel. The readable subject is a flat `RingGeometry` annulus plus a soft torus volume. Cylinder jets do not read as a jet. | geometry/representation + emission |
| AGN inner | DIRECT Schwarzschild disk. Smooth grayscale photon ring. Not a jet defect. | emission/color (thin-disk model) |
| BH classic | Zero-thickness equatorial sheet. Geodesics, `g^3`, Shakura-Sunyaev `T(r)`, and seeded 2D turbulence that modulates radiance only. Cinematic grade does not add thickness. | geometry (thin disk, by design) + emission |
| Kerr high-spin | Same thin disk, plus the documented magenta polar failure band. That band is a numerical failure, not the flatness complaint. | numerical failure (already disclosed) + thin disk |

Hypotheses not promoted to defects: global bloom is not the cause (Scientific mode, bloom off, has the same flat disks). Hardware is not the limit on this RTX-class adapter; the missing structure is in the representation.

## 2. What this slice changes

`src/phenomena/quasar-agn/jetVolumeField.ts` replaces the four cylinder pairs
with one VolumeService V2 march per lobe (existing service, no new engine).

- Spine targets `JET_*_HALF_WIDTH_RG` and is broadened only when that width is below the constant-step sample.
- Wider Gaussian is an illustrative entrained cocoon, disclosed as not a revision of the launch collimation and not GRMHD.
- Two-octave deterministic value noise, elongated along the jet, plus a small incommensurate kink. A single large helix was tried and rejected: it read as a DNA braid, which is another geometric silhouette.
- Soft Gaussian edge inside the box so the proxy is not a new cylinder.
- Approaching/receding brightness is still `jetLobeBrightnessRatio` on the live gain uniforms.
- Nuclear emission still multiplies by the continuum surrogate at `t - outward/c`. Galactic jets get no fake delay pattern.
- Hidden zones call `setVisible(false)` so the half-resolution march does not run. Inner GR is unchanged.
- Half-resolution, early termination, temporal jitter, depth-aware upsample. Self-shadow and gradient taps are off: an optically thin jet does not pay for them. VolumeService detail octaves are omitted because that helper scales noise by the longest box axis and cannot put filaments across a narrow jet.
- WebGL2 uses the same TSL graph.

## 3. What the images show

Preset cameras, identical timeline phase 0.35, High, cinematic unless noted.

- Galactic preset: the dropped spike becomes a visible bipolar glow through the host. At 972×727 the jet is still only a few dozen pixels long, so filaments do not read there.
- Close-up (distance 70–140, galactic zone, not a golden): soft edge, brighter spine inside a wider sheath, receding lobe dimmer and kinked, faint irregular tendrils on the approaching sheath. Not a cylinder and not a braid. The approaching spine still saturates under cinematic bloom, so fine filaments are clearer on the dimmer lobe.
- Nuclear and blazar presets: pixel difference is tiny. The jet base remains unresolved at the documented camera. That is a framing fact, not a failed march.
- Inner and black-hole images are not claimed as improved. Small pixel differences there are capture/temporal noise.

Goldens were not regenerated.

## 4. Performance

Method: `host.flushGpuTimestamps()` after `captureFrame`, High, 972×727,
WebGPU `nvidia lovelace`. Untouched BH classic scientific moved 11.6 → 16.4 ms
between the two runs, so deltas of a few milliseconds are run-to-run noise.
The inner AGN control (no jet march) matched: scientific 10.25 → 10.41 ms,
cinematic 16.74 → 16.45 ms.

| Scene | Before median GPU ms | After median GPU ms |
| --- | ---: | ---: |
| AGN inner scientific | 10.25 | 10.41 |
| AGN inner cinematic | 16.74 | 16.45 |
| AGN nuclear scientific | 9.91 | 9.71 |
| AGN nuclear cinematic | 43.31 | 41.77 |
| AGN galactic scientific | 4.66 | 4.63 |
| AGN galactic cinematic | 4.49 | 0.98 (not claimed as a win; scientific row of the same run is 4.63) |
| AGN blazar scientific | 11.80 | 27.13 (first frames; settled near 16) |
| AGN blazar cinematic | 52.44 (settled near 31) | 20.92 |

Resolved close-up of both galactic lobes: 7–12 ms GPU, 2 visible volumes,
half-res internal 364×272. No frame-budget breach at the documented presets
on this adapter. CPU `captureFrame` time is a separate number and was not
used as GPU time.

## 5. Gates

| Gate | Result |
| --- | --- |
| `npm run check` before edits | PASS — 70 files / 787 unit |
| Jet field unit tests | PASS — see the final check |
| `quasar-agn-jet-volume` WebGPU + WebGL2 | PASS on the volume contract (zone exclusivity, half-resolution, blazar ratio, no console errors) |
| Full Playwright / goldens | DEFERRED — goldens must not be regenerated to hide this intentional difference |
| Firefox | DEFERRED |

## 6. Approximations

PROCEDURAL_SCIENTIFIC. Not synchrotron transfer, not GRMHD, not a measured
opening angle. Single-scattering emission-absorption. Cocoon width is a
presentation scale chosen so the march has a resolved transverse extent.
Spine broadening is a march-resolution floor, disclosed in
`JET_VOLUME_DISCLOSURE`.

## 7. Next, in order

1. Jet tuning, still on VolumeService: keep the approaching spine below the bloom clip so the sheath tendrils read at the close-up without raising global bloom. Do not put the regular helix back.
2. Nuclear outer disk is still `RingGeometry`. A later slice can give that annulus a thin vertical emissivity in the same module, without touching the INNER direct pass.
3. Flagship disk atmosphere, separately gated and cinematic-only. The geodesic hit, redshift, and `g^3` stay authoritative. After the existing hit, a short vertical Gaussian of the already-computed temperature is the safe image-formation change. Scientific mode keeps the uniform at 0. Do not add a second redshift, do not retune physics tolerances, and do not replace the ray tracer with a volume march — the AGN result says VolumeService is for extended optically thin plasma, not for a surface the integrator already finds.
4. Kerr magenta band stays a numerical item, not a lookdev item.
