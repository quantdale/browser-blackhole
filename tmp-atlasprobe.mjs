import { preview } from 'vite';
import { chromium } from '@playwright/test';

const server = await preview({ preview: { port: 4180, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage();
const errs = [];
page.on('console', m => {
  const t = m.text();
  if (/error/i.test(m.type()) && !/powerPreference|readback|Failed to load resource/.test(t)) errs.push(t.slice(0, 160));
});
page.on('pageerror', e => errs.push('PAGEERROR ' + String(e).slice(0, 160)));

async function snap(label) {
  const state = await page.evaluate(() => {
    const app = window.__ATLAS_APP__;
    if (!app) return null;
    const s = app.host.state;
    return { dest: s.atlas.activeDestination, trans: s.atlas.transition, ready: true };
  }).catch(() => null);
  const px = await page.evaluate(() => {
    const c = document.getElementById('scene');
    if (!c || !c.width) return null;
    const off = document.createElement('canvas');
    off.width = c.width; off.height = c.height;
    const ctx = off.getContext('2d');
    ctx.drawImage(c, 0, 0);
    const pts = [];
    for (let i = 1; i <= 4; i++) {
      const d = ctx.getImageData(Math.floor(c.width * i / 5), Math.floor(c.height / 2), 1, 1).data;
      pts.push(`${d[0]},${d[1]},${d[2]}`);
    }
    return pts.join(' | ');
  }).catch(() => null);
  console.log(`[${label}] state=${JSON.stringify(state)} px=${px}`);
}

// Deep link straight into atlas black hole
await page.goto('http://127.0.0.1:4180/atlas/black-hole');
await page.waitForTimeout(6000);
await snap('atlas/black-hole initial');
const bhInfo = await page.evaluate(() => {
  const host = window.__ATLAS_APP__?.host;
  if (!host) return { wired: 'NO HOST' };
  return { dest: host.state.atlas.activeDestination };
}).catch(e => ({ err: String(e).slice(0, 80) }));
console.log('[bh-info]', JSON.stringify(bhInfo));

// In-app navigate to neutron star (fires hyperspace transition)
await page.evaluate(() => window.__ATLAS_APP__.navigate('neutron-star'));
await page.waitForTimeout(1200);
await snap('mid-transition to neutron-star');
await page.waitForTimeout(6000);
await snap('atlas/neutron-star arrived');

// Navigate to diagnostic
await page.evaluate(() => window.__ATLAS_APP__.navigate('diagnostic'));
await page.waitForTimeout(8000);
await snap('atlas/diagnostic arrived');

console.log('---CONSOLE ERRORS (' + errs.length + ') ---');
for (const e of [...new Set(errs)].slice(0, 10)) console.log('*', e);
await browser.close(); await server.close(); process.exit(0);
