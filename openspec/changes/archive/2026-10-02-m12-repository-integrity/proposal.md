# Proposal: M12 Repository Integrity and Evidence Hardening

Change ID: `m12-repository-integrity`
Priority: **MEDIUM / REQUIRED BEFORE CA9 RUNTIME**
Depends on: `m12-neutron-star-surface-lensing` closed or explicitly contained with truthful fidelity downgrade
Blocks: CA9 runtime/release work

## Why

The deep audit found multiple cases where repository control-plane text, package policy, CI naming and validation discoverability no longer match the actual system. None independently proves a broken user runtime, but together they can misdirect an autonomous executor and weaken release evidence.

This change makes the repository tell the truth about itself before another major destination is added.

## What changes

- Synchronize README/status/roadmap/state claims with the actual post-M11 system and the final neutron-star fidelity result.
- Reconcile exact dependency-pin policy with the `tsx` version range in `package.json` and lockfile.
- Make hosted CI’s browser-job contract explicit: true smoke-only or explicitly broad fallback suite, with code/comments/docs aligned.
- Replace the known black-hole-merger fixed-delay waveform synchronization test with condition/state-based waiting.
- Close benchmark command/evidence discoverability gaps for production Cosmic Atlas destinations, including the existing stellar-explosion harness and the neutron-star harness created by M12-NS.
- Audit top-level public claims against implementation/spec status so future agents are not sent toward completed historical milestones.
- Ensure the new OpenSpec campaign and durable agent state/backlog converge at closure.

## Non-goals

- broad architecture refactors;
- new scientific phenomena;
- changing numerical tolerances or quality budgets without evidence;
- rerunning already rejected speculative optimizations;
- shrinking test coverage merely to reduce CI time.

## Success criteria

- no active agent entry point tells an executor to redo M0–M11;
- package/dependency documentation agrees with the manifest and lockfile;
- CI job name/comment/docs match the test command actually executed;
- no fixed arbitrary sleep remains in the specifically known waveform sync assertion if a deterministic state/event condition exists;
- every production destination’s benchmark path is either exposed consistently or explicitly documented as intentionally unavailable;
- README/current-state claims match measured/implemented reality;
- `npm run check` and intended browser gates pass.
