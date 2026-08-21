/**
 * RenderCoordinator (M0-02/M0-06): owns the single frame loop.
 *
 * Guarantees at most one animation loop per active generation
 * (docs/FAILURE_RECOVERY.md section 12): `start` refuses to double-start and
 * `stop`/`dispose` clear the loop. The loop advances camera damping, exports
 * the canonical basis, and renders the diagnostic pass. rAF-based loops pause
 * automatically on hidden tabs, so no duplicate frames accumulate on resume.
 */

import type { BlackHoleRenderer } from './BlackHoleRenderer.js';
import type { CameraController } from '../camera/CameraController.js';
import type { DebugViewMode } from '../app/state.js';

export interface FrameTelemetrySample {
  frame: number;
  cpuFrameMs: number;
  fpsEma: number;
  cameraMoving: boolean;
}

export interface RenderCoordinatorOptions {
  renderer: BlackHoleRenderer;
  camera: CameraController;
  onTelemetry?: (sample: FrameTelemetrySample) => void;
  /**
   * Optional debug-view selector consulted each frame (M1-05); when absent
   * the coordinator renders the default diagnostic view.
   */
  getViewMode?: () => DebugViewMode;
}

export class RenderCoordinator {
  private running = false;
  private disposed = false;
  private frame = 0;
  private lastTimeMs = 0;
  private fpsEma = 0;

  constructor(private readonly options: RenderCoordinatorOptions) {}

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.lastTimeMs = performance.now();
    this.options.renderer.startLoop(this.tick);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.options.renderer.stopLoop();
  }

  /** Renders exactly one frame; also used by deterministic test hooks. */
  renderOnce(): void {
    const now = performance.now();
    this.tick(now);
  }

  private tick = (timeMs: number): void => {
    if (!this.running || this.disposed) return;
    const cpuFrameMs = this.lastTimeMs > 0 ? timeMs - this.lastTimeMs : 16.7;
    this.lastTimeMs = timeMs;

    const moved = this.options.camera.update(cpuFrameMs / 1000);
    const basis = this.options.camera.getBasis();
    this.options.renderer.renderFrame(
      this.options.camera.camera,
      basis,
      this.options.getViewMode?.() ?? 'diagnostic'
    );

    this.frame += 1;
    const instantFps = cpuFrameMs > 0 ? 1000 / cpuFrameMs : 0;
    this.fpsEma = this.frame <= 1 ? instantFps : this.fpsEma * 0.9 + instantFps * 0.1;
    this.options.onTelemetry?.({
      frame: this.frame,
      cpuFrameMs,
      fpsEma: this.fpsEma,
      cameraMoving: moved
    });
  };

  dispose(): void {
    this.stop();
    this.disposed = true;
  }
}
