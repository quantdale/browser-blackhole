# Fresh-machine onboarding

This is the canonical bootstrap entry point for a new workstation or a fresh coding-agent environment. Complete this document before implementation work. The objective is a reproducible machine that can build, test, inspect, and operate this repository without rediscovering tooling mid-campaign.

## 1. Preflight rule

1. Clone the repository and enter its root.
2. Confirm the intended repository/branch and fetch current `origin/main`.
3. Read the repository control-plane documents before changing code: `AGENTS.md`, `README.md`, `.agent/START_HERE.md`, `.agent/STATE.md`, `docs/RELEASE_CERTIFICATION.md`.
4. Install/verify the machine prerequisites below.
5. Enable the committed agent integrations and repository-local skills.
6. Restore dependencies from lockfiles/pins; do not casually upgrade them during bootstrap.
7. Run the baseline validation commands.
8. Only then begin a development campaign. If a prerequisite cannot be satisfied, record it as an environment blocker rather than weakening a gate.

Credentials, API keys, signing material, account logins, licensed models/assets, and other secrets are machine/user responsibilities. Never commit them.

## 2. Supported host and prerequisites

**Primary host:** Desktop Windows/Linux/macOS; a hardware WebGPU-capable Chrome/Edge-class browser is required for full visual/performance qualification.

**Required machine tools**
- Git
- Node.js >= 22.12.0 + npm
- Chromium/Chrome or Edge with WebGPU for hardware validation
- Playwright browser dependencies
- Python when running the repository's scientific data-reduction tools

**Task-dependent / optional tools**
- Firefox for cross-engine fallback matrix
- GPU timestamp-query capable hardware for true GPU benchmark evidence


## 3. Agent setup

- Load repository instructions before acting. Prefer committed repository state over chat history.
- Repository-local skills: `goal`.
- Agent adapter/config directories present in this repository should be discovered and used in-place; do not duplicate them globally unless the harness cannot load repository-local configuration.
- Relevant committed agent surfaces: `.agent/`, `.agents/`, `.claude/`, `.kimi-code/`, `.opencode/`, `opencode.json`.
- MCP policy: No root `.mcp.json` is currently committed. The repo exposes `npm run mcp:preflight`; follow repository state rather than adding ad-hoc MCPs.
- Keep MCP/plugin authority narrow. Documentation/diagnostic MCPs are not permission to change architecture, bypass tests, or publish.
- Authentication for GitHub and coding-agent CLIs is configured separately on the machine. Never write tokens into tracked files.

## 4. Bootstrap

Run the repository's pinned bootstrap, not an improvised dependency upgrade:

```bash
npm ci
npx playwright install chromium
```

Do not regenerate visual goldens merely to make tests pass. Hardware-WebGPU goldens and performance evidence have explicit provenance requirements.


## 5. Editor/LSP baseline

Use the repository-local TypeScript 5.9 server, ESLint, and Prettier. Shader/TSL work should be edited with the Three.js types from the lockfile, not a newer global package.

The editor is optional; the language servers are not. Agents should have diagnostics/type information available before editing non-trivial code.

## 6. Baseline verification

```bash
npm run check
npm run e2e
npm run lut:validate -- public/luts/schwarzschild-v1-415dea94
npm run mcp:preflight
```

A fresh machine is considered **development-ready** only when the applicable non-external gates above pass. Hardware/device/signing/account gates may remain explicitly blocked if the repository already classifies them that way.

## 7. Fresh-agent instruction

Use this exact operating rule when handing the repository to a new agent:

> Read `ONBOARDING.md` first. Set up every applicable prerequisite, repository-local skill, MCP/plugin, dependency, browser/device/runtime tool, and validation gate described there. Then read the repository's durable agent state and only start implementation after preflight is green or a genuine environment blocker is recorded. Do not replace pinned tooling, skip gates, or invent work to compensate for a missing machine capability.
