# Repository-Local Add-ons — Implementation Handoff

Implements `REPOSITORY_LOCAL_ADDONS_MASTER_PLAN.md` on `quantdale/browser-blackhole`.
Status: **IMPLEMENTED** (Phase 0–7 complete). Branch: `feat/repo-local-addons`.

## What was added (the bounded diff)

| File | Change | Scope |
|------|--------|-------|
| `opencode.json` | NEW | Repository-local MCP configuration (additive) |
| `scripts/mcp-preflight.mjs` | NEW | Phase 4 preflight validator |
| `package.json` | EDIT (additive) | Added `mcp:preflight` + `mcp:preflight:online` scripts |
| `docs/agent-integrations/REPOSITORY_LOCAL_ADDONS_HANDOFF.md` | NEW | This handoff |

No existing file was removed, disabled, renamed, replaced, or silently rewritten.

## Recommendation revalidation (Phase 2)

Both items were revalidated against current repository truth (HEAD `acdd8e6`, 442 tracked files, no pre-existing MCP config) and current upstream.

### 1. Chrome DevTools MCP — ADDED (`chrome-devtools-mcp`)

- **Upstream:** Google ChromeDevTools, `ChromeDevTools/chrome-devtools-mcp`. License Apache-2.0.
- **Package:** `chrome-devtools-mcp@1.8.0` (verified on npm; `npm view` resolves).
- **Why it fits:** Live WebGPU/WebGL performance, GPU/resource, console, memory and frame-time diagnostics on the local atlas — complementary to the Playwright e2e/golden suite (which asserts behavior, not live introspection).
- **Scope:** Local `npx` invocation from repo cwd. It launches/attaches **only a disposable local Chrome**; it has no authority over repo source, tests, CI, or release.
- **Privacy posture:** Launched with `--no-usage-statistics` (Google usage telemetry off) and `--no-performance-crux` (no trace URLs sent to the Google CrUX API). No secrets required.
- **Prerequisite (runtime, not committed):** a local Google Chrome / Chrome-for-Testing on PATH. Server fails gracefully if absent.

### 2. Context7 MCP — ADDED (`@upstash/context7-mcp`)

- **Upstream:** Upstash, `upstash/context7`. License MIT.
- **Package:** `@upstash/context7-mcp@4.0.3` (verified on npm; `npm view` resolves).
- **Why it fits:** Version-specific Three.js / TSL / WebGPU-adjacent documentation, directly addressing the renderer's version-sensitive surface. Docs only — it cannot establish scientific correctness.
- **Scope:** Local `npx` invocation from repo cwd, **anonymous public endpoint** (no API key). The optional `--api-key` (higher rate limits / private repos) was deliberately **omitted**; no secret is committed.
- **Authority:** Read-only docs retrieval. No write/network authority over repo governance.

## Repository-local configuration mechanism

`opencode.json` is the native config file for this repository's agent tooling (OpenCode). MCP servers are declared under the top-level `"mcp"` map with `"type": "local"` and an explicit `command` array. The config is committed at repo root, so any OpenCode session started in the repo cwd loads it — no user-wide/global registry modification.

Pinned versions are embedded directly in the `npx` package spec (`pkg@x.y.z`), satisfying the plan's "never blindly use `latest`" rule.

## Activation steps

1. Start an OpenCode session in the repository root (the `opencode.json` is auto-loaded).
2. Confirm the two servers are connected: `chrome-devtools`, `context7`.
3. For live Chrome diagnostics, ensure Chrome is installed; Chrome DevTools MCP auto-spawns a disposable Chrome.
4. To invoke docs: reference Context7 in a prompt (e.g. `use context7`).

Optional preflight (re-run any time):

```bash
npm run mcp:preflight            # static checks, no network
npm run mcp:preflight:online     # also verifies pinned packages resolve on npm
```

## Environment-variable names (external only)

- `CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS` / `CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS` — recognized by Chrome DevTools MCP (not set in config; opt-in externally).
- `CONTEXT7_API_KEY` — optional, recognized by Context7 for higher limits (not set in config; external only).

No credential, token, cookie, or private path is present in any committed file.

## Test / validation results (Phase 5)

- `node scripts/mcp-preflight.mjs` → **PASS** (static invariants).
- `node scripts/mcp-preflight.mjs --online` → **PASS** (both pinned packages resolve on npm).
- Negative boundary proven: the preflight **fails** on `@latest`, on a remote/`url`-style server, on a global `/Users/...` path, and on an embedded `api_key` value. (Verified via `--config` against synthetic bad configs during implementation.)
- `npm run lint` / `npm run typecheck` → unaffected (additive config-only change; no source or test files touched).

## Preservation audit (Phase 6)

- **Zero removals:** git diff is strictly additive (`opencode.json`, `scripts/mcp-preflight.mjs`, handoff doc) plus one additive script block in `package.json`.
- **Zero hidden global changes:** no `~/.mcp.json`, no user-wide editor settings, no global npm/pip/cargo mutation; config is repo-root only.
- **Zero secret leakage:** `grep -ri secret|token|api_key` over the new files returns only the preflight's detection logic and this doc's variable-name list.
- **Zero unrelated dependency churn:** `package.json` devDependencies unchanged; servers are fetched ephemerally via `npx` (no new dependency added).
- **Zero weakening of existing authority:** AGENTS.md, `.agent/`, `.claude/`, `.opencode/`, CI, and the Playwright/bench/test harnesses are untouched and remain authoritative for tests, releases, devices, security, and scientific evidence.

## Blocked / not-recommended items

- **GLOBAL_SCOPE_BLOCKED / NOT_RECOMMENDED:** none required. The plan's explicitly-not-recommended items (automatic golden regeneration, Playwright MCP duplicating the existing suite, auto-rewriting research connectors) were **not** added.
- No item was rejected as net-negative.
