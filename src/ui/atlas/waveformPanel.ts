/**
 * CA8-13 — Synchronized waveform panel for the Black-Hole Merger destination.
 *
 * Pure DOM/canvas component (no three.js, no atlas/phenomena imports — same
 * layer discipline as ./components.ts). The APP SHELL owns all wiring: it
 * hands in a structural {@link WaveformSeries} snapshot of the decoded
 * dataset (from the destination's validated cache) and pushes the current
 * internal time at the 4 Hz UI cadence — one draw per UI tick, never per
 * animation frame.
 *
 * Honesty contract: the plot is the reduced SOURCE waveform (h22 Re),
 * with the merger anchor (t=0) and data-derived phase boundaries marked.
 * Axis/caption labels carry units (NR M time relative to peak; r·h/M
 * dimensionless). The accessible readout mirrors the cursor numerically.
 */

export interface WaveformSeries {
  readonly assetId: string;
  readonly timesM: ArrayLike<number>;
  readonly h22Re: ArrayLike<number>;
  readonly h22Im: ArrayLike<number>;
  readonly tStartM: number;
  readonly tEndM: number;
  readonly h22PeakAmplitude: number;
  readonly mergerEndM: number;
  readonly ringdownEndM: number;
}

export interface WaveformPanelHandle {
  root: HTMLElement;
  /** Bind (or clear) the plotted series. Marks the plot dirty. */
  setSeries(series: WaveformSeries | null): void;
  /** Push current internal time into cursor/readout. */
  update(timeM: number): void;
  dispose(): void;
}

const CANVAS_CSS_HEIGHT = 96;
/** Plot resolution cap: one plotted sample per canvas pixel column max. */
const MAX_PLOT_COLUMNS = 512;

export function createWaveformPanel(): WaveformPanelHandle {
  const root = document.createElement('div');
  root.className = 'bbm-waveform';

  const canvas = document.createElement('canvas');
  canvas.className = 'bbm-waveform-canvas';
  canvas.height = CANVAS_CSS_HEIGHT;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Gravitational-wave strain h22 from numerical-relativity data with merger cursor'
  );
  const readout = document.createElement('p');
  readout.className = 'atlas-note bbm-waveform-readout';
  readout.setAttribute('role', 'status');

  const caption = document.createElement('p');
  caption.className = 'atlas-note';
  caption.textContent =
    'h₂₂ strain (r·h/M, dimensionless) vs NR time (units of total mass M), ' +
    'relative to the merger anchor. DATA-DRIVEN: reduced numerical-relativity ' +
    'source samples.';

  root.append(canvas, readout, caption);

  let context2d: CanvasRenderingContext2D | null = null;
  let series: WaveformSeries | null = null;
  let lastTimeM = Number.NaN;

  function indexForTime(t: number): number {
    if (series === null) return 0;
    const times = series.timesM;
    const n = times.length;
    if (t <= (times[0] as number)) return 0;
    if (t >= (times[n - 1] as number)) return n - 1;
    let a = 0;
    let b = n - 1;
    while (b - a > 1) {
      const mid = (a + b) >> 1;
      if ((times[mid] as number) <= t) a = mid;
      else b = mid;
    }
    return a;
  }

  function timeToX(t: number, width: number): number | null {
    if (series === null) return null;
    const span = series.tEndM - series.tStartM;
    if (!(span > 0)) return null;
    const fraction = (t - series.tStartM) / span;
    if (fraction < 0 || fraction > 1) return null;
    return fraction * width;
  }

  function resizeCanvas(): boolean {
    const cssWidth = Math.max(64, Math.floor(canvas.clientWidth || canvas.width || 64));
    if (canvas.width !== cssWidth) {
      canvas.width = cssWidth;
    }
    return canvas.width > 0;
  }

  /** Draw the static waveform + boundary marks + cursor (single cheap pass). */
  function redraw(): void {
    if (context2d === null) {
      context2d = canvas.getContext('2d', { willReadFrequently: false });
    }
    const ctx = context2d;
    if (ctx === null || series === null) return;
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // Boundary gridlines (merger anchor t=0 + phase boundaries).
    ctx.strokeStyle = 'rgba(128,148,180,0.35)';
    ctx.lineWidth = 1;
    for (const mark of [0, series.mergerEndM, series.ringdownEndM]) {
      const x = timeToX(mark, width);
      if (x === null) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Waveform polyline: Re(h22), decimated by column.
    ctx.strokeStyle = '#9fc4ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const columns = Math.min(MAX_PLOT_COLUMNS, width);
    for (let c = 0; c < columns; c += 1) {
      const f = c / Math.max(1, columns - 1);
      const t = series.tStartM + f * (series.tEndM - series.tStartM);
      const value = series.h22Re[indexForTime(t)] ?? 0;
      const x = f * width;
      // Peak amplitude maps to ~45% of half-height.
      const y = height / 2 - (value / series.h22PeakAmplitude) * (height * 0.45);
      if (c === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Zero line.
    ctx.strokeStyle = 'rgba(160,160,160,0.4)';
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    // Cursor.
    if (!Number.isNaN(lastTimeM)) {
      const cx = timeToX(lastTimeM, width);
      if (cx !== null) {
        ctx.strokeStyle = '#ffd479';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, height);
        ctx.stroke();
      }
    }
  }

  function phaseName(timeM: number): string {
    if (series === null) return '';
    if (timeM < 0) return 'inspiral';
    if (timeM < series.mergerEndM) return 'merger';
    if (timeM < series.ringdownEndM) return 'ringdown';
    return 'remnant';
  }

  return {
    root,
    setSeries(next): void {
      series = next;
      lastTimeM = Number.NaN;
      redraw();
    },
    update(timeM: number): void {
      if (series === null) {
        readout.textContent = 'Waveform dataset unavailable.';
        return;
      }
      if (!resizeCanvas()) return;
      // Redraw includes the cursor; a single bounded 2D-canvas pass per UI
      // tick (4 Hz), never per animation frame.
      redraw();
      lastTimeM = timeM;

      const index = indexForTime(timeM);
      const hRe = series.h22Re[index] ?? 0;
      const hIm = series.h22Im[index] ?? 0;
      const amplitude = Math.sqrt(hRe * hRe + hIm * hIm);
      const normalized = amplitude / series.h22PeakAmplitude;
      const sign = timeM < 0 ? '-' : '+';
      readout.textContent =
        `t = ${sign}${Math.abs(timeM).toFixed(1)} M · ` +
        `|h|/|h_peak| = ${normalized.toFixed(3)} · ${phaseName(timeM)}`;
    },
    dispose(): void {
      context2d = null;
      series = null;
      root.replaceChildren();
    }
  };
}
