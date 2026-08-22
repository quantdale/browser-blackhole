/**
 * Atlas UI component kit — framework-free DOM factories for the product
 * control panel (M5 productization, campaign §6/§8/§14).
 *
 * Spec sources:
 * - docs/UI_UX.md §3 (panel structure), §5 (parameter safety: bounded
 *   validated inputs; controls never touch uniforms directly — consumers wire
 *   callbacks into canonical state setters).
 * - docs/cosmic-atlas/PRODUCT_UX_AND_TRANSITIONS.md §13 (persistent elements:
 *   destination selector, quality access, About/Fidelity, reset, accessibility).
 *
 * Layer discipline: this module imports NOTHING from src/atlas or
 * src/renderer. It is a pure DOM layer; the app shell (src/app/atlasApp.ts)
 * owns all host wiring. Every element is built with createElement/textContent
 * — no dynamic HTML parsing (Gate G injection policy). All interactive rows
 * keep visible labels/units, native keyboard operability, aria semantics and
 * >= 40 px touch targets (styles in ./atlasPanel.css).
 */

import { clamp01, decimalsFromStep, finiteClamp } from './util.js';

// ---------------------------------------------------------------------------
// Unique-id plumbing (label[for] / aria-controls wiring)
// ---------------------------------------------------------------------------

let uniqueIdCounter = 0;

/** Stable per-session id for DOM pairing; never derived from user data. */
export function nextDomId(prefix: string): string {
  uniqueIdCounter += 1;
  return `${prefix}-u${uniqueIdCounter}`;
}

// ---------------------------------------------------------------------------
// a) Collapsible section
// ---------------------------------------------------------------------------

export interface CollapsibleSectionOptions {
  title: string;
  open?: boolean;
}

export interface CollapsibleSectionHandle {
  root: HTMLElement;
  body: HTMLDivElement;
  setOpen(open: boolean): void;
}

/**
 * Collapsible panel section backed by a real <button> (native keyboard
 * operability) with aria-expanded/aria-controls and a labelled region.
 */
export function createCollapsibleSection(
  options: CollapsibleSectionOptions
): CollapsibleSectionHandle {
  const root = document.createElement('section');
  root.className = 'atlas-section';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'atlas-section-toggle';

  const titleSpan = document.createElement('span');
  titleSpan.className = 'atlas-section-title';
  titleSpan.textContent = options.title;

  const indicator = document.createElement('span');
  indicator.className = 'atlas-section-chevron';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.textContent = '▸';

  const body = document.createElement('div');
  const bodyId = nextDomId('atlas-section-body');
  body.id = bodyId;
  body.className = 'atlas-section-body';
  body.setAttribute('role', 'region');
  body.setAttribute('aria-labelledby', bodyId);
  // The button itself carries the accessible name; the region is labelled by
  // it through the shared id below.
  toggle.setAttribute('aria-controls', bodyId);

  toggle.append(titleSpan, indicator);
  root.append(toggle, body);

  const setOpen = (open: boolean): void => {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    indicator.classList.toggle('atlas-section-chevron--open', open);
    if (open) body.removeAttribute('hidden');
    else body.setAttribute('hidden', '');
    root.classList.toggle('atlas-section--open', open);
  };
  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });
  setOpen(options.open === true);

  return { root, body, setOpen };
}

// ---------------------------------------------------------------------------
// b) Slider row
// ---------------------------------------------------------------------------

export interface SliderRowOptions {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit?: string;
  /** Receives finite, clamped numbers only. */
  onInput(value: number): void;
}

export interface SliderRowHandle {
  root: HTMLElement;
  setValue(value: number): void;
}

/** Bounded numeric input with linked label and live formatted readout. */
export function createSliderRow(options: SliderRowOptions): SliderRowHandle {
  const min = finiteClamp(options.min, -Number.MAX_VALUE, Number.MAX_VALUE);
  const max = Math.max(min, options.max);
  const row = document.createElement('div');
  row.className = 'atlas-row atlas-row--slider';

  const inputId = nextDomId('atlas-slider');
  const label = document.createElement('label');
  label.className = 'atlas-row-label';
  label.htmlFor = inputId;
  label.textContent = options.label;

  const input = document.createElement('input');
  input.type = 'range';
  input.id = inputId;
  input.className = 'atlas-slider';
  input.min = String(min);
  input.max = String(max);
  input.step = String(options.step > 0 ? options.step : 1);

  const readout = document.createElement('span');
  readout.className = 'atlas-slider-value';

  const render = (): void => {
    readout.textContent = formatWithStep(input.valueAsNumber, options.step, options.unit);
  };
  input.addEventListener('input', () => {
    const value = finiteClamp(input.valueAsNumber, min, max);
    if (input.valueAsNumber !== value) input.value = String(value);
    render();
    options.onInput(value);
  });

  const setValue = (value: number): void => {
    input.value = String(finiteClamp(value, min, max));
    render(); // silent: programmatic writes do not fire consumer callbacks
  };
  setValue(options.value);

  row.append(label, input, readout);
  return { root: row, setValue };
}

