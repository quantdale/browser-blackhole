# Strong-field sampling decision

The flagship black-hole path keeps the validated radius-aware step policy in
both Schwarzschild and Kerr integrators: far-field steps grow with radius,
the horizon floor shrinks the step near capture, and every loop remains
compile-time bounded with a live tier budget. This is the accepted adaptive
sampling path and is exposed in the destination debug snapshot.

A second local ray bundle/supersample mask was evaluated against the current
evidence. The dedicated critical-region temporal gate already passes for the
Schwarzschild critical curve, neutron-star limb, and the shared strong-field
environment on WebGPU and forced WebGL2; the Kerr corpus and LUT/numerical
parity checks also remain green. Extra bundles would multiply the dominant
Kerr cost (the benchmark matrix identifies it as the bottleneck) without a
measured image-quality need in this environment, and could increase the
known Kerr failure-band population. It is therefore rejected for this
campaign, not silently enabled behind the unused budget field.

The current result still uses deterministic Halton jitter, bounded temporal
history, neighborhood clamp/rejection, and explicit camera-cut invalidation.
Re-open supersampling only with a before/after critical-curve image metric,
GPU/memory cost, and WebGPU/WebGL2 failure-band evidence.
