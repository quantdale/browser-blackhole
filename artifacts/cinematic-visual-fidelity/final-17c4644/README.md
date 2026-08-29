# Final Review Artifacts — 17c4644

This directory is the **durable human-review evidence** for the Cinematic Visual Fidelity Overhaul at the final implementation SHA `17c4644c78947b1f3398ee0534c1f943f181de27` on `main`.

It is tracked in Git despite `artifacts/` being ignored, via the negated patterns in `.gitignore`:

```
artifacts/*
!artifacts/cinematic-visual-fidelity
artifacts/cinematic-visual-fidelity/*
!artifacts/cinematic-visual-fidelity/final-*
!artifacts/cinematic-visual-fidelity/final-*/ **
```

Only this `final-17c4644` directory (manifest + contact sheet) is committed. The scratch subdirectories (`baseline-2026-08-29`, `benchmark-*`, `stellar-gate-*`, etc.) remain ignored and are not part of the certification.

## Contents

- `manifest.json` — machine-readable capture manifest: SHA, date, browser, GPU/adapter, backend, viewport/internal, tier, warmup, frame count, per-destination file list, phase/camera/preset notes, and validation summary.
- `contact-sheet.md` — human-readable contact sheet for the eight cinematic goldens plus the 43 scientific counterparts, with metrics, tolerances, and reproduction commands.

The actual PNG goldens are not duplicated here; they live under:

- `tests/browser/cinematic-goldens/CIN_*.png` (8 + 8 WebGL2)
- `tests/browser/goldens/*.png` (43 scientific)

This directory references them and provides the audit metadata to reproduce them.

## Verification

See `docs/VISUAL_FIDELITY_CERTIFICATION.md` (restored-scope final certification at 17c4644) and `.agent/STATE.md` for the full browser/benchmark evidence that substantiates this contact sheet.

Do not regenerate goldens solely to make a failure green; `UPDATE_GOLDENS=1` / `UPDATE_CINEMATIC_GOLDENS=1` is an explicit reviewed act.
