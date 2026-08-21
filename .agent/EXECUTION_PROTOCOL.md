# Autonomous execution protocol

This file defines how an implementation agent should operate over long, multi-session development without relying on chat history.

## 1. Startup protocol

At the beginning of every fresh session:

1. inspect current branch, `git status`, and last 10 commits;
2. read `.agent/STATE.md` completely;
3. read the current milestone in `docs/ROADMAP.md` and matching section in `docs/MILESTONE_WORK_PACKETS.md`;
4. read only the domain specs relevant to the next packet, plus `AGENTS.md` and quality gates if not already in context;
5. inspect current code/tests before planning edits;
6. identify the smallest coherent checkpoint that advances the current milestone;
7. execute without asking the user to decompose already-documented work.

If repository state conflicts with `.agent/STATE.md`, trust actual Git/code/test evidence first, then repair `.agent/STATE.md` in the same checkpoint.

## 2. Work selection

Priority order:

1. broken build/test/critical correctness regression;
2. current milestone blocking packet;
3. current milestone validation/instrumentation needed to prove a packet;
4. current milestone feature work;
5. documentation/state maintenance;
6. research for next milestone if current work is externally blocked.

Do not start later “interesting” features while a current milestone exit gate is red.

## 3. Packet contract

Before editing, state internally or in working notes:

- packet ID;
- invariant/behavior being changed;
- owning modules/files;
- tests/evidence required;
- likely invalidation/performance impact;
- external API/version assumptions.

A packet should normally end in one buildable commit. If it is too large, split at a vertical boundary that is independently testable.

## 4. Evidence-first rule

For bug fixes:

1. reproduce deterministically;
2. add/identify failing test or probe where possible;
3. fix root cause;
4. run regression test;
5. run impacted cumulative gates.

For physics changes, a screenshot alone is never sufficient evidence.

For performance changes, a benchmark before/after under matched metadata is mandatory once M6 harness exists.

## 5. Parallel/sub-agent protocol

The main agent is integrator and owns final truth.

Before spawning sub-agents:

- choose independent packets;
- assign explicit write boundaries;
- give each agent the relevant conventions/specs;
- prohibit overlapping edits to shared state/schema/core shader assembly unless one agent owns integration;
- require each sub-agent to report changed files, tests, assumptions, and commit/diff.

Good parallel work examples:

- CPU reference tests vs UI shell;
- documentation vs isolated benchmark tooling;
- asset/provenance audit vs browser compatibility research;
- independent reference derivation/research that produces no overlapping code.

Bad parallel work examples:

- two agents rewriting `state.ts`;
- two agents modifying the same geodesic equations;
- one agent changing units while another writes physics fixtures;
- multiple uncoordinated agents updating renderer lifecycle.

Integrate one branch/diff at a time and rerun cumulative tests after each material merge.

## 6. Scientific change protocol

Any change to:

- units;
- metric equations;
- tetrads;
- momentum sign convention;
- integrator equations;
- disk orbit model;
- redshift/intensity transform;
- characteristic radii;
- LUT decode/domain;
- Kerr convention

requires:

1. identify source/convention;
2. update documentation/ADR if convention changes;
3. add/update CPU reference test;
4. compare GPU result where applicable;
5. run symmetry/limit tests;
6. ensure no unrelated visual knob is compensating for changed physics.

## 7. Shader change protocol

Before declaring shader work complete:

- no compilation/runtime errors;
- selected affected debug view inspected;
- CPU/GPU probe comparison where relevant;
- non-finite/max-step classifications visible;
- deterministic visual baseline run;
- fallback compilation tested if the feature claims fallback support;
- performance evidence recorded if loop/sampling/resource cost changed materially.

## 8. State/schema protocol

State changes require:

- schema/type update;
- normalization validation;
- defaults;
- invalidation classification;
- preset migration/update if persisted/shared;
- unit tests;
- UI control mapping if user-facing.

No direct UI-to-uniform bypass.

## 9. Dependency protocol

Before adding/upgrading dependency:

- confirm need;
- check current official version/docs;
- check license;
- inspect bundle/runtime implications;
- update lockfile;
- run full deterministic check + browser smoke;
- update `docs/DEPENDENCIES.md` when architecture-relevant.

## 10. Failure handling

If a checkpoint becomes unstable:

- stop stacking features;
- classify failure using `FAILURE_RECOVERY.md`;
- minimize/reproduce;
- revert only the broken local change if needed, preserving unrelated validated work;
- do not disable tests or hide numerical failures;
- record unresolved environment-only blockers explicitly.

## 11. Commit discipline

Before commit:

1. inspect `git status`;
2. inspect diff by file;
3. ensure no generated junk/secrets/absolute machine paths;
4. run required tests;
5. update state/evidence when checkpoint warrants;
6. stage only intended files;
7. commit descriptive message;
8. push current feature branch if remote workflow expects it.

Do not force-push shared history unless explicitly authorized.

## 12. State update rules

`.agent/STATE.md` is the single durable continuation point. Update it after every milestone and any substantial checkpoint that changes what the next fresh agent should do.

It must contain:

- current phase/status;
- exact head commit after commit is available, or `pending commit` before finalization with a follow-up update;
- completed packet IDs;
- passing/failing/deferred gates;
- commands/tests run;
- browser/backend/hardware actually tested;
- artifacts/benchmark paths;
- known defects/debt;
- next 3–7 concrete packet IDs/actions.

Do not fill it with narrative history better suited to commit log.

## 13. Handoff protocol

A session may stop only at a coherent boundary whenever possible. Before handoff:

- repository builds or the exact blocking failure is recorded;
- working tree state is explained;
- no hidden local dependency on uncommitted machine config;
- `.agent/STATE.md` points to the next action;
- checkpoint report follows `.agent/CHECKPOINT_TEMPLATE.md`.

## 14. Definition of autonomy

Autonomy means the agent makes routine engineering choices inside locked architecture and acceptance criteria. It does not mean silently changing project goals, scientific conventions, licensing policy, or removing hard quality gates to make progress appear faster.