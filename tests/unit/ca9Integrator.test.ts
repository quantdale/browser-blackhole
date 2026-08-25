/**
 * CA9-03 — Restricted three-body engine validation gates.
 *
 * The offline Python tool (tools/cosmic-data/restricted_three_body.py)
 * emits an analytic self-check report. A report that is generated but never
 * asserted is a failure (same principle as CA8-17), so this suite pins:
 * - every engine check passes;
 * - numeric checks satisfy their own declared thresholds;
 * - determinism evidence (byte-identical IC resample) holds;
 * - the exercise configuration can never silently masquerade as published
 *   Toomre & Toomre parameters ("placeholder-exercise-config" guard);
 * - locked unit conventions and the pinned provenance are declared.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPORT_PATH = join(
  REPO_ROOT,
  'tools',
  'cosmic-data',
  'reports',
  'ca9-integrator-selfcheck.json'
);

interface SelfcheckCheck {
  readonly id: string;
  readonly pass: boolean;
  readonly threshold?: number;
  readonly measured: unknown;
}

interface SelfcheckReport {
  readonly schemaVersion: number;
  readonly toolVersion: string;
  readonly packet: string;
  readonly provenance: {
    readonly referenceExperiment: string;
    readonly doi: string;
    readonly decisionAdr: string;
    readonly parametersStatus: string;
  };
  readonly units: {
    readonly gravitationalConstant: number;
    readonly totalPairMass: number;
    readonly lengthUnitDiskRadius: number;
    readonly integrator: string;
    readonly fixedStepDt: number;
    readonly primaryPropagation: string;
  };
  readonly sampling: {
    readonly seed: number;
    readonly initialConditionsSha256: string;
  };
  readonly determinism: {
    readonly icSha256Repeat: string;
    readonly icBytesIdenticalOnResample: boolean;
  };
  readonly checks: readonly SelfcheckCheck[];
  readonly allPass: boolean;
}

const report: SelfcheckReport = JSON.parse(readFileSync(REPORT_PATH, 'utf8'));

const EXPECTED_CHECK_IDS = [
  'barker-finite-difference',
  'conic-invariants',
  'time-reversal',
  'reflection-symmetry',
  'circular-orbit-single-mass',
  'frozen-potential-energy-drift',
  'quarantine-fail-closed'
] as const;

describe('CA9 restricted three-body self-check report', () => {
  it('declares the expected schema, packet and complete pass state', () => {
    expect(report.schemaVersion).toBe(1);
    expect(report.packet).toBe('CA9-03');
    expect(report.allPass).toBe(true);
    expect(report.checks.map((c) => c.id).sort()).toEqual([...EXPECTED_CHECK_IDS].sort());
    for (const check of report.checks) {
      expect(check.pass, `check ${check.id} must pass`).toBe(true);
    }
  });

  it('numeric checks satisfy their own declared thresholds', () => {
    for (const check of report.checks) {
      if (typeof check.threshold !== 'number') continue;
      const measured = check.measured;
      expect(typeof measured, `check ${check.id} measured type`).toBe('number');
      expect(measured as number, `check ${check.id} within threshold`).toBeLessThanOrEqual(
        check.threshold
      );
    }
  });

  it('proves deterministic initial-condition sampling', () => {
    const hex64 = /^[0-9a-f]{64}$/;
    expect(report.sampling.initialConditionsSha256).toMatch(hex64);
    expect(report.determinism.icSha256Repeat).toBe(report.sampling.initialConditionsSha256);
    expect(report.determinism.icBytesIdenticalOnResample).toBe(true);
  });

  it('guards against promoting the exercise config to published parameters', () => {
    // CA9-03 parameter transcription must flip this status AND extend this
    // suite with published-parameter anchors in the same change.
    expect(report.provenance.parametersStatus).toBe('placeholder-exercise-config');
  });

  it('pins provenance to the locked reference experiment', () => {
    expect(report.provenance.referenceExperiment).toContain('Toomre');
    expect(report.provenance.doi).toBe('10.1086/151823');
    expect(report.provenance.decisionAdr).toBe('CA-ADR-022');
  });

  it('declares the locked unit conventions', () => {
    expect(report.units.gravitationalConstant).toBe(1);
    expect(report.units.totalPairMass).toBe(1);
    expect(report.units.lengthUnitDiskRadius).toBe(1);
    expect(report.units.integrator).toBe('velocity-verlet');
    expect(report.units.primaryPropagation).toBe('barker-exact-parabolic');
    expect(report.units.fixedStepDt).toBeGreaterThan(0);
  });
});
