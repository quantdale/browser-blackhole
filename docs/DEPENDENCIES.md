# Dependency and tooling policy

The planning repository intentionally does not freeze package versions. The first implementation milestone must resolve and pin exact compatible versions from current stable releases, then commit the lockfile.

## Resolved toolchain (M0-01, pinned exact)

Chosen package manager: **npm** (default per this document; lockfile: `package-lock.json`, lockfileVersion 3).

Environment verified: Node v22.23.2 / npm 10.9.8 on Windows (Git Bash). All versions below are exact pins in `package.json`; no `^`/`~` ranges. (The `tsx` dev dependency was historically a `^` range and has been pinned to its resolved 4.23.12 in the M12-RI integrity pass.)

| Package | Version | Role / rationale |
| --- | --- | --- |
| `three` | 0.185.1 | Runtime. Current stable release with `WebGPURenderer` + TSL. Import paths verified against the installed build: `three/webgpu` (`WebGPURenderer`, `PostProcessing`), `three/tsl` (`Fn`, `vec3`, `varying`, `uv`, ...), `three/addons/controls/OrbitControls.js`. MIT license. |
| `vite` | 8.2.2 | Dev server/build. Current stable; requires Node `^20.19 || >=22.12` (satisfied). |
| `typescript` | 5.9.3 | Latest stable 5.x line. TypeScript 7.x (native port) is excluded because `typescript-eslint@8.67.0` declares peer support only for `<6.1.0`. |
| `vitest` | 4.1.11 | Unit test runner; supports Vite 8 as peer. |
| `@playwright/test` | 1.62.1 | Browser smoke/E2E. Node >=20 satisfied. Browsers: local runs may use the system Edge channel or a Playwright-installed Chromium; CI installs its own pinned browser. Apache-2.0. |
| `eslint` | 10.8.1 | Linter (flat config). Supported by `typescript-eslint@8.67.0` peer range (`^10.0.0`). |
| `typescript-eslint` | 8.67.0 | TypeScript lint integration; peers allow eslint 10 and TS <6.1. |
| `prettier` | 3.9.6 | Deterministic formatter. |
| `@types/three` | 0.185.4 | Type declarations matching `three` 0.185.1 (three ships no bundled types). |
| `@types/node` | 22.20.1 | Node types for config files, matching the Node 22 runtime line. |
| `tsx` | 4.23.12 | TypeScript/ESM script runner for `tools/cosmic-data` Python-calling helpers and `*.mjs`/`*.ts` dev scripts (e.g. bench harnesses, LUT generators). Exact pin; the manifest had carried a `^` range which contradicted the exact-pin policy — corrected in the M12-RI integrity pass. |

No frontend framework and no other runtime dependency is used (per policy below). Re-verify these import paths after any Three.js upgrade; upgrades happen in isolated commits.


## Required runtime dependencies

### Three.js

Purpose:

- `WebGPURenderer` lifecycle;
- TSL/node material/shader construction;
- camera math;
- OrbitControls;
- textures/render targets/post-processing integration.

Implementation agent must verify the current supported import paths and TSL/WebGPU APIs against the exact installed release. Do not rely on old blog snippets.

### No frontend framework required initially

The first version can use TypeScript + DOM controls directly. Add React/Vue/Svelte only if the actual UI complexity justifies the dependency. A full framework is not required for sliders, panels, presets, and telemetry.

A lightweight control library may be used during bring-up, but production UI should remain accessible and styleable. If using `lil-gui`, Tweakpane, or similar, verify keyboard/touch/accessibility constraints before making it permanent.

## Required development dependencies

Choose current compatible versions for:

- Vite;
- TypeScript;
- Vitest;
- Playwright;
- ESLint and TypeScript integration, or another documented lint stack;
- Prettier or another deterministic formatter.

Use one package manager and one committed lockfile. npm is the default unless there is a documented reason to choose pnpm/yarn.

## Optional later dependencies

Do not add these during M0 unless a concrete task needs them:

- Rust/WASM build tooling;
- image-processing packages for visual regression tooling beyond Playwright capabilities;
- numerical libraries for offline reference/LUT generation;
- worker-pool abstractions;
- state-management frameworks;
- UI component frameworks;
- analytics/error-reporting SDKs.

Every dependency increases bundle, compatibility, and upgrade surface. Prefer small local modules for physics/math that must remain auditable.

## Version policy

- Pin exact direct dependency versions in the lockfile/package manifest according to the chosen package-manager policy.
- Do not use unbounded `latest` imports in production code.
- Do not import browser libraries directly from arbitrary CDNs in the application build.
- Upgrade Three.js in isolated commits because WebGPU/TSL APIs and color-management behavior may change.
- Record renderer/tooling versions in debug telemetry and benchmark metadata.

## External assets and scientific data

Treat environment maps, star catalogs, LUTs, and reference fixtures as dependencies with provenance:

- origin URL;
- version/date/commit where applicable;
- license;
- transformation/generation process;
- checksum for generated scientific assets where useful.

Prefer deterministic procedural stars for early milestones to avoid blocking physics on asset licensing.

## M0 dependency selection checklist

1. Confirm supported Node.js version for selected Vite/Playwright versions.
2. Install a current stable Three.js release supporting the intended WebGPU/TSL APIs.
3. Run a minimal `WebGPURenderer` + TSL build before adding ancillary packages.
4. Add test/lint/format tooling.
5. Run clean install, typecheck, unit test, browser smoke, and production build.
6. Document exact selected versions and any compatibility caveats in `.agent/STATE.md`.
