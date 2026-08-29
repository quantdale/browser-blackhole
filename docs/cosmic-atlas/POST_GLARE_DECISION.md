# Cinematic post-effect decisions

## Restrained stellar glare — rejected for this campaign

The pinned Three.js r185 spike proved the production hybrid path: an explicit
FP16 selective-highlight target feeds `BloomNode`, while scene radiance remains
in the shared HDR target. The Cinematic Golden and critical-region captures
show stable highlights without washing out the black-hole shadow, neutron-star
limb, or vacuum BBH caustics.

A second point-spread/glare kernel was therefore rejected at this checkpoint.
It would duplicate the selective bloom source, add another full-screen blur and
another auxiliary resource, and has no accepted physical PSF model in the
current product contract. The global budget reports `glareEnabled: false` for
all tiers; this is deliberate, not an unimplemented enabled feature. The
selective FP16 bloom stage remains the accepted highlight treatment and is
tested on WebGPU and forced WebGL2.

Re-open this decision only with a new spike that supplies before/after captures,
stage timings, memory cost, shadow/critical-curve review, and a WebGL2 fallback.

## Cinematic grade — accepted as display-only

The deterministic cinematic grade is retained because it changes only the
presentation graph after scene radiance and selective bloom. It is pinned by
the Cinematic Golden metadata (`toneMapping`, exposure, bloom and stage list),
while Scientific mode continues to use the restrained display path. It does
not replace spatial representation, HDR continuity, temporal reconstruction,
or destination-specific rendering.
