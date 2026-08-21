/**
 * Application orchestrator (M0): wires capability probe -> renderer init ->
 * camera/resize/loop -> status UX -> canonical state flow.
 *
 * State flow is one-way: UI/preset -> normalizeAppState -> AppState ->
 * renderer mapping. No DOM handler writes uniforms directly.
 */

import { CameraController, type ObserverCameraInput } from '../camera/CameraController.js';
import { BlackHoleRenderer } from '../renderer/BlackHoleRenderer.js';
import { RenderCoordinator, type FrameTelemetrySample } from '../renderer/RenderCoordinator.js';
import { ResizeController } from '../renderer/ResizeController.js';
import { computeInternalRenderSize, type ViewportSize } from '../renderer/renderSize.js';
import { decideBackend, snapshotCapabilities } from './capability.js';
import { DIAGNOSTIC_PRESET, findPreset, loadPreset } from './presets.js';
import { ERROR_CODES, StatusStore } from './runtimeStatus.js';
import { classifyStateChange, type AppState, type Invalidation } from './state.js';
import {
  installTestHooks,
  removeTestHooks,
  type BlackHoleTestHooks,
  type PixelSample
} from './testHooks.js';
import { mountStatusPanel, type StatusPanelHandle } from '../ui/statusPanel.js';
import { mountControlPanel, type ControlPanelHandle } from '../ui/controlPanel.js';

export interface AppHandle {
  dispose(): void;
}

function observerCameraInput(state: AppState): ObserverCameraInput {
  return {
    positionRg: state.observer.positionRg,
    targetRg: state.observer.targetRg,
    up: state.observer.up,
    fovYDeg: state.observer.fovYDeg
  };
}

