import { describe, expect, it } from 'vitest';
import { decideBackend } from '../../src/app/capability.js';

describe('decideBackend: capability decision logic', () => {
  it('prefers WebGPU when the API is present', () => {
    expect(decideBackend({ webgpuAvailable: true, webgl2Available: true })).toBe('webgpu');
    expect(decideBackend({ webgpuAvailable: true, webgl2Available: false })).toBe('webgpu');
  });

  it('falls back to WebGL2 when WebGPU is absent', () => {
    expect(decideBackend({ webgpuAvailable: false, webgl2Available: true })).toBe('webgl2');
  });

  it('reports unsupported when neither backend exists', () => {
    expect(decideBackend({ webgpuAvailable: false, webgl2Available: false })).toBe('unsupported');
  });
});
