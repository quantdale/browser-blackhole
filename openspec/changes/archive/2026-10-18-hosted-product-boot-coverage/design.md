## Context

See `proposal.md`. Hosted CI runs `smoke.spec.ts` through a harness that sets `legacy=1`. `main.ts` mounts the atlas shell for every other root entry, except when `replaceState` throws. `src/shaders/diagnostic.ts` imports `DebugViewMode` from `src/app/state.ts`. The legacy renderer files `BlackHoleRenderer.ts` and `RenderCoordinator.ts` also import that type; they are the legacy shell.

## Goals / Non-Goals

**Goals:**

- Add a hosted browser check that observes the atlas shell on the product route.
- Keep that check inside the software-WebGL2 stability bound.
- Move `DebugViewMode` to a neutral module and point the shared shader at it.

**Non-Goals:**

- Deleting `?legacy=1` or the legacy shell.
- Adding lensing, hyperspace, goldens, or Firefox to the hosted job.
- Rewiring the legacy renderer files off `app/state.ts`.

## Decisions

### D1 — Product-entry smoke asserts the shell, not a lensed frame

The new Playwright check opens the product route without `legacy=1`. It asserts the atlas shell is present and the legacy-only diagnostic status region is not the mounted application. It accepts ready, fallback, or unsupported. It does not wait for a lensed pixel or a hyperspace phase.

**Alternatives rejected.** (a) Reuse `gotoApp` — that helper forces `legacy=1`. (b) Wait for a black-hole frame — hosted runner times for that arrival are already known to swing from seconds to minutes, which the existing stability requirement forbids.

### D2 — Neutral type module

Move the `DebugViewMode` union to a module that neither the legacy app nor the shader owns, for example under `src/shaders/` or `src/renderer/shared/`. `app/state.ts` re-exports it so legacy files keep compiling. `diagnostic.ts` imports the neutral module only.

**Alternatives rejected.** Duplicating the union in the shader — the two copies will drift.

### D3 — The legacy smoke stays

The existing five-test legacy smoke remains. The workflow adds the product-entry spec beside it. The smoke-coverage count script must be updated to the new expected count, or the new spec must be a separate step with its own count. Do not let an extra skip pass as the old count.

## Risks / Trade-offs

- **[Atlas shell still pulls a heavy chunk]** Mounting `/atlas/black-hole` may start destination prepare even if the test does not wait for a frame. → Mitigation: if a trial run on a software renderer exceeds the job timeout, the check targets the atlas shell route only as far as the shell DOM and a truthful terminal or preparing state, and records the bound. It still must not force `legacy=1`.
- **[replaceState throw path untested]** The file-URL fallback to the legacy app is unchanged. → Mitigation: out of scope; the hosted job uses HTTP.
