# Tasks — Operations and deployment readiness

**Sequences before `documentation-truthfulness-realignment`**, whose certification correction must
state this change's dependency-audit and Python-toolchain outcome.

## 0. Baseline

- [x] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [x] 0.2 Run `npm run check` and record the result.
- [x] 0.3 Run `npm audit` and record the full output verbatim, including the advisory's scope.
- [x] 0.4 Run `npx vite build` and record the output layout.
- [x] 0.5 Serve `dist/` from a plain static server with no SPA fallback and record that a deep link does not return the shell. This is the before-evidence.
- [x] 0.6 Run the BBH reduction tool and record the failure mode on the current interpreter.

## 1. Deployment contract

- [x] 1.1 Add SPA-fallback configuration. Put publish-directory files (`404.html`, Netlify `_redirects`) in `public/` only when the host reads them from the published site. Put repo-root files (`vercel.json`, `netlify.toml`) at the repository root, never under `public/`, because Vite copies `public/` into `dist/`.
- [x] 1.2 Add a `404.html` fallback, scoped to navigation requests so a missing asset still returns a not-found status.
- [x] 1.3 Add a sub-path build: make the base configurable at build time and produce a sub-path smoke build.
- [x] 1.4 Add a deployment-contract test that serves `dist/` from a plain static server, with and without the committed configuration.
- [x] 1.5 Assert the test needs no graphics device: it validates routing, response status and asset resolution only.
- [x] 1.6 Confirm the check from 0.5 now demonstrates the corrected behaviour.
- [x] 1.7 Wire the deployment-contract test into CI.
- [x] 1.8 Update `docs/DEPLOYMENT.md` with the reference configurations, the supported deployment shapes, and the sub-path position.

## 2. CI hardening

- [x] 2.1 Add `permissions: contents: read` at workflow level.
- [x] 2.2 Add a `concurrency` group with `cancel-in-progress`.
- [x] 2.3 Add `timeout-minutes` to every job.
- [x] 2.4 Pin every action to an immutable commit reference.
- [x] 2.5 Add a Dependabot configuration for the actions ecosystem so the pins stay current. Do not skip this; pinning without maintenance converts a supply-chain risk into a staleness risk.
- [x] 2.6 Add `dependency-review` on pull requests, scoped to production dependencies.
- [x] 2.7 Pin the CI Node version to a specific minor matching the supported range, rather than a floating major.
- [x] 2.8 Confirm the workflow's effective permissions and concurrency by inspecting a run's job summary.

## 3. Dependency gate

- [x] 3.1 Confirm the audit gate fails on the current advisory. Record it.
- [x] 3.2 Remediate the advisory via the lockfile.
- [x] 3.3 Confirm the audit gate now passes at the defined threshold.
- [x] 3.4 Define the threshold and record the runtime-versus-development-dependency distinction.
- [x] 3.5 If any advisory is accepted rather than remediated, record its scope, justification and a review date. Do not leave an exception implicit.
- [x] 3.6 Add the audit gate to the quality job in the same change that remediates the advisory, so the gate never opens red.

## 4. Python toolchain

- [x] 4.1 Add a `.python-version`.
- [x] 4.2 State the supported interpreter range in `tools/cosmic-data/README.md` and `ONBOARDING.md`.
- [x] 4.3 Add a preflight check at the top of `reduce_bbh_merger.py` that terminates with a message naming the missing package and the supported range.
- [x] 4.4 Confirm the check from 0.6 now produces that message instead of a bare import failure.
- [x] 4.5 Confirm the preflight does NOT fire on a supported interpreter.
- [x] 4.6 Correct the toolchain README's reproducibility claim to state the conditions under which reproduction is exact.
- [x] 4.7 Record the interpreter version in the generated report's tool-version block.

## 5. Scientific generator correctness

- [x] 5.1 Use the supplied radius parameters in both branches of the disk sampler in `restricted_three_body.py`.
- [x] 5.2 Remove the self-assignment at the top of that branch.
- [x] 5.3 Add a self-check asserting the parameters passed to artifact emission equal the values written into the manifest's source-lock block; refuse to write on mismatch.
- [x] 5.4 Verify: change a production disk-radius parameter, re-emit to a scratch directory, and confirm both the manifest value and the binary hash change.
- [x] 5.5 Verify the self-check refuses when parameters and the source-lock block disagree.
- [x] 5.6 Confirm the currently committed artifact still validates and that its checksum is unchanged. Do NOT regenerate it unless the self-check shows it is wrong.

## 6. Preflight script

- [x] 6.1 Remove `shell: true` from the package-query invocation, resolving the platform-specific executable directly.
- [x] 6.2 Replace the bare `~` substring rule with a path-anchored test.
- [x] 6.3 Add a test case for a string value containing a comment-like sequence, verifying the JSON-with-comments stripper does not truncate it.
- [x] 6.4 Verify: a tilde version range passes; a genuine home-directory reference still fails.

## 7. Documentation

- [x] 7.1 Update `docs/DEPLOYMENT.md` with the reference configurations and the supported deployment shapes.
- [x] 7.2 Update `docs/CI_CD.md` with the new gates: deployment contract, dependency review, audit, and what each one catches.
- [x] 7.3 Update `tools/cosmic-data/README.md` with the pinned interpreter range and the honest reproducibility condition.
- [x] 7.4 Update `ONBOARDING.md` with the Python version.
- [x] 7.5 Update `README.md` deployment wording to point at the committed configuration.

