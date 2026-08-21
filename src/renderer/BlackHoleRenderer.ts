/**
 * BlackHoleRenderer (M0-03): owns the Three.js WebGPURenderer lifecycle, the
 * diagnostic pass, canvas sizing, and disposal (docs/ARCHITECTURE.md section 5).
 *
 * Backend policy:
 *  - decision 'webgpu'  -> WebGPURenderer default path; three.js falls back to
 *    its WebGL2 backend automatically if adapter acquisition fails at init.
 *  - decision 'webgl2'  -> WebGPURenderer with forceWebGL (deterministic
 *    fallback when navigator.gpu is absent).
 *  - decision 'unsupported' -> the renderer is never constructed; the app
 *    shows the terminal unsupported UX instead.
 * The ACTUAL backend is read back from `renderer.backend` after init and must
 * be reported truthfully to status/UI/tests.
 */

import { PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import type { RenderBackend } from '../app/capability.js';
import { applyBasisToDiagnosticUniforms, applyViewModeToDiagnosticUniforms, createDiagnosticPass } from '../shaders/diagnostic.js';
import type { DiagnosticPass } from '../shaders/diagnostic.js';
import type { DebugViewMode } from '../app/state.js';
import type { CameraBasis } from '../camera/CameraController.js';
import type { InternalRenderSize } from './renderSize.js';

export type ActualBackend = Exclude<RenderBackend, 'unsupported'>;

export interface RendererInitResult {
  backend: ActualBackend;
}

export class BlackHoleRenderer {
  private renderer: WebGPURenderer | null = null;
  private pass: DiagnosticPass | null = null;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Initializes the renderer and the diagnostic pass. Throws on failure. */
  async init(decision: RenderBackend): Promise<RendererInitResult> {
    const renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      ...(decision === 'webgl2' ? { forceWebGL: true } : {})
    });
    await renderer.init();

    // Read back the ACTUAL backend; never assume the decision held.
    const backend: unknown = renderer.backend;
    let actual: ActualBackend = 'webgl2';
    if (
      typeof backend === 'object' &&
      backend !== null &&
      'isWebGPUBackend' in backend &&
      backend.isWebGPUBackend === true
    ) {
      actual = 'webgpu';
    }

    this.pass = createDiagnosticPass();
    this.renderer = renderer;
    return { backend: actual };
  }

  /** Applies a computed internal render size (CSS size + effective DPR). */
  applyViewport(size: InternalRenderSize): void {
    if (!this.renderer || this.disposed) return;
    this.renderer.setPixelRatio(size.effectiveDpr);
    this.renderer.setSize(size.cssWidth, size.cssHeight, false);
  }

  /** Installs exactly one animation-loop callback (pass-through for the coordinator). */
  startLoop(tick: (timeMs: number) => void): void {
    if (!this.renderer || this.disposed) return;
    this.renderer.setAnimationLoop(tick);
  }

  stopLoop(): void {
    if (!this.renderer || this.disposed) return;
    this.renderer.setAnimationLoop(null);
  }

  /** Renders one frame of the diagnostic pass with the given camera basis. */
  renderFrame(camera: PerspectiveCamera, basis: CameraBasis, viewMode: DebugViewMode = 'diagnostic'): void {
    if (!this.renderer || !this.pass || this.disposed) return;
    applyBasisToDiagnosticUniforms(this.pass, basis);
    applyViewModeToDiagnosticUniforms(this.pass, viewMode);
    this.renderer.render(this.pass.scene, camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.setAnimationLoop(null);
    this.pass?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.pass = null;
  }
}
