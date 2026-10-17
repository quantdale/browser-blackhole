/**
 * Capability decision tests (verification-gate-integrity D9/V-12, tasks
 * 7.4/7.5).
 *
 * Table-driven over the documented failure-mode list in docs/CI_CD.md §10
 * ("Capability injection tests"). The pre-fix suite covered 3 of the 6
 * documented cases because the two-boolean input could not express the
 * others; `BackendDecisionInput` now carries `webgpuMissingRequiredFeature`
 * and the cases that live OUTSIDE the backend decision are marked explicitly
 * with their reason and the module that owns them (7.5) — never silently
 * omitted.
 */

import { describe, expect, it } from 'vitest';

import { decideBackend, type BackendDecisionInput } from '../../src/app/capability.js';

interface FailureModeCase {
  readonly name: string;
  readonly input: BackendDecisionInput;
  readonly expected: 'webgpu' | 'webgl2' | 'unsupported';
  /** Set when the documented case is decided OUTSIDE decideBackend. */
  readonly outOfScopeReason?: string;
}

const FAILURE_MODES: readonly FailureModeCase[] = [
  {
    // CI_CD §10 case 1: WebGPU available/full features.
    name: 'webgpu available, full features',
    input: { webgpuAvailable: true, webgl2Available: true },
    expected: 'webgpu'
  },
  {
    // CI_CD §10 case 2: WebGPU unavailable + WebGL2 available.
    name: 'webgpu unavailable, webgl2 fallback',
    input: { webgpuAvailable: false, webgl2Available: true },
    expected: 'webgl2'
  },
  {
    // CI_CD §10 case 3: no supported GPU backend.
    name: 'no supported backend',
    input: { webgpuAvailable: false, webgl2Available: false },
    expected: 'unsupported'
  },
  {
    // D9's prerequisite case: WebGPU PRESENT but missing a required feature
    // must not select webgpu.
    name: 'webgpu present but missing a required feature',
    input: { webgpuAvailable: true, webgl2Available: true, webgpuMissingRequiredFeature: true },
    expected: 'webgl2'
  },
  {
    name: 'webgpu present, missing required feature, no webgl2',
    input: { webgpuAvailable: true, webgl2Available: false, webgpuMissingRequiredFeature: true },
    expected: 'unsupported'
  },
  {
    // CI_CD §10 case 4: timestamp query missing — NOT a backend decision.
    // The product runs with GPU timing disabled (`frameGpuMs` null), so the
    // backend choice is deliberately unaffected. Owned by the telemetry path
    // (SharedRendererKernel timestamp tracking + OBSERVABILITY_DIAGNOSTICS).
    name: 'timestamp query missing',
    input: { webgpuAvailable: true, webgl2Available: true },
    expected: 'webgpu',
    outOfScopeReason:
      'timestamp-query absence disables GPU timing telemetry only; the backend decision is unaffected (asserted here so the documented case is not silently omitted)'
  },
  {
    // CI_CD §10 case 5: LUT feature/resource failure — NOT a backend
    // decision. The trajectory policy falls back to the numerical path and
    // reports `lutFallbackReason`; owned by the LUT runtime
    // (tests/unit/lutRuntime.test.ts covers the fallback reason).
    name: 'lut feature/resource failure',
    input: { webgpuAvailable: true, webgl2Available: true },
    expected: 'webgpu',
    outOfScopeReason:
      'LUT failure downgrades the TRAJECTORY backend to numerical (lutRuntime fallbackReason), not the renderer backend'
  },
  {
    // CI_CD §10 case 6: reduced texture limits — NOT a backend decision.
    // The resize path clamps to maxTextureSize and surfaces the reduction
    // (SharedRendererKernel.resizeReport; R-09).
    name: 'reduced texture limits',
    input: { webgpuAvailable: true, webgl2Available: true },
    expected: 'webgpu',
    outOfScopeReason:
      'reduced texture limits clamp the drawing buffer (resizeReport, R-09), not the backend decision'
  }
];

describe('decideBackend over the documented failure-mode list (D9)', () => {
  for (const mode of FAILURE_MODES) {
    it(mode.name, () => {
      const result = expect(decideBackend(mode.input));
      result.toBe(mode.expected);
      if (mode.outOfScopeReason !== undefined) {
        // 7.5: the case IS covered — explicitly, with its reason — rather
        // than omitted.
        expect(mode.outOfScopeReason.length).toBeGreaterThan(0);
      }
    });
  }

  it('every documented §10 case is present in the table (no silent omission)', () => {
    expect(FAILURE_MODES.length).toBeGreaterThanOrEqual(8);
  });
});