## 8. Validation and evidence

- [x] 8.1 `npm run check` green.
- [x] 8.2 The new deployment-contract test passes and demonstrates both the failure and the corrected behaviour.
- [x] 8.3 A CI run confirms the new gates are active and green.
- [x] 8.4 A deliberately reintroduced high-severity advisory makes CI fail. Record it, then revert.
- [x] 8.5 `openspec validate operations-and-deployment-readiness --type change --strict` passes.
- [x] 8.6 Confirm no committed scientific artifact changed: `git status --short public/data tools/cosmic-data/reports`.

## 9. Close-out

- [x] 9.1 Strike findings O-01 through O-09 from `docs/MASTER_PLAN.md` with their resolution commits.
- [x] 9.2 Append evidence to `.agent/STATE.md`, including the dependency-audit result the certification document must now state.
- [x] 9.3 Commit this change as one coherent checkpoint.
- [x] 9.4 Hand off to `documentation-truthfulness-realignment`.


---

## Evidence summary (2026-10-17 completion pass)

- **O-01 (§1):** committed reference SPA-fallback configurations —
  `public/_redirects` (asset classes -> honest 404 page with 404 status;
  everything else -> index.html with the ORIGINAL URL preserved),
  `public/404.html` (navigation-scoped fallback for 404-catch hosts: the
  final path segment without a file extension gets the shell redirect; a
  missing asset keeps its not-found page), `vercel.json` (rewrite excluding
  asset dirs and extension paths), `netlify.toml` (publish dir). The
  deployment-contract test (`tests/unit/deploymentContract.test.ts`, 5 rows)
  serves dist/ from a plain static server and asserts: deep link 404s
  WITHOUT the config (the 0.5 before-evidence), returns the shell WITH it at
  the original URL, missing assets keep 404 + no shell body, existing assets
  serve as themselves, and the committed configs carry the documented shape.
  No graphics device needed (1.5); wired into `npm run test` therefore the
  hosted quality job (1.7).
- **O-07 (1.3/1.8):** `BASE_PATH=/x/ npm run build` makes the base
  configurable; DEPLOYMENT.md documents the reference configs, the supported
  deployment shapes and the sub-path position (404-catch fallback is
  root-only; sub-path deploys need URL-preserving hosts).
- **O-03 (§2):** `permissions: contents: read`, `concurrency` with
  `cancel-in-progress`, `timeout-minutes` on all three jobs, ALL actions
  pinned to immutable SHAs (7 pins, 0 floating tags), Dependabot config for
  the actions ecosystem (pinning without maintenance = staleness risk),
  `dependency-review` job scoped to runtime deps on PRs, Node pinned to
  22.12.0.
- **O-02 (§3):** `npm audit` recorded verbatim at baseline (2 high:
  brace-expansion + source-map-js, dev-only). `npm audit fix` remediated via
  the lockfile — `npm audit --audit-level=high` now reports **0
  vulnerabilities**. The audit gate joined the quality job in the SAME change
  (it never opens red). Threshold: high+. Runtime dependencies: `three` only
  (MIT); everything else is dev toolchain. NOTE: the `@vitest/coverage-v8`
  provider install remains blocked by the deterministic npm/arborist failure
  (`Cannot read properties of null (reading 'edgesOut')` even after `npm ci`
  and `npm audit fix` — the latter succeeding through a different code path);
  the static import-coverage report substitutes (V-10's recorded note).
- **O-04/O-06 (§4):** `.python-version` pins 3.11; the supported range
  (CPython 3.9-3.11 — the `sxs` pin is `<3.12`) is stated in
  tools/cosmic-data/README.md and ONBOARDING.md; `reduce_bbh_merger.py`
  now runs a preflight that terminates with a message naming the missing
  package and the range (verified live on 3.13: the clear message replaces
  the bare ImportError). The README reproducibility claim now states the
  EXACT conditions (interpreter range + pinned source bytes + source-lock
  constants). The interpreter version was already stamped in the report's
  toolVersions block (4.7 confirmed present).
- **O-05/O-09 (§5):** the disk sampler now uses its `r_in`/`r_out`
  parameters in BOTH branches (they were silently ignored in favour of the
  module constants) and the `alpha = alpha` self-assignment is gone. The
  source-lock self-check (`_assert_source_lock_consistency`) refuses to emit
  when PROD_* constants disagree with the manifest SOURCE_LOCK_SCENARIO
  block — verified both ways: a mutated PROD_DISK_R_IN refuses naming
  `diskRin: PROD_*=0.7 vs source-lock=0.5`, the clean state passes. The
  committed GC1 artifact validates with an unchanged checksum (5.6: not
  regenerated — the self-check shows it is correct).
- **O-08 (§6):** `shell: true` removed from the registry query (the
  platform-specific npm executable is resolved directly; the spec reaches
  the argv, never a shell); the bare `~` substring rule replaced by a
  PATH-ANCHORED test (`~` alone or `~/...`/`~\...`) so tilde VERSION ranges
  pass while home references fail; the JSON-with-comments stripper is now
  strings-aware (comment markers inside values survive). Black-box tests in
  `tests/unit/mcpPreflight.test.ts` (3 rows) run the real script against
  fixtures and pin all three behaviours.

Gates: `npm run check` **66 files / 756 unit tests** green (format/lint/
typecheck/build/hook-gate included); the Python preflight and source-lock
self-check verified live in both directions; `openspec validate --strict`
valid.
