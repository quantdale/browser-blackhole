/**
 * Kerr magenta-band diagnostic harness.
 *
 * Answers ONE question with pixel evidence: are the magenta pixels in the
 * physical render the same pixels the shader classifies as numerical failures,
 * and which failure subtype are they?
 *
 * Method
 * - Two renders of the same frozen scene: the physical view (no debug) and the
 *   `?kerrstatus` classification view (uDebugMode = 2). Camera/tier/scale/
 *   exposure/tone-map/bloom are pinned identically, so pixel (x, y) is the same
 *   ray in both frames.
 * - Pixels are read at the INTERNAL drawing-buffer resolution (drawImage of the
 *   canvas onto a scratch canvas sized canvas.width x canvas.height), so CSS
 *   upscale blending cannot contaminate class boundaries.
 * - All classification and the cross-view contingency happen in Node on raw
 *   RGBA, so the two passes are genuinely registered (not classified twice
 *   inside one frame).
 *
 * Usage:
 *   node scripts/diag-kerr-band.mjs --out=<dir> [--backend=webgpu|webgl2]
 *        [--tier=medium|high] [--scale=1] [--preset=...] [--bloom=0|1]
 *        [--exposure=1] [--tonemap=linear|aces-filmic] [--label=baseline]
 *        [--port=4302] [--channel=brave] [--warmup=9000]
 */
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import { chromium } from '@playwright/test';
import { preview } from 'vite';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? fallback : hit.slice(name.length + 3);
}

const outDir = resolve(String(arg('out', '')));
if (arg('out', '') === '') {
  console.error('[diag-kerr-band] --out=<dir> is required');
  process.exit(2);
}
const backend = String(arg('backend', 'webgpu'));
const tier = String(arg('tier', 'medium'));
const scale = Number(arg('scale', 1));
const preset = String(arg('preset', 'kerr-high-prograde'));
const bloom = Number(arg('bloom', 0));
const exposure = Number(arg('exposure', 1));
const toneMapping = String(arg('tonemap', 'linear'));
const label = String(arg('label', 'baseline'));
const port = Number(arg('port', 4302));
const channel = String(arg('channel', 'brave'));
const warmupMs = Number(arg('warmup', 9000));

mkdirSync(outDir, { recursive: true });

const BRAVE_PATH = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
let launchOptions;
if (channel === 'brave') launchOptions = { executablePath: BRAVE_PATH, headless: true };
else if (channel === 'chromium') launchOptions = {};
else launchOptions = { channel };

const commit = (() => {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'uncommitted';
  }
})();

console.log('[diag-kerr-band] building e2e bundle...');
try {
  execSync('npm run build:e2e', { stdio: 'inherit' });
} catch (error) {
  console.error(`[diag-kerr-band] build:e2e failed: ${String(error)}`);
  process.exit(1);
}

const server = await preview({ preview: { port, host: '127.0.0.1' } });
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error' && !/powerPreference|readback|Failed to load resource/.test(m.text()))
    errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`PAGE_ERROR: ${e.message}`));

async function waitForArrival() {
  await page.locator('#scene').waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForFunction(() => window.__ATLAS_APP__ !== undefined, { timeout: 30_000 });
  await page.waitForFunction(
    () => window.__ATLAS_APP__.host.state.atlas.transition.active === false,
    { timeout: 120_000 }
  );
  await page.waitForFunction(
    () => window.__ATLAS_APP__.host.activeDestinationDebugSnapshot() !== null,
    { timeout: 120_000 }
  );
}

/** Pin the deterministic capture state, identical for both views. */
async function pinState() {
  return page.evaluate(
    ([tierName, scaleValue, bloomOn, exposureValue, toneMappingValue]) => {
      const host = window.__ATLAS_APP__.host;
      host.governor.setForcedTier(tierName);
      host.setRenderScaleOverride(scaleValue);
      host.time.pause();
      host.time.scrubTo(0.5);
      host.post.setBloom(bloomOn > 0.5, bloomOn > 0.5 ? 0.6 : 0);
      host.post.setExposure(exposureValue);
      host.post.setToneMapping(toneMappingValue);
      const rect = document.getElementById('viewport')?.getBoundingClientRect();
      if (rect) host.handleResize(rect.width, rect.height);
      window.__ATLAS_APP__.captureFrame();
      const inv = host.debugInventory();
      const canvas = document.querySelector('canvas');
      return {
        tier: inv?.governor?.tier ?? null,
        renderScale: inv?.governor?.renderScale ?? null,
        backend: inv?.backend ?? null,
        cssSize: rect ? [Math.round(rect.width), Math.round(rect.height)] : null,
        internal: canvas ? [canvas.width, canvas.height] : null,
        userAgent: navigator.userAgent,
        snapshot: host.activeDestinationDebugSnapshot()
      };
    },
    [tier, scale, bloom, exposure, toneMapping]
  );
}

