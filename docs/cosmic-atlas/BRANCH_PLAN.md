# Branch and integration plan

## Planning branch

```text
research/cosmic-atlas-phenomena
```

Base when created:

```text
main @ 91edc737aa26e6bfc83bd345cb1f7fd4d75b6145
```

That commit merged the original black-hole implementation blueprint into `main`.

## Purpose

This branch contains planning/research only unless the user explicitly authorizes implementation on it.

It should be reviewable independently from the original black-hole implementation plan.

## Merge strategy

When the Cosmic Atlas plan is accepted:

1. merge documentation into `main` or keep it as a planning PR according to project governance;
2. do not replace `.agent/START_HERE.md` for the current black-hole milestone;
3. keep `.agent/COSMIC_ATLAS_HANDOFF.md` as the entry point for Atlas work;
4. begin CA0 only when black-hole renderer/application boundaries are ready;
5. implement CA milestones on dedicated feature branches/PRs rather than committing all future Atlas code to the research branch.

## Suggested implementation branch sequence

```text
feat/atlas-ca0-host
feat/atlas-ca1-transition
feat/atlas-ca2-shared-gpu-services
feat/atlas-ca3-neutron-star
feat/atlas-ca4-stellar-explosion
feat/atlas-ca5-compact-merger
feat/atlas-ca6-tde
feat/atlas-ca7-quasar
feat/atlas-ca8-bbh-merger
feat/atlas-ca9-galaxy-collision
```

Depending on repository workflow, several bounded work packets may share one milestone branch, but avoid one years-long mega-branch.

## Interaction with existing black-hole roadmap

The black-hole M0-M11 roadmap remains the scientific authority for Black Hole.

Cosmic Atlas CA0 should adapt to the implemented renderer rather than preemptively rewriting it.

When shared infrastructure is useful to Black Hole and Atlas:

- extract it only with regression tests;
- preserve black-hole numerical contracts;
- update both architecture documents if ownership changes.

## Parallel development policy

After CA0-CA2 stabilize, selected destination work can be parallelized if shared service contracts are frozen enough.

Safe examples:

- CA3 neutron-star physics/reference work;
- CA4 supernova procedural-volume research;
- CA8 data-source/extractor research;
- CA9 galaxy dataset/reduction research.

Unsafe examples:

- four agents independently creating particle engines;
- destination agents modifying the global resource lifecycle concurrently;
- one agent changing time/state schema while others build on old assumptions.

## Planning branch acceptance

Before merging this planning branch:

- taxonomy reviewed;
- launch destination count accepted;
- one-app architecture accepted;
- fidelity policy accepted;
- transition/loading approach accepted;
- CA0-CA12 roadmap accepted;
- no documentation contradicts existing black-hole scientific contracts;
- references/provenance policy clear.

## Implementation readiness

This branch is implementation-ready when a fresh agent can read `.agent/COSMIC_ATLAS_HANDOFF.md`, identify CA0, and begin host/lifecycle integration without needing the originating chat conversation.