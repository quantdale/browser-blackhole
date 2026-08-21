/**
 * ControlPanel shell (M0): status readouts plus a reset action.
 *
 * The reset button goes through the canonical path only: it loads the
 * diagnostic preset into normalized AppState; the app maps that state to the
 * renderer. No DOM handler touches uniforms directly.
 */

import type { RuntimeStatusSnapshot } from '../app/runtimeStatus.js';

export interface ControlPanelHandle {
  update(snapshot: RuntimeStatusSnapshot): void;
  updateTelemetry(fpsEma: number): void;
  dispose(): void;
}

export interface ControlPanelActions {
  resetView(): void;
}

export function mountControlPanel(
  container: HTMLElement,
  actions: ControlPanelActions
): ControlPanelHandle {
  const title = document.createElement('h2');
  title.className = 'panel-title';
  title.textContent = 'Browser Black Hole';

  const list = document.createElement('ul');
  list.className = 'readout-list';

  const makeRow = (label: string): HTMLSpanElement => {
    const row = document.createElement('li');
    const labelEl = document.createElement('span');
    labelEl.className = 'readout-label';
    labelEl.textContent = label;
    const value = document.createElement('span');
    value.className = 'readout-value';
    value.textContent = '—';
    row.append(labelEl, value);
    list.append(row);
    return value;
  };

  const backendValue = makeRow('Backend');
  const sizeValue = makeRow('Internal size');
  const fpsValue = makeRow('FPS (ema)');

  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.textContent = 'Reset view';
  resetButton.addEventListener('click', actions.resetView);

  container.innerHTML = '';
  container.append(title, list, resetButton);

  return {
    update(snapshot: RuntimeStatusSnapshot): void {
      backendValue.textContent = snapshot.backend === 'pending' ? 'detecting…' : snapshot.backend;
      sizeValue.textContent =
        snapshot.internalWidth !== null && snapshot.internalHeight !== null
          ? `${snapshot.internalWidth} × ${snapshot.internalHeight}`
          : '—';
    },
    updateTelemetry(fpsEma: number): void {
      fpsValue.textContent = `${fpsEma.toFixed(0)}`;
    },
    dispose(): void {
      container.innerHTML = '';
    }
  };
}
