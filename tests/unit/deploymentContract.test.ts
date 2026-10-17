/**
 * Deployment-contract test (operations-and-deployment-readiness 1.4-1.6).
 *
 * Serves `dist/` from a PLAIN static server and asserts the committed
 * SPA-fallback contract:
 *
 * - WITHOUT the fallback configuration, a deep link 404s (the 0.5
 *   before-evidence — plain static servers have no SPA fallback);
 * - WITH the committed `_redirects` semantics, a deep link returns the
 *   application shell (200 + the shell document) at the ORIGINAL URL, while
 *   a MISSING ASSET keeps its not-found status (navigation-only scoping).
 *
 * Needs no graphics device: it validates routing, response status and asset
 * resolution only (1.5). Wired into `npm run test`, therefore into the
 * hosted quality job (1.7).
 */

import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIST = join(REPO_ROOT, 'dist');

/** Parse the committed Netlify-style _redirects into ordered rules. */
interface RedirectRule {
  readonly from: string;
  readonly to: string;
  readonly status: number;
}

function parseRedirects(): RedirectRule[] {
  const text = readFileSync(join(REPO_ROOT, 'public', '_redirects'), 'utf8');
  const rules: RedirectRule[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const [from, to, status] = trimmed.split(/\s+/);
    rules.push({ from: from!, to: to!, status: Number(status ?? '200') });
  }
  return rules;
}

/** Minimal faithful `_redirects` matcher for the committed rule shape. */
function resolveRedirect(rules: RedirectRule[], path: string): RedirectRule | null {
  for (const rule of rules) {
    if (rule.from.startsWith('/') && rule.from.includes('*')) {
      const ext = rule.from.slice(rule.from.indexOf('.')); // '/*.js' -> '.js'
      if (ext.startsWith('.') && path.endsWith(ext)) return rule;
      if (rule.from === '/*') return rule;
    } else if (rule.from === path) {
      return rule;
    }
  }
  return null;
}

function startServer(options: { fallback: boolean }): Promise<{ server: Server; port: number }> {
  const rules = parseRedirects();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const requested = normalize(url.pathname).replace(/^([/\\])+/, '');
    const filePath = join(DIST, requested);
    if (requested !== '' && existsSync(filePath)) {
      res.statusCode = 200;
      res.end(readFileSync(filePath));
      return;
    }
    if (options.fallback) {
      const rule = resolveRedirect(rules, url.pathname);
      if (rule !== null) {
        const target = rule.to === '/index.html' ? 'index.html' : rule.to.replace(/^\//, '');
        const targetPath = join(DIST, target);
        if (existsSync(targetPath)) {
          res.statusCode = rule.status;
          res.end(readFileSync(targetPath));
          return;
        }
      }
    }
    res.statusCode = 404;
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: typeof address === 'object' && address !== null ? address.port : 0 });
    });
  });
}

describe('deployment contract (O-01)', () => {
  let plain: { server: Server; port: number };
  let configured: { server: Server; port: number };

  beforeAll(async () => {
    plain = await startServer({ fallback: false });
    configured = await startServer({ fallback: true });
  });

  afterAll(async () => {
    await new Promise((r) => plain.server.close(r));
    await new Promise((r) => configured.server.close(r));
  });

  it('WITHOUT the fallback configuration a deep link does not serve the shell (0.5 evidence)', async () => {
    const response = await fetch(`http://127.0.0.1:${plain.port}/atlas/black-hole`);
    expect(response.status).toBe(404);
  });

  it('WITH the committed configuration a deep link returns the shell at the original URL', async () => {
    const response = await fetch(`http://127.0.0.1:${configured.port}/atlas/black-hole`);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body, 'the deep link must receive the application shell').toContain('<div id="app">');
  });

  it('a missing asset keeps its not-found status (navigation-only scoping)', async () => {
    const response = await fetch(`http://127.0.0.1:${configured.port}/assets/does-not-exist.js`);
    expect(response.status, 'a missing asset must NOT masquerade as the shell').toBe(404);
    const body = await response.text();
    expect(body).not.toContain('<div id="app">');
  });

  it('an existing asset is served as itself', async () => {
    // dist/index.html is guaranteed present after `npm run build`.
    expect(existsSync(join(DIST, 'index.html'))).toBe(true);
    const response = await fetch(`http://127.0.0.1:${configured.port}/index.html`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="app">');
  });

  it('the committed configs carry the documented fallback shape', () => {
    // vercel.json excludes asset classes and extension paths from the rewrite.
    const vercel = JSON.parse(readFileSync(join(REPO_ROOT, 'vercel.json'), 'utf8')) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };
    const rewrite = vercel.rewrites?.[0];
    expect(rewrite?.destination).toBe('/index.html');
    expect(rewrite?.source, 'the rewrite must exclude extension paths').toContain('\\.');

    // 404.html scopes its fallback to navigation (extension check present).
    const notFound = readFileSync(join(REPO_ROOT, 'public', '404.html'), 'utf8');
    expect(notFound, 'the fallback must be scoped by an extension check').toContain(
      '[A-Za-z0-9]+$'
    );
    expect(extname('/atlas/black-hole')).toBe('');
  });
});
