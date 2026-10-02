# Tasks — Operations and deployment readiness

**Sequences before `documentation-truthfulness-realignment`**, whose certification correction must
state this change's dependency-audit and Python-toolchain outcome.

## 0. Baseline

- [ ] 0.1 Record `git rev-parse HEAD`, `node --version`, `npm --version`, clean `git status --short`.
- [ ] 0.2 Run `npm run check` and record the result.
- [ ] 0.3 Run `npm audit` and record the full output verbatim, including the advisory's scope.
- [ ] 0.4 Run `npx vite build` and record the output layout.
- [ ] 0.5 Serve `dist/` from a plain static server with no SPA fallback and record that a deep link does not return the shell. This is the before-evidence.
- [ ] 0.6 Run the BBH reduction tool and record the failure mode on the current interpreter.

## 1. Deployment contract

- [ ] 1.1 Add SPA-fallback configuration. Put publish-directory files (`404.html`, Netlify `_redirects`) in `public/` only when the host reads them from the published site. Put repo-root files (`vercel.json`, `netlify.toml`) at the repository root, never under `public/`, because Vite copies `public/` into `dist/`.
- [ ] 1.2 Add a `404.html` fallback, scoped to navigation requests so a missing asset still returns a not-found status.
- [ ] 1.3 Add a sub-path build: make the base configurable at build time and produce a sub-path smoke build.
- [ ] 1.4 Add a deployment-contract test that serves `dist/` from a plain static server, with and without the committed configuration.
- [ ] 1.5 Assert the test needs no graphics device: it validates routing, response status and asset resolution only.
- [ ] 1.6 Confirm the check from 0.5 now demonstrates the corrected behaviour.
- [ ] 1.7 Wire the deployment-contract test into CI.
- [ ] 1.8 Update `docs/DEPLOYMENT.md` with the reference configurations, the supported deployment shapes, and the sub-path position.

## 2. CI hardening

- [ ] 2.1 Add `permissions: contents: read` at workflow level.
- [ ] 2.2 Add a `concurrency` group with `cancel-in-progress`.
- [ ] 2.3 Add `timeout-minutes` to every job.
- [ ] 2.4 Pin every action to an immutable commit reference.
- [ ] 2.5 Add a Dependabot configuration for the actions ecosystem so the pins stay current. Do not skip this; pinning without maintenance converts a supply-chain risk into a staleness risk.
- [ ] 2.6 Add `dependency-review` on pull requests, scoped to production dependencies.
- [ ] 2.7 Pin the CI Node version to a specific minor matching the supported range, rather than a floating major.
- [ ] 2.8 Confirm the workflow's effective permissions and concurrency by inspecting a run's job summary.

## 3. Dependency gate

- [ ] 3.1 Confirm the audit gate fails on the current advisory. Record it.
- [ ] 3.2 Remediate the advisory via the lockfile.
- [ ] 3.3 Confirm the audit gate now passes at the defined threshold.
- [ ] 3.4 Define the threshold and record the runtime-versus-development-dependency distinction.
- [ ] 3.5 If any advisory is accepted rather than remediated, record its scope, justification and a review date. Do not leave an exception implicit.
- [ ] 3.6 Add the audit gate to the quality job in the same change that remediates the advisory, so the gate never opens red.

## 4. Python toolchain

- [ ] 4.1 Add a `.python-version`.
- [ ] 4.2 State the supported interpreter range in `tools/cosmic-data/README.md` and `ONBOARDING.md`.
- [ ] 4.3 Add a preflight check at the top of `reduce_bbh_merger.py` that terminates with a message naming the missing package and the supported range.
- [ ] 4.4 Confirm the check from 0.6 now produces that message instead of a bare import failure.
- [ ] 4.5 Confirm the preflight does NOT fire on a supported interpreter.
- [ ] 4.6 Correct the toolchain README's reproducibility claim to state the conditions under which reproduction is exact.
- [ ] 4.7 Record the interpreter version in the generated report's tool-version block.

## 5. Scientific generator correctness

- [ ] 5.1 Use the supplied radius parameters in both branches of the disk sampler in `restricted_three_body.py`.
- [ ] 5.2 Remove the self-assignment at the top of that branch.
- [ ] 5.3 Add a self-check asserting the parameters passed to artifact emission equal the values written into the manifest's source-lock block; refuse to write on mismatch.
- [ ] 5.4 Verify: change a production disk-radius parameter, re-emit to a scratch directory, and confirm both the manifest value and the binary hash change.
- [ ] 5.5 Verify the self-check refuses when parameters and the source-lock block disagree.
- [ ] 5.6 Confirm the currently committed artifact still validates and that its checksum is unchanged. Do NOT regenerate it unless the self-check shows it is wrong.

## 6. Preflight script

- [ ] 6.1 Remove `shell: true` from the package-query invocation, resolving the platform-specific executable directly.
- [ ] 6.2 Replace the bare `~` substring rule with a path-anchored test.
- [ ] 6.3 Add a test case for a string value containing a comment-like sequence, verifying the JSON-with-comments stripper does not truncate it.
- [ ] 6.4 Verify: a tilde version range passes; a genuine home-directory reference still fails.

## 7. Documentation

- [ ] 7.1 Update `docs/DEPLOYMENT.md` with the reference configurations and the supported deployment shapes.
- [ ] 7.2 Update `docs/CI_CD.md` with the new gates: deployment contract, dependency review, audit, and what each one catches.
- [ ] 7.3 Update `tools/cosmic-data/README.md` with the pinned interpreter range and the honest reproducibility condition.
- [ ] 7.4 Update `ONBOARDING.md` with the Python version.
- [ ] 7.5 Update `README.md` deployment wording to point at the committed configuration.

## 8. Validation and evidence

- [ ] 8.1 `npm run check` green.
- [ ] 8.2 The new deployment-contract test passes and demonstrates both the failure and the corrected behaviour.
- [ ] 8.3 A CI run confirms the new gates are active and green.
- [ ] 8.4 A deliberately reintroduced high-severity advisory makes CI fail. Record it, then revert.
- [ ] 8.5 `openspec validate operations-and-deployment-readiness --type change --strict` passes.
- [ ] 8.6 Confirm no committed scientific artifact changed: `git status --short public/data tools/cosmic-data/reports`.

## 9. Close-out

- [ ] 9.1 Strike findings O-01 through O-09 from `docs/MASTER_PLAN.md` with their resolution commits.
- [ ] 9.2 Append evidence to `.agent/STATE.md`, including the dependency-audit result the certification document must now state.
- [ ] 9.3 Commit this change as one coherent checkpoint.
- [ ] 9.4 Hand off to `documentation-truthfulness-realignment`.