/** Read the frame at internal resolution; returns raw RGBA as base64. */
async function readRaw() {
  return page.evaluate(() => {
    const app = window.__ATLAS_APP__;
    // Force a fresh frame: frame invalidation skips rendering when paused.
    app.host.frame(1 / 60, { force: true });
    const canvas = document.querySelector('canvas');
    const w = canvas.width;
    const h = canvas.height;
    const scratch = document.createElement('canvas');
    scratch.width = w;
    scratch.height = h;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    if (ctx === null) throw new Error('2d context unavailable');
    ctx.drawImage(canvas, 0, 0);
    const data = ctx.getImageData(0, 0, w, h).data;
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < data.length; i += chunk) {
      binary += String.fromCharCode.apply(null, data.subarray(i, i + chunk));
    }
    return { width: w, height: h, rgba: btoa(binary) };
  });
}

// --- minimal PNG encoder (RGB, no external deps) ---------------------------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePng(width, height, rgb) {
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

// --- classification (Node side, on raw RGBA) -------------------------------
//
// The status view paints DOCUMENTED linear colors (kerrIntegrator.ts
// statusColor / nonFiniteColor). The shipped display path applies tone mapping
// then a LINEAR -> sRGB encode, so comparing against linear constants directly
// is wrong by construction: linear 0.2 arrives as 124, not 51. An earlier
// hand-tuned threshold (b < 90) therefore filed the entire pole-passage
// population under "unclassified" — the classifier defect this probe found.
// Classification is done by nearest documented color in sRGB-encoded space,
// with an explicit blend bucket for samples the display path has mixed.
const LINEAR_TO_SRGB = (v) => {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
};
const encodeRgb = (lin) => lin.map((v) => Math.round(LINEAR_TO_SRGB(v) * 255));

/** Terminal-class reference colors, in sRGB-encoded 8-bit space. */
const STATUS_REFERENCE = {
  capturedBlack: encodeRgb([0, 0, 0]),
  escapedCyan: encodeRgb([0, 0.7, 1.0]),
  maxStepsOrange: encodeRgb([1.0, 0.45, 0.0]),
  thetaWrapRed: encodeRgb([1.0, 0.05, 0.05]),
  poleYellow: encodeRgb([1.0, 0.9, 0.2]),
  otherMagenta: encodeRgb([1.0, 0.2, 1.0]),
  invalidInitial: encodeRgb([0.35, 0, 0.35])
};
/** Physical-view numerical-failure color: NUMERICAL_FAILURE_RGB linear. */
const PHYSICAL_FAILURE = encodeRgb([0.08, 0, 0.08]);

const STATUS_KEYS = Object.keys(STATUS_REFERENCE);

function nearestStatusClass(r, g, b) {
  let best = 'unclassified';
  let bestDist = Infinity;
  for (const key of STATUS_KEYS) {
    const ref = STATUS_REFERENCE[key];
    const dr = r - ref[0];
    const dg = g - ref[1];
    const db = b - ref[2];
    const d = dr * dr + dg * dg + db * db;
    if (d < bestDist) {
      bestDist = d;
      best = key;
    }
  }
  // > ~12% of full-scale distance from every documented color: the display
  // path has mixed samples (temporal resolve, upscale, or bloom). Counted
  // separately so a blend can never masquerade as a terminal class.
  return { cls: best, dist: Math.sqrt(bestDist) };
}

const BLEND_DISTANCE = 40;

