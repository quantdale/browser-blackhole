# Design — Operations and deployment readiness

## Context

`docs/DEPLOYMENT.md` is well written. It identifies the right four requirements, explains why each
matters, and provides a local verification path. The problem is that it describes a contract with no
counterpart in the repository, and verifies it with a development server that happens to implement
the contract for free.

`vite preview` has SPA fallback. So does `vite dev`. So the browser suite passes, and the release
certification records "SPA deep-link fallback ... exercised by the browser suite" — which is true and
certifies nothing about a real host.

This is the same failure class as the physics defects: **a development-tool behaviour standing in for
a production guarantee.** It also explains why the deployment gap survived multiple campaigns: there
was never a check that could fail.

The supply-chain items share a root cause with the documentation items in
`documentation-truthfulness-realignment`: the certification document records a state that was true
when written and is false now, and nothing re-checks it.

The galaxy-collision generator defect is the most interesting item here, because it is the one place
where a *scientific* invariant is not enforced by code. The source-lock design is genuinely good —
`restricted_three_body.py` refuses to emit a production artifact unless the source-lock status is
correct, and every scenario parameter carries an explicit classification. Then the disk-radius
branch ignores its own parameters.

## Goals / Non-Goals

**Goals**

- A deep link works on a static host using a committed configuration.
- The deployment contract is verified against a server that does *not* help.
- CI is bounded, minimal-privilege, immutable, and gates dependencies.
- The offline toolchain is pinned and fails informatively.
- Generated artifacts match their declared parameters.

**Non-Goals**

- No hosting decision. Reference configurations, not a provider.
- No bundle or chunking change.
- No change to committed scientific data. The artifacts are correct; the generator is what drifts.
- No new observability stack.

## Decisions

### D1 — Reference configurations, plural, and a routing test

**Decision.** Commit SPA-fallback configuration for the common static host families plus a `404.html`
fallback, and add a test that serves `dist/` from a plain static server with and without the
configuration. Publish-directory files may live in `public/`. Repository-root files such as
`vercel.json` and `netlify.toml` must not, because Vite copies `public/` into `dist/`.

**Rationale.** "Provider-neutral" is a legitimate goal, but it degraded into "unverified" because no
provider was ever chosen. Committing a configuration per family keeps the neutrality (the operator
picks) while making the contract satisfiable (the operator copies).

**The test is the point, not the configurations.** Serving `dist/` without fallback and asserting the
failure is what makes the requirement real. It is also cheap: it needs no GPU and no browser, only a
static file server and an HTTP client, so it runs in hosted CI. That is exactly the class of
compensating check `verification-gate-integrity` calls for.

**Sub-path hosting:** implement `base` as a build-time value with a sub-path smoke build, because
GitHub Pages project sites are common enough that failing silently there is a real cost. If the
implementer judges sub-path support out of scope, the fallback is to document the root-path
assumption explicitly in `docs/DEPLOYMENT.md` — either resolution satisfies the requirement; leaving
it silent does not.

**The 404.html caveat:** a catch-all fallback serves the shell for *any* unmatched path, including a
missing asset, which would return HTML with a 200 for a missing `.js`. The configuration must be
scoped to navigation requests, and the test fixture must assert that a missing asset still 404s.
This is called out in the spec and the tasks for that reason.

### D2 — CI hardening, with action pinning as a maintained property

**Decision.** Add `permissions: contents: read` at workflow level, a `concurrency` group with
`cancel-in-progress`, `timeout-minutes` on every job, SHA-pinned actions, `dependency-review` on pull
requests, and `npm audit --audit-level=high` in the quality job.

**Rationale.** None of these can produce a wrong green today. They bound runner cost, limit the
blast radius of a compromised or retagged action, and — the one that matters — make the dependency
state a gate rather than a sentence in a document. The missing audit gate is the direct cause of the
stale "0 vulnerabilities" claim.

**On SHA pinning:** pinning without a maintenance mechanism converts a supply-chain risk into a
staleness risk. Add a Dependabot configuration for the GitHub Actions ecosystem in the same change.
`.github/` currently contains only the workflow; there is no dependabot configuration at all.

### D3 — Remediate the advisory in the same change as the gate

**Decision.** Update the lockfile to a non-vulnerable `brace-expansion` and open the audit gate in
the same change.

**Rationale.** Opening a gate that is known to fail produces a red pipeline, which gets disabled — the
most common way a new gate dies. The fix is available (`fixAvailable: true` in the audit report) and
is a lockfile-only update to a dev-only transitive dependency, so the sequencing cost is trivial and
the alternative is a gate nobody keeps.

**On severity:** the advisory is a denial-of-service in brace expansion reachable through
`minimatch` during lint-time glob expansion over repository-controlled patterns. It is dev-only and
not attacker-reachable in this project. It is still worth remediating and gating, because the *gate*
is the durable part — the next high-severity advisory should not pass silently either. The
specification requires a recorded justification for any accepted exception, so if the implementer
judges an exception appropriate, it must be written down with a review date rather than left implicit.

