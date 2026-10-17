## 1. Lock the executable term

- [x] 1.1 Add a unit test that evaluates the static frame-dragging term at a lapse below 1 and asserts it equals `g_tφ / √f_s` and does not equal `g_tφ / f_s`. — `tests/unit/kerrReference.test.ts` new describe `static frame-dragging normalisation (kerr-oracle-comment-truth D2)`: equatorial tangential probe (pos [8,0,0], dir [0,0,1], a*=0.5, M=1) gives closed-form `f_s = 0.75` (lapse below 1), `g_tφ = −0.125`, `Δ = 48.25`, `nPh = 1`; asserts `initKerrRay().lZ` matches the `g_tφ/√f_s` composition to 1e-11 and is NOT the `g_tφ/f_s` composition (the two candidate terms separate by 0.0223 — 12 orders above binary64 noise).
- [x] 1.2 Run that test and record that it passes against the current executable lines, before any comment edit. — `npx vitest run tests/unit/kerrReference.test.ts` pre-comment-edit: **26/26 passed** (2.84s).

## 2. Correct the adjacent comments

- [x] 2.1 In `src/phenomena/black-hole/kerr/reference.ts`, replace the static-extraction comment that says `g_tφ / f_s` with the square-root normalisation the executable line uses. — line 449 now reads `L_z = nPhi * sin(theta) * sqrt(Delta / f_s) + g_tphi / sqrt(f_s)`, matching line 454.
- [x] 2.2 Replace the terminal azimuthal-reconstruction comment that says `g_tφ / f_s` with the same square-root normalisation. — line 595 now reads `n_ph = [ (L_z/E) sqrt(f_s) - g_tphi/sqrt(f_s) ] sqrt(f_s/Delta) / sin(theta)`, matching line 603.
- [x] 2.3 Do not edit `kerrIntegrator.ts`, parity tolerances, or goldens. — untouched (git diff scope: `reference.ts` comments only, plus the test).

## 3. Gate

- [x] 3.1 Re-run the new unit test and confirm the executable term did not change. — post-comment-edit `npx vitest run tests/unit/kerrReference.test.ts`: **26/26 passed** (2.81s); the lock row still evaluates the unchanged executable lines.
- [x] 3.2 Run `openspec validate --change kerr-oracle-comment-truth --strict`. — `openspec validate kerr-oracle-comment-truth --type change --strict`: **valid**.

## 4. Review follow-up (spec re-check)

- [x] 4.1 The requirement covers BOTH commentary sites: static extraction and terminal azimuthal reconstruction. The original lock only covered `initKerrRay().lZ`; the terminal site (`terminalLocalDirection` n_ph line) was changeable to `/fS` without any test failing. Add a second lock. — new describe `terminal azimuthal-reconstruction normalisation (kerr-oracle-comment-truth re-check)` in `tests/unit/kerrReference.test.ts`: drives `terminalLocalDirection({r:8, theta:pi/2, phi:0, pr:0, ptheta:1}, E=1, L_z=0, a*=0.5, M=1)` — f_s = 0.75 (lapse below 1), g_tφ = −0.125, Σ = 64, Δ = 48.25 — and asserts the returned world direction matches the closed-form `g_tφ/√f_s` composition (dy,dz to 1e-9) and NOT the `g_tφ/f_s` composition (the two phi fractions separate by 0.0245).
- [x] 4.2 The lock must actually fail on the corruption it guards (test-the-test). — temporarily changed reference.ts:603 to `gTphi / fS`: `npx vitest run tests/unit/kerrReference.test.ts` → **1 failed (the new terminal row), 26 passed**; restored the line → **27/27 passed**.
- [x] 4.3 Re-run the suite and re-validate. — `npx vitest run tests/unit/kerrReference.test.ts`: **27/27**; `openspec validate kerr-oracle-comment-truth --type change --strict`: **valid**. `git diff` on `reference.ts` is empty (comments only, as §2 requires).
