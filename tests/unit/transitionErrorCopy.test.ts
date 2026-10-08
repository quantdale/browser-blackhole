import { describe, expect, it } from 'vitest';

import {
  buildTransitionFailureMessage,
  buildUnsupportedMessage
} from '../../src/atlas/hostStatus.js';
import { TRANSITION_ERROR_CODES, type TransitionErrorCode } from '../../src/atlas/types.js';

/**
 * atlas-error-reporting — authored failure copy.
 *
 * `docs/FAILURE_RECOVERY.md` §3 requires every user-facing message to state
 * what failed, whether the application can continue, the active degraded mode,
 * and one useful remediation, and forbids dumping loader strings or stack
 * traces into ordinary UI. These assertions pin that contract for the copy the
 * shell renders from `TransitionPublicState.error`.
 */

const CODES: readonly TransitionErrorCode[] = Object.freeze([
  TRANSITION_ERROR_CODES.TRANSITION_PREPARE_FAILED,
  TRANSITION_ERROR_CODES.TRANSITION_STALLED,
  TRANSITION_ERROR_CODES.TRANSITION_RESOLVE_FAILED,
  TRANSITION_ERROR_CODES.TRANSITION_ACTIVATION_FAILED,
  TRANSITION_ERROR_CODES.TRANSITION_EXIT_FAILED,
  TRANSITION_ERROR_CODES.TRANSITION_DISPOSAL_FAILED,
  TRANSITION_ERROR_CODES.TRANSITION_HANDOFF_FAILED
]);

describe('transition failure copy', () => {
  it('names the failing destination for every code', () => {
    for (const code of CODES) {
      const message = buildTransitionFailureMessage({
        code,
        destinationTitle: 'Galaxy Collision',
        fatal: false
      });
      expect(message, code).toContain('Galaxy Collision');
    }
  });

  it('states that the application continues when the failure is recoverable', () => {
    const message = buildTransitionFailureMessage({
      code: TRANSITION_ERROR_CODES.TRANSITION_PREPARE_FAILED,
      destinationTitle: 'Galaxy Collision',
      fatal: false
    });
    expect(message).toContain('still active');
    expect(message).toContain('remains usable');
    // One useful remediation.
    expect(message).toContain('Try again');
  });

  it('presents a fatal failure as terminal, not as a recoverable one', () => {
    const recoverable = buildTransitionFailureMessage({
      code: TRANSITION_ERROR_CODES.TRANSITION_ACTIVATION_FAILED,
      destinationTitle: 'Galaxy Collision',
      fatal: false
    });
    const fatal = buildTransitionFailureMessage({
      code: TRANSITION_ERROR_CODES.TRANSITION_ACTIVATION_FAILED,
      destinationTitle: 'Galaxy Collision',
      fatal: true
    });
    expect(fatal).toContain('stopped');
    expect(fatal).toContain('Reload');
    expect(fatal).not.toBe(recoverable);
    // The distinction is carried in TEXT, never by colour alone.
    expect(recoverable).toContain('still active');
  });

  it('states the stall window and that the preparation was cancelled', () => {
    const message = buildTransitionFailureMessage({
      code: TRANSITION_ERROR_CODES.TRANSITION_STALLED,
      destinationTitle: 'Black-Hole Merger',
      fatal: false,
      stallThresholdMs: 9000
    });
    expect(message).toContain('9 s');
    expect(message).toContain('cancelled');
    expect(message).toContain('still active');
  });

  it('never leaks raw loader detail or stack-trace text', () => {
    for (const code of CODES) {
      const message = buildTransitionFailureMessage({
        code,
        destinationTitle: 'Galaxy Collision',
        fatal: false,
        stallThresholdMs: 9000
      });
      expect(message, code).not.toMatch(/Error:|at [A-Za-z]+ \(.*:\d+:\d+\)|\.ts:\d+/);
      expect(message, code).not.toContain('fetch failed');
      expect(message, code).not.toContain('manifest');
    }
  });

  it('falls back to the generic recoverable copy for an unknown code', () => {
    const message = buildTransitionFailureMessage({
      code: 'TRANSITION_SOMETHING_NEW',
      destinationTitle: 'Galaxy Collision',
      fatal: false
    });
    expect(message).toContain('failed to load');
    expect(message).toContain('still active');
  });

  it('does not claim the target failed to open for post-arrival codes', () => {
    // EXIT/DISPOSAL failures happen AFTER the target opened successfully, so
    // the copy must not say the destination "could not be opened" — that
    // would be false copy about a scene the user can see.
    for (const code of [
      TRANSITION_ERROR_CODES.TRANSITION_EXIT_FAILED,
      TRANSITION_ERROR_CODES.TRANSITION_DISPOSAL_FAILED
    ]) {
      const message = buildTransitionFailureMessage({
        code,
        destinationTitle: 'Galaxy Collision',
        fatal: false,
        stallThresholdMs: 9000
      });
      expect(message, code).not.toContain('could not be opened');
      expect(message, code).toContain('on the way to');
    }
  });

  it('states a continuation clause for every recoverable code and a terminal one for every fatal code', () => {
    // TRANSITION_EXIT_FAILED is only reachable as FATAL (the director routes it
    // through failFatal), so the recoverable framing does not apply to it.
    const recoverableCodes = CODES.filter(
      (code) => code !== TRANSITION_ERROR_CODES.TRANSITION_EXIT_FAILED
    );
    for (const code of recoverableCodes) {
      const recoverable = buildTransitionFailureMessage({
        code,
        destinationTitle: 'Galaxy Collision',
        fatal: false,
        stallThresholdMs: 9000
      });
      // docs/FAILURE_RECOVERY.md §3: the user must be told the app continues.
      expect(recoverable, `${code} recoverable`).toContain('still active');

      const fatal = buildTransitionFailureMessage({
        code,
        destinationTitle: 'Galaxy Collision',
        fatal: true,
        stallThresholdMs: 9000
      });
      expect(fatal, `${code} fatal`).not.toContain('still active');
      expect(fatal, `${code} fatal`).toContain('stopped');
    }
  });
});

