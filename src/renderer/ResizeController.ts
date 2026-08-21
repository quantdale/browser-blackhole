/**
 * ResizeController (M0-06): ResizeObserver-based container sizing with a
 * positive-size guard. Zero-sized containers are skipped; the observer fires
 * again automatically once the container regains size, which is the recovery
 * path (docs/FAILURE_RECOVERY.md section 14). A window resize listener covers
 * DPR/zoom changes that do not change CSS layout.
 */

import type { ViewportSize } from './renderSize.js';

export class ResizeController {
  private observer: ResizeObserver | null = null;
  private readonly onWindowResize = (): void => this.emit();

  constructor(
    private readonly container: HTMLElement,
    private readonly onResize: (size: ViewportSize) => void
  ) {}

  /** Starts observing; emits the current size if it is positive. */
  observe(): void {
    if (this.observer) return;
    this.observer = new ResizeObserver(() => this.emit());
    this.observer.observe(this.container);
    window.addEventListener('resize', this.onWindowResize);
    this.emit();
  }

  private emit(): void {
    const cssWidth = this.container.clientWidth;
    const cssHeight = this.container.clientHeight;
    // Positive-size guard: defer until the container has real dimensions.
    if (cssWidth <= 0 || cssHeight <= 0) return;
    this.onResize({ cssWidth, cssHeight, devicePixelRatio: window.devicePixelRatio });
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = null;
    window.removeEventListener('resize', this.onWindowResize);
  }
}