export async function createApp(root: HTMLElement): Promise<AppHandle> {
  const canvas = root.querySelector<HTMLCanvasElement>('#scene');
  const viewport = root.querySelector<HTMLElement>('#viewport');
  const panelHost = root.querySelector<HTMLElement>('#panel');
  if (!canvas || !viewport || !panelHost) {
    throw new Error('required DOM skeleton (#scene, #viewport, #panel) not found');
  }

  const statusStore = new StatusStore();

  // --- UI hosts -----------------------------------------------------------
  const statusHost = document.createElement('div');
  const controlHost = document.createElement('div');
  panelHost.append(statusHost, controlHost);
  const statusPanel: StatusPanelHandle = mountStatusPanel(statusHost, statusStore);

  // --- uncaught error capture (test evidence; smoke asserts zero) ---------
  const uncaughtErrors: string[] = [];
  const onError = (ev: ErrorEvent): void => {
    uncaughtErrors.push(`error: ${ev.message}`);
  };
  const onRejection = (ev: PromiseRejectionEvent): void => {
    uncaughtErrors.push(`unhandledrejection: ${String(ev.reason)}`);
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  // --- canonical state ----------------------------------------------------
  const initialResult = loadPreset(DIAGNOSTIC_PRESET);
  if (!initialResult.ok) {
    // A failing default preset is an implementation bug; fail loudly.
    throw new Error(`default preset failed validation: ${initialResult.reason}`);
  }
  let state: AppState = initialResult.state;
  let revision = 0;

  statusStore.patch({ phase: 'capability-check' });

  // --- capability probe and backend decision ------------------------------
  const capabilities = await snapshotCapabilities();
  statusStore.applyCapabilities(capabilities);
  const decision = decideBackend(capabilities);

  if (decision === 'unsupported') {
    statusStore.patch({
      phase: 'unsupported',
      errorCode: `${ERROR_CODES.ENV_WEBGPU_UNAVAILABLE}+${ERROR_CODES.ENV_WEBGL2_UNAVAILABLE}`
    });
    return buildTerminalHandles();
  }

  statusStore.patch({
    phase: decision === 'webgpu' ? 'initializing' : 'fallback-initializing'
  });

  // --- renderer init ------------------------------------------------------
  const renderer = new BlackHoleRenderer(canvas);
  try {
    const initResult = await renderer.init(decision);
    statusStore.patch({ backend: initResult.backend });
  } catch (err) {
    // Heuristic classification: three.js init failures do not expose a typed
    // cause, so adapter-related messages map to GPU_ADAPTER_FAILED.
    const message = String(err);
    const code = /adapter/i.test(message)
      ? ERROR_CODES.GPU_ADAPTER_FAILED
      : ERROR_CODES.GPU_PIPELINE_FAILED;
    statusStore.patch({ phase: 'failed', errorCode: code });
    return buildTerminalHandles();
  }

  // --- camera / resize / loop --------------------------------------------
  const camera = new CameraController(canvas, observerCameraInput(state));
  let lastViewport: ViewportSize | null = null;

  const applyResize = (): void => {
    if (!lastViewport || renderer.isDisposed) return;
    const size = computeInternalRenderSize(lastViewport, {
      renderScale: state.rendering.renderScale,
      maxEffectiveDpr: state.rendering.maxEffectiveDpr
    });
    if (!size) return;
    camera.setAspect(size.cssWidth / size.cssHeight);
    renderer.applyViewport(size);
    statusStore.setInternalSize(size.width, size.height);
  };

  const resizeController = new ResizeController(viewport, (vp) => {
    lastViewport = vp;
    applyResize();
  });
  resizeController.observe();

  let telemetryThrottle = 0;
  const controlPanel: ControlPanelHandle = mountControlPanel(controlHost, {
    resetView(): void {
      applyStateFromPreset(DIAGNOSTIC_PRESET.id);
    }
  });
  // Backend/internal-size readouts follow the status store; FPS comes from
  // frame telemetry below.
  const unsubscribeControlReadouts = statusStore.subscribe((snapshot) => {
    controlPanel.update(snapshot);
  });

  const coordinator = new RenderCoordinator({
    renderer,
    camera,
    onTelemetry(sample: FrameTelemetrySample): void {
      telemetryThrottle = (telemetryThrottle + 1) % 10;
      if (telemetryThrottle === 0) controlPanel.updateTelemetry(sample.fpsEma);
    }
  });
  coordinator.start();
  statusStore.patch({ phase: 'ready' });

  // --- canonical state application ----------------------------------------
  function applyState(next: AppState): Invalidation {
    const invalidation = classifyStateChange(state, next);
    state = next;
    revision += 1;
    statusStore.setRevision(revision);
    camera.applyObserverState(observerCameraInput(next));
    // M0 renderer mapping only consumes camera/resolution inputs, so any
    // accepted change recomputes the viewport policy (idempotent). Later
    // milestones map the invalidation mask to targeted uniform/history work.
    applyResize();
    return invalidation;
  }

  function applyStateFromPreset(id: string): boolean {
    const preset = findPreset(id);
    if (!preset) return false;
    const result = loadPreset(preset);
    if (!result.ok) return false;
    applyState(result.state);
    return true;
  }

  // --- test hooks ----------------------------------------------------------
  const captureProbe = (): PixelSample[] | null => {
    if (renderer.isDisposed) return null;
    coordinator.renderOnce();
    const cw = canvas.width;
    const ch = canvas.height;
    if (cw <= 0 || ch <= 0) return null;
    const scratch = document.createElement('canvas');
    scratch.width = cw;
    scratch.height = ch;
    const ctx = scratch.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0);
    const samples: PixelSample[] = [];
    for (let gy = 0; gy < 5; gy += 1) {
      for (let gx = 0; gx < 5; gx += 1) {
        const x = Math.floor(((gx + 0.5) / 5) * cw);
        const y = Math.floor(((gy + 0.5) / 5) * ch);
        const d = ctx.getImageData(x, y, 1, 1).data;
        samples.push({ x, y, r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: d[3] ?? 0 });
      }
    }
    return samples;
  };

  const hooks: BlackHoleTestHooks = {
    getRuntimeStatus: () => statusStore.get(),
    getState: () => state,
    loadPreset: (id) => applyStateFromPreset(id),
    renderOnce: () => coordinator.renderOnce(),
    captureProbe,
    getUncaughtErrors: () => [...uncaughtErrors]
  };
  installTestHooks(hooks);

  function buildTerminalHandles(): AppHandle {
    return {
      dispose(): void {
        statusPanel.unsubscribe();
        window.removeEventListener('error', onError);
        window.removeEventListener('unhandledrejection', onRejection);
        removeTestHooks();
        statusHost.innerHTML = '';
        controlHost.innerHTML = '';
      }
    };
  }

  return {
    dispose(): void {
      coordinator.dispose();
      resizeController.disconnect();
      camera.dispose();
      renderer.dispose();
      unsubscribeControlReadouts();
      controlPanel.dispose();
      statusPanel.unsubscribe();
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      removeTestHooks();
      statusHost.innerHTML = '';
      controlHost.innerHTML = '';
    }
  };
}