describe('transition error codes', () => {
  it('are stable, unique machine-readable identifiers', () => {
    const values = Object.values(TRANSITION_ERROR_CODES);
    expect(new Set(values).size).toBe(values.length);
    for (const code of values) {
      expect(code).toMatch(/^TRANSITION_[A-Z_]+$/);
    }
  });
});

describe('unsupported-backend remediation copy', () => {
  /**
   * The codes the ATLAS boot-failure path can actually produce
   * (src/atlas/host.ts runInit + createAtlasApp's catch). Each must render
   * remediation guidance, never a bare code — the E-02 defect was that the
   * product route surfaced a code plus a raw string while
   * `buildUnsupportedMessage` sat unreferenced.
   */
  const ATLAS_BOOT_CODES: readonly string[] = [
    'ENV_WEBGL2_UNAVAILABLE',
    'BOOT_UNSUPPORTED',
    'ENV_WEBGPU_UNAVAILABLE'
  ];

  it('gives every atlas boot code a title, guidance and at least one suggestion', () => {
    for (const code of ATLAS_BOOT_CODES) {
      const copy = buildUnsupportedMessage(null, code);
      expect(copy.title, code).not.toBe('');
      expect(copy.detail, code).not.toBe('');
      expect(copy.suggestions.length, code).toBeGreaterThan(0);
      for (const suggestion of copy.suggestions) {
        expect(suggestion.trim().length, `${code} suggestion`).toBeGreaterThan(0);
      }
    }
  });

  it('echoes the requested code for known reasons and never leaks it as the whole message', () => {
    for (const code of ATLAS_BOOT_CODES) {
      const copy = buildUnsupportedMessage(null, code);
      // The code is testable and stable; it is one line of the surface, not the
      // whole presentation.
      expect(copy.code).toBe(code);
      expect(copy.detail).not.toBe(code);
      expect(copy.title).not.toBe(code);
    }
  });

  it('falls back to the generic copy for an unrecognised reason', () => {
    const copy = buildUnsupportedMessage(null, 'SOMETHING_NEW');
    expect(copy.code).toBe('BOOT_UNSUPPORTED');
    expect(copy.title).not.toBe('');
    expect(copy.suggestions.length).toBeGreaterThan(0);
  });

  it('appends the active backend context so bug reports carry adapter facts', () => {
    const copy = buildUnsupportedMessage(
      {
        api: 'webgl2',
        adapterName: 'SwiftShader',
        timestampQuery: false,
        maxTextureSize: 8192,
        floatRenderTargets: true,
        storageBuffers: false,
        devicePixelRatio: 1
      },
      'ENV_WEBGL2_UNAVAILABLE'
    );
    expect(copy.detail).toContain('webgl2');
    expect(copy.detail).toContain('SwiftShader');
  });
});