### D4 — Pin Python, and make the failure name its cause

**Decision.** Add a `.python-version`, state the supported range in the toolchain README and
`ONBOARDING.md`, and add a preflight check at the top of `reduce_bbh_merger.py` that terminates with
a message naming the missing package and the supported interpreter range.

**Rationale.** `requirements.txt` excludes `sxs` on Python 3.12+ to accommodate a build limitation.
That marker is invisible at runtime: the failure is `ModuleNotFoundError: No module named 'sxs'` from
inside a function, which reads as a broken install rather than an unsupported interpreter. A
reproducibility gate that cannot be run, and fails misleadingly when it cannot, is worse than one
that says so.

**Explicit honesty requirement:** the toolchain README currently says "A clean environment can
reproduce the committed runtime artifact exactly." That claim is only true on a supported
interpreter. The correction must state the condition rather than quietly narrowing the sentence.

### D5 — Fix the ignored parameters, and self-check the correspondence

**Decision.** Use the supplied radius parameters in both branches of the disk sampler, remove the
self-assignment, and add a self-check that the parameters passed to artifact emission equal the
values that will be written into the manifest's source-lock block. Refuse to write on mismatch.

**Rationale.** This is the one audit finding where a *scientific provenance* invariant is not enforced
by code. Today `PROD_DISK_R_IN == DISK_R_IN`, so the committed artifact is correct. But the manifest
is generated from parameters and the binary from constants; nothing checks they agree. The source-lock
design's entire value is that the manifest cannot describe something the artifact does not do — and
right now it can.

**The self-check is the durable part.** Even after the fix, a future parameter added to
`emit_artifact` could be forgotten in the sampler. The check makes that a failure rather than a silent
divergence.

**Do not regenerate the committed artifact** unless the self-check shows it is wrong. It currently
is not, and regenerating would change checksums for no reason.

### D6 — Remove the shell layer from the preflight script

**Decision.** Invoke the package query without a command interpreter, resolving the platform-specific
executable directly. Replace the bare `~` substring rule with a path-anchored test.

**Rationale.** `shell: true` is unnecessary for a fixed argument array, and it concatenates a
config-derived string into a shell command line. In a script whose whole purpose is to be a security
preflight, an unnecessary shell layer is a credibility problem even when the current configuration is
benign. The `'~'` rule is a correctness bug: any pinned version range containing a tilde is reported
as a home-directory path.

**Also worth noting in `design.md`:** the script's JSON-with-comments stripper is string-unaware, and
its own comment admits it. A comment-like sequence inside a string value could truncate the document
into something that still parses. The handoff documentation claims adversarial coverage; add a test
case for it.

## Risks / Trade-offs

- **[404 fallback serves shell for missing assets]** → Mitigation: scope the configuration to
  navigation requests; the test fixture asserts a missing asset still returns a not-found status.
- **[Audit gate opens red]** → Mitigation: D3 lands the remediation in the same change.
- **[Action pinning creates staleness]** → Mitigation: Dependabot for actions, in the same change.
- **[Python preflight breaks a working path]** → Mitigation: the preflight must not fire on a
  supported interpreter; test both paths.
- **[Generator self-check refuses a legitimate re-emission]** → Mitigation: the check compares the
  parameters against the source-lock block, which is the intended invariant; if they legitimately
  differ, that is a decision to make deliberately, not a default.
- **[Dependency review false positives on dev dependencies]** → Mitigation: configure the review job
  for the production dependency scope.

## Testing strategy

- **Deployment contract:** serve `dist/` from a plain static server; assert a deep link 404s without
  the configuration and returns the shell with it; assert a missing asset still 404s. Runs in hosted
  CI; needs no GPU.
- **Sub-path:** build with a sub-path `base` and assert asset URLs resolve under it.
- **CI gates:** confirm the audit gate fails before the remediation and passes after; confirm
  `permissions` and `concurrency` take effect by inspecting a run's job summary.
- **Python:** run the reduction tool on an unsupported interpreter and confirm the message names the
  package and the range; confirm it does not fire on a supported one.
- **Generator:** change a production disk-radius parameter, re-emit to a scratch directory, and
  confirm both the manifest value and the binary hash change; confirm the self-check refuses when
  parameters and the source-lock block disagree.
- **Preflight:** test the script against a configuration containing a tilde version range (must pass),
  a home-directory reference (must fail), and a string value containing a comment-like sequence.

## Open Questions

None blocking. One judgement call: whether to implement sub-path support or document the root-path
assumption. Both satisfy the requirement; silence does not. Recommendation — implement, because
project-site hosting is common and the failure is silent.
