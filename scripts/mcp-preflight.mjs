#!/usr/bin/env node
// scripts/mcp-preflight.mjs
//
// Repository-local MCP configuration preflight.
//
// Purpose (REPOSITORY_LOCAL_ADDONS_MASTER_PLAN.md, Phase 4):
//   - detect duplicate server IDs across tracked config files
//   - require every server to be repository-scoped (type "local", command array)
//   - require pinned package versions (reject "@latest" / bare / unpinned)
//   - reject references to global / home-directory paths
//   - reject embedded secret-like values
//   - optionally verify pinned packages resolve on the npm registry (--online)
//
// This script is static + read-only. It NEVER contacts protected environments
// or mutates real user data. With --online it only performs read-only
// `npm view <pkg>@<version> version` lookups.
//
// Usage:
//   node scripts/mcp-preflight.mjs [--config path ...] [--online]

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_CONFIGS = ["opencode.json", ".mcp.json", "mcp.json"];

const ALLOWED_LAUNCHERS = new Set([
  "npx",
  "uvx",
  "node",
  "bun",
  "deno",
  "python",
  "python3",
  "pnpm",
]);

// Global / home-directory path fragments that must never appear (repo-local only).
const GLOBAL_FRAGMENTS = [
  "~",
  "/Users/",
  "\\Users\\",
  "C:\\Users\\",
  "/home/",
  "$HOME",
  "%USERPROFILE%",
  "/usr/local/share",
  "/etc/",
];

const SECRET_RE =
  /(?:api[_-]?key|secret|token|password|passwd|authorization|bearer)\s*[:=]\s*["']?[A-Za-z0-9_\-./+/]{12,}/i;
const PLACEHOLDER_RE = /^(YOUR_|CHANGE|EXAMPLE|REPLACE|<|\{|<insert)/i;

let ONLINE = false;
const extraConfigs = [];

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--online") ONLINE = true;
  else if (a === "--config") extraConfigs.push(process.argv[++i]);
}

const problems = [];
const notes = [];
const seenIds = new Map(); // id -> config file

function stripJsonc(text) {
  // Remove /* */ block comments and // line comments (best-effort, no strings awareness).
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function loadServers(file) {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8");
  let data;
  try {
    data = JSON.parse(stripJsonc(raw));
  } catch (e) {
    problems.push(`${file}: JSON parse error: ${e.message}`);
    return null;
  }
  const servers = [];
  if (data?.mcp && typeof data.mcp === "object") {
    for (const [id, s] of Object.entries(data.mcp)) servers.push({ id, s, file });
  }
  if (data?.mcpServers && typeof data.mcpServers === "object") {
    for (const [id, s] of Object.entries(data.mcpServers))
      servers.push({ id, s, file });
  }
  if (!servers.length) notes.push(`${file}: no mcp / mcpServers entries`);
  return servers;
}

function checkGlobalRefs(name, file, value) {
  if (typeof value !== "string") return;
  const lower = value.toLowerCase();
  for (const frag of GLOBAL_FRAGMENTS) {
    if (lower.includes(frag.toLowerCase())) {
      problems.push(
        `${file} [${name}]: references global/home path fragment "${frag}" (must be repository-local)`,
      );
    }
  }
}

function checkSecrets(name, file, key, value) {
  if (typeof value !== "string") return;
  if (value.includes("${") || value.includes("$ENV")) return; // env var reference, externalized
  if (SECRET_RE.test(`${key}=${value}`) && !PLACEHOLDER_RE.test(value)) {
    problems.push(
      `${file} [${name}]: possible embedded secret in "${key}" (externalize via env var)`,
    );
  }
}

function inspectStrings(name, file, obj) {
  if (Array.isArray(obj)) {
    obj.forEach((v) => checkGlobalRefs(name, file, v));
    return;
  }
  if (obj && typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      checkGlobalRefs(name, file, v);
      checkSecrets(name, file, k, v);
      if (v && typeof v === "object") inspectStrings(name, file, v);
    }
  }
}

function checkPinned(launcher, args, name, file) {
  if (launcher === "npx" || launcher === "uvx") {
    // first non-flag argument after the launcher is the package spec
    const spec = args.find((a) => typeof a === "string" && !a.startsWith("-"));
    if (!spec) {
      problems.push(`${file} [${name}]: ${launcher} missing a package spec`);
      return;
    }
    if (/@latest$/i.test(spec) || spec === "latest") {
      problems.push(
        `${file} [${name}]: unpinned "${spec}" — pin an explicit version per plan`,
      );
      return;
    }
    // must carry an explicit semver-ish version: pkg@x.y.z
    if (!/^(@?[\w./-]+)@[\w.+-]+$/.test(spec)) {
      problems.push(
        `${file} [${name}]: package spec "${spec}" is not pinned to an explicit version`,
      );
      return;
    }
    if (ONLINE) {
      try {
        execFileSync("npm", ["view", spec, "version"], {
          stdio: "pipe",
          shell: true,
          timeout: 60000,
        });
        notes.push(`${file} [${name}]: registry resolved ${spec}`);
      } catch {
        problems.push(
          `${file} [${name}]: pinned package "${spec}" not found on npm registry`,
        );
      }
    }
  }
}

const configs = [...extraConfigs, ...DEFAULT_CONFIGS];
const resolved = new Set();
for (const c of configs) {
  const abs = resolve(__dirname, "..", c);
  if (!existsSync(abs)) continue;
  if (resolved.has(abs)) continue;
  resolved.add(abs);

  const servers = loadServers(abs);
  if (!servers) continue;
  for (const { id, s, file } of servers) {
    if (seenIds.has(id)) {
      problems.push(
        `duplicate server id "${id}" in ${file} and ${seenIds.get(id)}`,
      );
    } else {
      seenIds.set(id, file);
    }

    const type = s?.type ?? (s?.url ? "remote" : "local");
    if (type !== "local") {
      problems.push(
        `${file} [${id}]: server type "${type}" is not repository-local (only "local" allowed)`,
      );
    }
    if (!Array.isArray(s?.command) || s.command.length === 0) {
      problems.push(`${file} [${id}]: missing command array`);
      continue;
    }
    const launcher = s.command[0];
    if (!ALLOWED_LAUNCHERS.has(launcher)) {
      problems.push(
        `${file} [${id}]: launcher "${launcher}" not in allowed set ${[
          ...ALLOWED_LAUNCHERS,
        ].join(",")}`,
      );
    }
    checkPinned(launcher, s.command.slice(1), id, file);
    inspectStrings(id, file, s);
  }
}

console.log("MCP preflight — repository-local configuration audit");
console.log(`mode: ${ONLINE ? "online (registry-checked)" : "static"}`);
console.log(`configs scanned: ${[...resolved].map((p) => resolve(p)).join(", ") || "(none found)"}`);
for (const n of notes) console.log(`  note: ${n}`);

if (problems.length) {
  console.error("\nFAIL:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("\nPASS: all repository-local MCP invariants satisfied.");
process.exit(0);
