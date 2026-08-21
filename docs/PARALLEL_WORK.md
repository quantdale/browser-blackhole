# Parallel and sub-agent execution plan

The project contains many parallelizable domains, but shader interfaces and physics conventions create integration hazards. Use one orchestrator as integration owner and delegate bounded work packets with explicit file ownership.

## Rules

- Up to roughly 16 concurrent workers may be useful during large milestones if the harness and machine support it, but concurrency is a ceiling, not a target.
- Never parallelize dependent tasks just to increase utilization.
- Each worker receives: task ID(s), allowed files/directories, interfaces it may consume, tests/acceptance criteria, and prohibited shared files.
- Workers do not independently change dependency versions, global state schema, unit conventions, shader ABI, or CI unless assigned ownership.
- Orchestrator integrates in dependency order and runs cumulative gates.

## Good parallel boundaries once foundation exists

1. CPU/reference physics and fixtures.
2. GPU geodesic implementation against a frozen interface.
3. Star/environment renderer.
4. Disk intersection math/reference cases.
5. Disk spectrum/blackbody approximation research.
6. UI control components against a frozen state schema.
7. Playwright/browser harness.
8. Visual regression tooling.
9. Benchmark/telemetry tooling.
10. Dynamic-resolution controller in CPU/state layer.
11. Post-processing/HDR investigation.
12. LUT research/provenance (research-only before M8).
13. Compatibility/fallback research.
14. Documentation/educational content.
15. Deployment/CI hardening.
16. Independent physics review/derivation audit.

## Poor parallel boundaries

- two agents editing the same central geodesic shader;
- one changing units while another writes physics tests;
- one changing state schema while UI and presets are being implemented without coordination;
- simultaneous Three.js major-version/dependency changes;
- Kerr implementation before Schwarzschild interface/correctness is stable.

## Suggested orchestrator protocol

1. Freeze interfaces for the wave.
2. Write work packet contracts.
3. Dispatch independent workers.
4. Require each worker to return changed files, tests run, assumptions, and unresolved concerns.
5. Integrate lowest-level contracts first: units/state -> reference physics -> GPU -> UI/post -> tests.
6. Resolve conflicts centrally; do not let workers merge conflicting semantics by guesswork.
7. Run cumulative quality gates.
8. Update `.agent/STATE.md` once, from the integrated state.

## Research workers

Research-only workers may inspect external implementations/papers without writing production code. They must return:

- exact source URLs;
- algorithms/equations relevant to the project;
- licensing/provenance status;
- mapping to this repository's conventions;
- risks/uncertainties;
- recommended experiments.

This is preferable to copying unfamiliar shader code into production.
