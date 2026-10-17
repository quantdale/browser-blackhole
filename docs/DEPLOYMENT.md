# Deployment — provider-neutral release contract (M11-07)

The application is a static client-side bundle (`docs/DECISIONS.md` ADR-001).
No hosting provider is selected by the repository; this document defines the
contract any static host must satisfy, and how to verify it locally.

## Artifact

```bash
npm ci          # exact committed lockfile — the only supported install
npm run build   # tsc --noEmit && vite build -> dist/
```

`dist/` is fully self-contained: hashed asset filenames, no runtime network
dependency for the core experience, no dev-server assumptions. The whole
browser/E2E suite (`npm run e2e`) runs against `vite preview` — i.e. the
PRODUCTION build — so "tests pass" is already a production-artifact smoke,
not a dev-server claim.

## Host requirements (all mandatory)

1. **SPA fallback for deep links.** Routes like `/atlas/black-hole` and
   `/atlas/black-hole?preset=...` are client-side routes; the host must serve
   `index.html` for unknown non-asset paths (history-API fallback). Without
   it, deep links and browser Back/Forward break.
2. **HTTPS.** WebGPU requires a secure context in normal browser deployment
   (`docs/CI_CD.md` §14). `http://localhost` is exempt for development.
3. **Cache policy.** Hashed assets (`dist/assets/*`, `dist/luts/*`,
   `dist/data/*`) are immutable — serve with long max-age + immutable.
   `index.html` must be `no-cache` (or must-revalidate) so releases never
   strand a stale shell referencing removed hashes.
4. **No build-time secrets.** The bundle must never receive API keys or
   private URLs (`docs/ASSET_PROVENANCE.md` §15; the M11 bundle scan is part
   of the release audit).

## Reference host configurations (committed)

The repository ships reference fallback configurations — the deployment
contract is validated by `tests/unit/deploymentContract.test.ts`, which
serves `dist/` from a plain static server and asserts that deep links return
the shell while missing assets keep their not-found status (no graphics
device required):

- **Netlify (URL-preserving):** `netlify.toml` (repo root — Vite must not
  copy it into the site) + `public/_redirects` (copied into `dist/`). The
  `_redirects` rules route missing ASSET classes to the honest 404 page and
  everything else to `index.html` with the original URL preserved.
- **Vercel (URL-preserving):** `vercel.json` (repo root) rewrites every
  non-asset, extension-free path to `/index.html`.
- **404-catch hosts (e.g. GitHub Pages):** `public/404.html` serves the
  fallback scoped to NAVIGATION requests (final path segment without a file
  extension); a missing asset keeps its not-found status and page. These
  hosts cannot re-serve the shell under the failed URL, so the navigation
  case redirects to the shell entry — the deep link is only fully preserved
  on hosts with URL-preserving rewrites. **The 404 fallback assumes ROOT
  hosting** (the default build).

## Sub-path position (O-07)

`npm run build` produces a ROOT build (`base: '/'`), which the reference
configs and `public/404.html` document. For sub-path hosting, build with an
explicit base:

```bash
BASE_PATH=/my-subpath/ npm run build
```

The build's `index.html` then references every asset under that base. The
Netlify/Vercel rewrite rules must be adjusted to the same prefix, and the
404-catch fallback is NOT supported under a sub-path (its redirect is
root-anchored) — use a URL-preserving host for sub-path deployments.

## Runtime behavior the host must not break

- **Asset integrity:** LUT/data manifests carry schema version + checksums
  and are validated before runtime trust; a failed fetch/version mismatch
  degrades to the truthful numerical backend with a visible fallback reason —
  never silent scientific corruption. Hosts must not transform or re-encode
  `dist/luts/**` or `dist/data/**` (compression at the transport layer is
  fine; content mutation is not).
- **Device loss / unsupported WebGPU:** explicit user-visible states
  (`docs/FAILURE_RECOVERY.md`); the reload-required device-loss contract is
  presented in-app.
- **CSP compatibility:** bundled scripts/styles only, no `eval`, no inline
  remote code. A restrictive CSP is compatible; final directives are a
  deployment decision (`docs/ASSET_PROVENANCE.md` §16).
- **COOP/COEP:** NOT required (no SharedArrayBuffer/Workers in the core app).
  Do not enable cross-origin isolation casually (`docs/ASSET_PROVENANCE.md`).

## Local verification (no hosting required)

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173   # serves dist/ with SPA fallback
# then: npm run e2e (the suite targets this production preview server)
```

HTTPS behavior cannot be exercised on plain-http localhost; verify the
secure-context requirement on any real deployment by confirming the app
reports `webgpu` (not the fallback) in its status/debug surface on a
WebGPU-capable browser — the backend shown is always truthful.

## Release checklist

- [ ] `npm ci && npm run check` green from a fresh checkout;
- [ ] `npm run e2e` green (production preview);
- [ ] bundle audit clean (`docs/ASSET_PROVENANCE.md` §18);
- [ ] host satisfies requirements 1–4 above;
- [ ] compatibility matrix current (`docs/COMPATIBILITY_MATRIX.md`);
- [ ] benchmark report current for the release SHA (`docs/BENCHMARK_MATRIX.md`).
