/**
 * StatusPanel (M0-09): visible initialization/ready/fallback/unsupported/
 * failed UX. Never a blank canvas: every terminal state renders a message
 * with severity styling and, where useful, one remediation step. Technical
 * details are exposed only in development mode via an expandable element.
 */

import type { RuntimeStatusSnapshot, StatusStore } from '../app/runtimeStatus.js';

export interface StatusPanelHandle {
  unsubscribe(): void;
}

function backendLabel(snapshot: RuntimeStatusSnapshot): string {
  switch (snapshot.backend) {
    case 'webgpu':
      return 'WebGPU';
    case 'webgl2':
      return 'WebGL2 (fallback)';
    case 'unsupported':
      return 'none';
    default:
      return 'detecting…';
  }
}

function headlineFor(snapshot: RuntimeStatusSnapshot): string {
  switch (snapshot.phase) {
    case 'boot':
    case 'capability-check':
      return 'Checking graphics capabilities…';
    case 'initializing':
      return 'Initializing WebGPU renderer…';
    case 'fallback-initializing':
      return 'WebGPU unavailable — initializing WebGL2 fallback…';
    case 'ready':
      return snapshot.backend === 'webgpu'
        ? 'Ready — rendering with WebGPU'
        : 'Ready — rendering with WebGL2 fallback';
    case 'unsupported':
      return 'This browser cannot run the renderer';
    case 'failed':
      return 'Renderer initialization failed';
  }
}

function detailFor(snapshot: RuntimeStatusSnapshot): string {
  switch (snapshot.phase) {
    case 'unsupported':
      return (
        'No WebGPU adapter and no WebGL2 context are available. ' +
        'Try a current version of Chrome, Edge, or Firefox with hardware acceleration enabled.'
      );
    case 'failed':
      return snapshot.errorCode
        ? `The renderer could not start (${snapshot.errorCode}). Reloading the page may help.`
        : 'The renderer could not start. Reloading the page may help.';
    case 'fallback-initializing':
      return 'The diagnostic frame will render through the WebGL2 fallback backend.';
    case 'ready':
      return `Active backend: ${backendLabel(snapshot)}.`;
    default:
      return '';
  }
}

export function mountStatusPanel(container: HTMLElement, store: StatusStore): StatusPanelHandle {
  container.innerHTML = '';

  const region = document.createElement('section');
  region.className = 'status-region';
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', 'polite');

  const headline = document.createElement('p');
  headline.className = 'status-headline';

  const detail = document.createElement('p');
  detail.className = 'status-detail';

  const technical = document.createElement('details');
  technical.className = 'status-technical';
  const summary = document.createElement('summary');
  summary.textContent = 'Technical details';
  const pre = document.createElement('pre');
  technical.append(summary, pre);

  region.append(headline, detail);
  container.append(region);

  const render = (snapshot: RuntimeStatusSnapshot): void => {
    region.dataset['severity'] = snapshot.severity;
    headline.textContent = headlineFor(snapshot);
    detail.textContent = detailFor(snapshot);
    if (import.meta.env.DEV) {
      pre.textContent = JSON.stringify(
        {
          phase: snapshot.phase,
          backend: snapshot.backend,
          errorCode: snapshot.errorCode,
          webgpuAvailable: snapshot.webgpuAvailable,
          webgl2Available: snapshot.webgl2Available,
          internalSize:
            snapshot.internalWidth !== null && snapshot.internalHeight !== null
              ? `${snapshot.internalWidth}x${snapshot.internalHeight}`
              : null,
          revision: snapshot.revision
        },
        null,
        2
      );
      region.append(technical);
    }
  };

  return { unsubscribe: store.subscribe(render) };
}