function classify(rgba, width, height, kind) {
  const counts = new Map();
  const inc = (k) => counts.set(k, (counts.get(k) ?? 0) + 1);
  const masks = {
    physicalMagenta: new Uint8Array(width * height),
    statusFailure: new Uint8Array(width * height),
    statusPole: new Uint8Array(width * height),
    statusWrap: new Uint8Array(width * height),
    statusMaxSteps: new Uint8Array(width * height),
    statusOther: new Uint8Array(width * height)
  };
  const rgb = Buffer.alloc(width * height * 3);

  for (let p = 0; p < width * height; p += 1) {
    const r = rgba[p * 4];
    const g = rgba[p * 4 + 1];
    const b = rgba[p * 4 + 2];

    if (kind === 'physical') {
      // Failure magenta is linear (0.08, 0, 0.08) -> sRGB (80, 0, 80). Match
      // the documented color with a tolerance, and count everything else
      // separately rather than relying on a hue heuristic.
      const dr = r - PHYSICAL_FAILURE[0];
      const dg = g - PHYSICAL_FAILURE[1];
      const db = b - PHYSICAL_FAILURE[2];
      const isMagenta = Math.sqrt(dr * dr + dg * dg + db * db) < 56;
      if (isMagenta) {
        inc('magentaPhysical');
        masks.physicalMagenta[p] = 1;
      } else if (r < 24 && g < 24 && b < 24) inc('darkPhysical');
      else inc('otherPhysical');
      rgb[p * 3] = isMagenta ? 0 : r;
      rgb[p * 3 + 1] = isMagenta ? 255 : g;
      rgb[p * 3 + 2] = isMagenta ? 0 : b;
    } else {
      const { cls, dist } = nearestStatusClass(r, g, b);
      const isBlend = dist > BLEND_DISTANCE;
      inc(isBlend ? 'blendUnclassified' : cls);
      if (!isBlend) {
        if (cls === 'poleYellow') {
          masks.statusFailure[p] = 1;
          masks.statusPole[p] = 1;
        } else if (cls === 'thetaWrapRed') {
          masks.statusFailure[p] = 1;
          masks.statusWrap[p] = 1;
        } else if (cls === 'maxStepsOrange') {
          masks.statusFailure[p] = 1;
          masks.statusMaxSteps[p] = 1;
        } else if (cls === 'otherMagenta' || cls === 'invalidInitial') {
          masks.statusFailure[p] = 1;
          masks.statusOther[p] = 1;
        }
      }
      // Paint the diagnostic image: keep source, highlight failures.
      const fail = masks.statusFailure[p] === 1;
      rgb[p * 3] = fail ? 255 : Math.min(255, r);
      rgb[p * 3 + 1] = fail ? 0 : Math.min(255, g);
      rgb[p * 3 + 2] = fail ? 255 : Math.min(255, b);
    }
  }
  return { counts, masks, rgb, width, height };
}

function writeMaskPng(name, mask, width, height, rgbOn) {
  const buf = Buffer.alloc(width * height * 3);
  for (let p = 0; p < mask.length; p += 1) {
    const on = mask[p] === 1;
    buf[p * 3] = on ? rgbOn[0] : 0;
    buf[p * 3 + 1] = on ? rgbOn[1] : 0;
    buf[p * 3 + 2] = on ? rgbOn[2] : 0;
  }
  writeFileSync(join(outDir, name), encodePng(width, height, buf));
}

function toBuffer(result) {
  return Buffer.from(result.rgba, 'base64');
}

// --- Pass 1: physical view -------------------------------------------------
await page.goto(`http://127.0.0.1:${port}/atlas/black-hole?preset=${preset}&backend=${backend}`);
await waitForArrival();
const statePhysical = await pinState();
await page.waitForTimeout(warmupMs);
const rawPhysical = await readRaw();

// --- Pass 2: kerrstatus classification view -------------------------------
await page.goto(
  `http://127.0.0.1:${port}/atlas/black-hole?preset=${preset}&kerrstatus&backend=${backend}`
);
await waitForArrival();
const stateStatus = await pinState();
await page.waitForTimeout(warmupMs);
const rawStatus = await readRaw();

const sameGeometry =
  rawPhysical.width === rawStatus.width && rawPhysical.height === rawStatus.height;

const phys = classify(toBuffer(rawPhysical), rawPhysical.width, rawPhysical.height, 'physical');
const stat = classify(toBuffer(rawStatus), rawStatus.width, rawStatus.height, 'status');

