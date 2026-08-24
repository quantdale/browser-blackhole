import { preview } from 'vite';
import { chromium } from '@playwright/test';

const preset = process.argv[2] ?? 'solar-canonical';
const server = await preview({ preview: { port: 4195, host: '127.0.0.1' } });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(`http://127.0.0.1:4195/atlas/tidal-disruption?preset=${preset}`);
await page.waitForFunction(
  () => window.__ATLAS_APP__ && window.__ATLAS_APP__.host.state.atlas.transition.active === false,
  null,
  { timeout: 30000 }
);
await page.waitForTimeout(2000);
const r = await page.evaluate(() => {
  const host = window.__ATLAS_APP__.host;
  host.frame(1 / 60);
  const c = document.getElementById('scene');
  const sc = document.createElement('canvas');
  sc.width = c.width;
  sc.height = c.height;
  const ctx = sc.getContext('2d');
  ctx.drawImage(c, 0, 0);
  const pts = [];
  const W = c.width;
  const H = c.height;
  for (let gy = 0; gy < 6; gy++) {
    const row = [];
    for (let gx = 0; gx < 10; gx++) {
      const d = ctx.getImageData(Math.floor(((gx + 0.5) / 10) * W), Math.floor(((gy + 0.5) / 6) * H), 1, 1).data;
      row.push(d[0] + ',' + d[1] + ',' + d[2]);
    }
    pts.push(row.join(' '));
  }
  const cam = host.camera;
  return {
    pts,
    snap: host.activeDestinationDebugSnapshot(),
    cam: [cam.position.x.toFixed(1), cam.position.y.toFixed(1), cam.position.z.toFixed(1)]
  };
});
console.log(JSON.stringify({ pts: r.pts, cam: r.cam, phase: r.snap.phase, star: r.snap.starDistanceUnits, gain: r.snap.starGain, stretch: r.snap.starStretch, tier: r.snap.tier }, null, 1));
await browser.close();
await server.close();
process.exit(0);