function formatWithStep(value: number, step: number, unit?: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  const body = safe.toFixed(decimalsFromStep(step));
  return unit && unit.length > 0 ? `${body} ${unit}` : body;
}

// ---------------------------------------------------------------------------
// c) Select row
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectRowOptions {
  label: string;
  options: SelectOption[];
  value: string;
  onChange(value: string): void;
}

export interface SelectRowHandle {
  root: HTMLElement;
  setValue(value: string): void;
}

/** Labeled <select>; onChange fires only with one of the declared values. */
export function createSelectRow(options: SelectRowOptions): SelectRowHandle {
  const row = document.createElement('div');
  row.className = 'atlas-row atlas-row--select';

  const selectId = nextDomId('atlas-select');
  const label = document.createElement('label');
  label.className = 'atlas-row-label';
  label.htmlFor = selectId;
  label.textContent = options.label;

  const select = document.createElement('select');
  select.id = selectId;
  select.className = 'atlas-select';
  const allowed = new Set<string>();
  for (const option of options.options) {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    allowed.add(option.value);
    select.append(el);
  }
  select.addEventListener('change', () => {
    options.onChange(select.value);
  });

  const setValue = (value: string): void => {
    if (allowed.has(value)) select.value = value;
  };
  setValue(options.value);

  row.append(label, select);
  return { root: row, setValue };
}

// ---------------------------------------------------------------------------
// d) Toggle row (switch)
// ---------------------------------------------------------------------------

export interface ToggleRowOptions {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}

export interface ToggleRowHandle {
  root: HTMLElement;
  setChecked(checked: boolean): void;
}

/** Switch semantics via <button role="switch" aria-checked>. */
export function createToggleRow(options: ToggleRowOptions): ToggleRowHandle {
  const row = document.createElement('div');
  row.className = 'atlas-row atlas-row--toggle';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'atlas-switch';

  const text = document.createElement('span');
  text.textContent = options.label;
  button.append(text);

  const setChecked = (checked: boolean): void => {
    button.setAttribute('aria-checked', checked ? 'true' : 'false');
    button.classList.toggle('atlas-switch--on', checked);
  };
  button.addEventListener('click', () => {
    const next = button.getAttribute('aria-checked') !== 'true';
    setChecked(next); // visual first so rapid clicks stay coherent
    options.onChange(next);
  });
  setChecked(options.checked);

  row.append(button);
  return { root: row, setChecked };
}

// ---------------------------------------------------------------------------
// e) Button row
// ---------------------------------------------------------------------------

export interface ButtonAction {
  text: string;
  onClick(): void;
  primary?: boolean;
}

/** Horizontal group of action buttons; `primary` marks the emphasized one. */
export function createButtonRow(actions: ButtonAction[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-row atlas-row--buttons';
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = action.primary === true ? 'atlas-btn atlas-btn--primary' : 'atlas-btn';
    button.textContent = action.text;
    button.addEventListener('click', action.onClick);
    row.append(button);
  }
  return row;
}

// ---------------------------------------------------------------------------
// f) Readout list (debug telemetry)
// ---------------------------------------------------------------------------

export interface ReadoutEntry {
  label: string;
  value: string;
}

export interface ReadoutListHandle {
  root: HTMLDListElement;
  /** Replace the full entry set (stale keys removed). */
  set(entries: ReadoutEntry[]): void;
  /** Create-or-update a single entry by label. */
  setEntry(label: string, value: string): void;
}

/** Definition list for debug telemetry; labels stay aligned and selectable. */
export function createReadoutList(): ReadoutListHandle {
  const root = document.createElement('dl');
  root.className = 'atlas-readouts';
  const pairs = new Map<string, { dt: HTMLElement; dd: HTMLElement }>();

  const ensurePair = (label: string): { dt: HTMLElement; dd: HTMLElement } => {
    const existing = pairs.get(label);
    if (existing) return existing;
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.className = 'atlas-readouts-value';
    root.append(dt, dd);
    const pair = { dt, dd };
    pairs.set(label, pair);
    return pair;
  };

  return {
    root,
    set(entries) {
      const seen = new Set<string>();
      for (const entry of entries) {
        seen.add(entry.label);
        ensurePair(entry.label).dd.textContent = entry.value;
      }
      for (const [label, pair] of pairs) {
        if (!seen.has(label)) {
          pair.dt.remove();
          pair.dd.remove();
          pairs.delete(label);
        }
      }
    },
    setEntry(label, value) {
      ensurePair(label).dd.textContent = value;
    }
  };
}

// ---------------------------------------------------------------------------
// g) Timeline transport
// ---------------------------------------------------------------------------

