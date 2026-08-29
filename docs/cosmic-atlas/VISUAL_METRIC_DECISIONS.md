# Visual metric decisions

## SSIM — retained

The Cinematic Golden harness contains a deterministic in-repo 8×8 luminance
SSIM implementation. It has no native dependency, uses the same decoded PNG
pixels as the per-channel comparison, and gates each representative cinematic
row at `SSIM >= 0.88` alongside sparse-scene-aware drift tolerances. The
algorithm, constants and result are part of
`tests/browser/support/cinematicGoldenHarness.ts`.

## LPIPS-like metric — rejected for this campaign

An LPIPS-style metric was evaluated as an offline option and rejected for the
browser campaign. It would add a model/runtime dependency that is not already
available in the repository, complicate deterministic Windows/WebGPU/WebGL2
reproduction, and still could not replace the required human review. The
accepted gate uses deterministic SSIM plus luma, saturation, black-crush,
percentile and edge/temporal metrics. A future offline review tool may add
LPIPS-like analysis as non-blocking evidence if its model, version, weights and
CPU/GPU reproducibility are pinned.
