## Why

In `src/phenomena/black-hole/kerr/reference.ts` the comments next to the static `L_z` extraction and the terminal `n_ph` reconstruction say `g_tφ / f_s`. The executable lines use `g_tφ / √f_s`. The GPU pass matches the executable lines, not the comments. A later edit that "fixes" the code to match the comment would introduce a CPU/GPU split the current tree does not have.

## What Changes

- Commentary adjacent to those two formulas SHALL state the same normalisation the executable lines use.
- A unit test SHALL lock the executable frame-dragging term to `g_tφ / √f_s` and SHALL fail if that term equals `g_tφ / f_s` at a lapse below 1.
- The executable formula SHALL NOT change. No golden, parity tolerance, or shader edit.

## Capabilities

### New Capabilities

### Modified Capabilities

- `kerr-photon-initialization`: the binary64 reference text that sits on the normative static-extraction formula must not state a different normalisation than the code the GPU is required to match.

## Impact

- `src/phenomena/black-hole/kerr/reference.ts` comments only, plus one unit test.
- Assumption: the GPU and the executable CPU lines are already the authority. This change does not re-derive the formula.