export interface TimelineTransportOptions {
  onPlay(playing: boolean): void;
  onReset(): void;
  /** Fires with finite phase01 in [0, 1] while the user scrubs. */
  onScrub(phase01: number): void;
  /** Fires with the parsed rate value of the selected option. */
  onRate(rate: number): void;
}

export interface TimelineTransportHandle {
  root: HTMLElement;
  setPlaying(playing: boolean): void;
  setPhase01(phase01: number): void;
  /** Selects the rate option whose label matches (e.g. '2x'); no-op if absent. */
  setRateLabel(label: string): void;
}

const RATE_OPTIONS: ReadonlyArray<{ label: string; rate: number }> = [
  { label: '0.25x', rate: 0.25 },
  { label: '0.5x', rate: 0.5 },
  { label: '1x', rate: 1 },
  { label: '2x', rate: 2 },
  { label: '4x', rate: 4 }
];

/** Play/pause + reset + scrub + playback-rate transport row. */
export function createTimelineTransport(
  options: TimelineTransportOptions
): TimelineTransportHandle {
  const root = document.createElement('div');
  root.className = 'atlas-timeline';

  const playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'atlas-btn atlas-timeline-play';
  playButton.setAttribute('aria-pressed', 'false');
  playButton.textContent = 'Play';
  playButton.addEventListener('click', () => {
    const playing = playButton.getAttribute('aria-pressed') !== 'true';
    setPlaying(playing);
    options.onPlay(playing);
  });
  const setPlaying = (playing: boolean): void => {
    playButton.setAttribute('aria-pressed', playing ? 'true' : 'false');
    playButton.textContent = playing ? 'Pause' : 'Play';
  };

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'atlas-btn';
  resetButton.textContent = 'Reset';
  resetButton.addEventListener('click', options.onReset);

  const scrubber = document.createElement('input');
  scrubber.type = 'range';
  scrubber.className = 'atlas-scrubber';
  scrubber.min = '0';
  scrubber.max = '1';
  scrubber.step = '0.001';
  scrubber.setAttribute('aria-label', 'Timeline position');
  scrubber.addEventListener('input', () => {
    options.onScrub(clamp01(scrubber.valueAsNumber));
  });
  const setPhase01 = (phase01: number): void => {
    scrubber.value = String(clamp01(phase01)); // silent update
  };

  const rateSelect = document.createElement('select');
  rateSelect.className = 'atlas-select atlas-timeline-rate';
  rateSelect.setAttribute('aria-label', 'Playback speed');
  const ratesByLabel = new Map<string, number>();
  for (const option of RATE_OPTIONS) {
    const el = document.createElement('option');
    el.value = String(option.rate);
    el.textContent = option.label;
    ratesByLabel.set(option.label, option.rate);
    rateSelect.append(el);
  }
  rateSelect.addEventListener('change', () => {
    const rate = Number.parseFloat(rateSelect.value);
    if (Number.isFinite(rate)) options.onRate(rate);
  });

  root.append(playButton, resetButton, scrubber, rateSelect);
  return {
    root,
    setPlaying,
    setPhase01,
    setRateLabel(label) {
      const rate = ratesByLabel.get(label);
      if (rate !== undefined) rateSelect.value = String(rate);
    }
  };
}

// ---------------------------------------------------------------------------
// h) Mode switch (segmented radio group)
// ---------------------------------------------------------------------------

export interface ModeSwitchOption {
  id: string;
  label: string;
}

export interface ModeSwitchOptions {
  modes: ModeSwitchOption[];
  value: string;
  onChange(modeId: string): void;
}

export interface ModeSwitchHandle {
  root: HTMLElement;
  setValue(modeId: string): void;
}

/**
 * Experience-mode segmented control built from real radio inputs (arrow-key
 * navigation comes free). The legend is visually hidden but exposed to AT.
 */
export function createModeSwitch(options: ModeSwitchOptions): ModeSwitchHandle {
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'atlas-mode-switch';
  fieldset.setAttribute('role', 'radiogroup');

  const legend = document.createElement('legend');
  legend.className = 'visually-hidden';
  legend.textContent = 'Experience mode';
  fieldset.append(legend);

  const groupName = nextDomId('atlas-mode');
  const radios = new Map<string, HTMLInputElement>();
  for (const mode of options.modes) {
    const label = document.createElement('label');
    label.className = 'atlas-mode-option';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = groupName;
    radio.value = mode.id;
    radios.set(mode.id, radio);
    radio.addEventListener('change', () => {
      if (radio.checked) options.onChange(mode.id);
    });
    const text = document.createElement('span');
    text.textContent = mode.label;
    label.append(radio, text);
    fieldset.append(label);
  }

  const setValue = (modeId: string): void => {
    const radio = radios.get(modeId);
    if (radio) radio.checked = true;
  };
  setValue(options.value);

  return { root: fieldset, setValue };
}