// Registered contingency across the two frames.
let overlap = null;
if (sameGeometry) {
  let both = 0;
  let onlyPhysical = 0;
  let onlyStatus = 0;
  const overlay = Buffer.alloc(rawPhysical.width * rawPhysical.height * 3);
  for (let p = 0; p < phys.masks.physicalMagenta.length; p += 1) {
    const pa = phys.masks.physicalMagenta[p] === 1;
    const pb = stat.masks.statusFailure[p] === 1;
    if (pa && pb) both += 1;
    else if (pa) onlyPhysical += 1;
    else if (pb) onlyStatus += 1;
    overlay[p * 3] = pb ? 255 : 0;
    overlay[p * 3 + 1] = pa ? 255 : 0;
    overlay[p * 3 + 2] = pa && pb ? 255 : 0;
  }
  const union = both + onlyPhysical + onlyStatus;
  writeFileSync(
    join(outDir, 'mask-overlay.png'),
    encodePng(rawPhysical.width, rawPhysical.height, overlay)
  );
  overlap = {
    bothPixels: both,
    onlyPhysicalPixels: onlyPhysical,
    onlyStatusPixels: onlyStatus,
    unionPixels: union,
    iou: union === 0 ? 1 : +(both / union).toFixed(4),
    fractionOfPhysicalMagentaExplainedByFailures:
      onlyPhysical + both === 0 ? null : +((both / (onlyPhysical + both)) * 100).toFixed(3),
    fractionOfFailuresShownMagenta:
      onlyStatus + both === 0 ? null : +((both / (onlyStatus + both)) * 100).toFixed(3)
  };
}

writeFileSync(join(outDir, 'normal.png'), encodePng(phys.width, phys.height, phys.rgb));
writeFileSync(join(outDir, 'status.png'), encodePng(stat.width, stat.height, stat.rgb));
writeMaskPng(
  'mask-physical-magenta.png',
  phys.masks.physicalMagenta,
  phys.width,
  phys.height,
  [0, 255, 0]
);
writeMaskPng(
  'mask-status-failure.png',
  stat.masks.statusFailure,
  stat.width,
  stat.height,
  [255, 0, 255]
);
writeMaskPng(
  'mask-status-pole.png',
  stat.masks.statusPole,
  stat.width,
  stat.height,
  [255, 230, 50]
);
writeMaskPng('mask-status-wrap.png', stat.masks.statusWrap, stat.width, stat.height, [255, 20, 20]);
writeMaskPng(
  'mask-status-maxsteps.png',
  stat.masks.statusMaxSteps,
  stat.width,
  stat.height,
  [255, 120, 0]
);

const total = rawPhysical.width * rawPhysical.height;
const pct = (n) => +((n / total) * 100).toFixed(4);
const get = (map, k) => map.get(k) ?? 0;

const report = {
  label,
  commit,
  backend,
  preset,
  tier,
  scale,
  bloom,
  exposure,
  toneMapping,
  adapter: statePhysical.backend?.adapterName ?? null,
  userAgent: statePhysical.userAgent,
  cssSize: statePhysical.cssSize,
  internalPhysical: [rawPhysical.width, rawPhysical.height],
  internalStatus: [rawStatus.width, rawStatus.height],
  renderScalePhysical: statePhysical.renderScale,
  renderScaleStatus: stateStatus.renderScale,
  sameGeometry,
  physicalSnapshot: statePhysical.snapshot,
  statusSnapshot: stateStatus.snapshot,
  physicalCensus: {
    total,
    magentaPixels: get(phys.counts, 'magentaPhysical'),
    magentaPercent: pct(get(phys.counts, 'magentaPhysical')),
    darkPercent: pct(get(phys.counts, 'darkPhysical')),
    otherPercent: pct(get(phys.counts, 'otherPhysical'))
  },
  statusCensus: {
    total: rawStatus.width * rawStatus.height,
    capturedBlackPercent: pct(get(stat.counts, 'capturedBlack')),
    escapedCyanPercent: pct(get(stat.counts, 'escapedCyan')),
    maxStepsPercent: pct(get(stat.counts, 'maxStepsOrange')),
    thetaWrapPercent: pct(get(stat.counts, 'thetaWrapRed')),
    polePercent: pct(get(stat.counts, 'poleYellow')),
    otherMagentaPercent: pct(get(stat.counts, 'otherMagenta')),
    invalidInitialPercent: pct(get(stat.counts, 'invalidInitial')),
    blendUnclassifiedPercent: pct(get(stat.counts, 'blendUnclassified'))
  },
  overlap,
  consoleErrors: errors
};

writeFileSync(join(outDir, `${label}.json`), JSON.stringify(report, null, 2));
console.log(`[diag-kerr-band] ${JSON.stringify(report, null, 2)}`);

await browser.close();
server.httpServer.close();
process.exit(0);
