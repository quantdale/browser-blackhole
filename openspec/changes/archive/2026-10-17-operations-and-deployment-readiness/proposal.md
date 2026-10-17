## Why

`docs/DEPLOYMENT.md` defines a provider-neutral release contract and makes four host requirements
"all mandatory". The first is:

> **SPA fallback for deep links.** Routes like `/atlas/black-hole` are client-side routes; the host
> must serve `index.html` for unknown non-asset paths. Without it, deep links and browser
> Back/Forward break.

**The repository ships no configuration that satisfies this requirement.** There is no `_redirects`,
`vercel.json`, `netlify.toml`, `staticwebapp.config.json`, `.htaccess`, `serve.json` or `404.html`
anywhere in the tree. `README.md` says "any static host serving `dist/` over HTTPS with SPA
deep-link routing works" — with no artifact to copy and no host that happens to be configured.

The only thing that exercises deep links is `vite preview`, which supplies its own SPA fallback as a
development-tool behaviour. `docs/RELEASE_CERTIFICATION.md` claims "SPA deep-link fallback ... deep-link
boots are exercised by the browser suite" — which is true, and which is the problem: it tests the
*dev tooling's* rewrite rule, not any host's. A deployment that follows the README's instructions
exactly will serve a 404 for every deep link.

Compounding it, `vite.config.ts` sets no `base`. A host serving the app at a sub-path — GitHub Pages
project sites, an app mounted under a path on an existing domain, the most common free-hosting
pattern — produces a working `index.html` with 404ing assets and no diagnostic.

Separately, the operational surface has drifted from its own claims:

- **`npm audit` reports one high-severity advisory** (`brace-expansion` 5.0.9, dev-only, via
  eslint → minimatch, fix available) while four places in the release certification state "0
  vulnerabilities". There is no audit gate in CI, which is why the claim went stale unnoticed.
- **CI declares no `permissions`, no `concurrency` and no `timeout-minutes`**; actions are pinned to
  floating major tags; there is no dependency review. This is the workflow the release checklist
  depends on.
- **The offline data pipeline's reproduction gate cannot run.** `tools/cosmic-data/requirements.txt`
  excludes the `sxs` package on Python 3.12+, so `reduce_bbh_merger.py` fails with a bare
  `ModuleNotFoundError` on any current interpreter, with no message naming the actual cause. There
  is no Python version pin anywhere, and `ONBOARDING.md` states no version at all.
- **A scientific data generator silently ignores its own parameters.**
  `tools/cosmic-data/restricted_three_body.py:279-283` assigns `alpha = alpha` and then uses module
  constants instead of the `r_in`/`r_out` parameters the function accepts, while `emit_artifact`
  (`:812-816`) passes production values. Today the constants happen to equal the production values,
  so the committed artifact is correct — but the provenance manifest can assert a scenario the
  artifact does not implement, which is exactly the class of failure the source-lock design exists to
  prevent.
- **`scripts/mcp-preflight.mjs` runs `execFileSync` with `shell: true`**, concatenating a
  config-derived string into a shell command line, in a script whose entire purpose is to be a
  security preflight. It also treats a bare `~` substring as a home-directory path, which
  false-positives on ordinary pinned-version syntax like `~1.2.3`.

## What Changes

- **Ship a reference static-host configuration** satisfying the mandatory SPA-fallback contract.
  Files a host reads from the publish directory, such as `404.html` and a Netlify `_redirects`,
  may live in `public/` and are intentionally copied into `dist/`. Files a host reads from the
  repository root, such as `vercel.json` and `netlify.toml`, must not be placed in `public/`; Vite
  would publish them as runtime assets. The test must prove a missing asset still 404s and that
  repo-root config is absent from `dist/`.
- **Test the deployment contract** by serving `dist/` from a plain static server with no SPA fallback
  and asserting the failure mode, so the requirement is genuinely exercised rather than assumed.
- **Make the sub-path hosting assumption explicit** and support it, or document it as a supported
  constraint with a check.
- **Add CI hardening**: `permissions`, `concurrency`, `timeout-minutes`, SHA-pinned actions,
  dependency review, and an `npm audit` gate.
- **Remediate the dependency advisory** and record the gate that prevents recurrence.
- **Pin the Python toolchain** and make the reproduction gate's failure mode name its cause.
- **Fix the ignored-parameter defect** in the galaxy-collision generator and add a self-check that
  the emitted manifest's scenario matches what was actually generated.
- **Remove the unnecessary shell layer** from the preflight script and fix the path-detection rule.

Non-goals, explicitly out of scope:

- No hosting-provider selection. The contract stays provider-neutral; this change supplies reference
  configurations, not a decision.
- No change to the application bundle, its chunking, or its build output beyond the optional `base`
  support.
- No change to any scientific data already committed. The generator fix prevents future drift; the
  existing artifacts are correct.
- No new observability stack. This is the deployment, supply-chain and tooling surface only.

## Capabilities

### New Capabilities
- `static-deployment-contract`: the contract that the shipped application satisfies its own documented
  static-hosting requirements, that those requirements are exercised by an automated check rather
  than assumed from development tooling, and that the supply-chain and release-tooling surface is
  gated.

### Modified Capabilities
- None. No archived baseline capability specifications exist yet
  (`openspec list --specs` reports none); `specification-baseline-hygiene` creates that baseline.
  Every requirement here is an ADDED requirement under the new `static-deployment-contract`
  capability.

## Impact

**Affected code**

- `public/` — new host configuration files and a `404.html`.
- `vite.config.ts` — optional `base`.
- `.github/workflows/ci.yml` — permissions, concurrency, timeouts, action pinning, dependency review,
  audit gate.
- `package.json` — advisory remediation (lockfile only), optional build script for the sub-path case.
- `tools/cosmic-data/{requirements.txt,reduce_bbh_merger.py,restricted_three_body.py}`, plus a
  `.python-version`.
- `scripts/mcp-preflight.mjs`.
- New: a deployment-contract test and a static-server fixture.

**Affected tests**

- A new deployment-contract check serving `dist/` without SPA fallback.
- The new CI gates.

**Affected documents**

- `docs/DEPLOYMENT.md` (the reference configurations and the sub-path position),
  `docs/CI_CD.md`, `docs/ASSET_PROVENANCE.md` (§15/§16/§18 are referenced by the contract),
  `ONBOARDING.md`, `tools/cosmic-data/README.md`, `README.md`.

**Dependencies**

- **Sequences before `documentation-truthfulness-realignment`**, whose certification correction must
  state this change's dependency-audit and Python-toolchain outcome.

**Compatibility risk**

- **Adding `404.html` changes the served artifact.** On hosts that use it, an unknown path serves the
  app shell rather than a 404 — which is the intended behaviour, but it means a genuinely missing
  asset returns HTML instead of a 404 status. The configuration must therefore be scoped to
  navigation requests only, and this must be verified on the test fixture.
- **The audit gate will fail on the current advisory** until the remediation lands. Land the
  remediation and the gate in the same change, or the CI gate must open red.
- **Pinning actions to SHAs** requires a deliberate update cadence; record the Dependabot
  configuration that maintains it.
