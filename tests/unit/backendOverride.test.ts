import { describe, expect, it } from 'vitest';
import { readForcedBackend } from '../../src/app/testHooks.js';

describe('readForcedBackend', () => {
  it('returns null when the parameter is absent', () => {
    expect(readForcedBackend('')).toBeNull();
    expect(readForcedBackend('?foo=bar')).toBeNull();
    expect(readForcedBackend('?backend=')).toBeNull();
  });

  it('returns null for values outside the known backends', () => {
    expect(readForcedBackend('?backend=directx')).toBeNull();
    expect(readForcedBackend('?backend=WEBGPU')).toBeNull();
    expect(readForcedBackend('?backend=webgpu%20')).toBeNull();
  });

  it('parses each supported backend value', () => {
    expect(readForcedBackend('?backend=webgpu')).toBe('webgpu');
    expect(readForcedBackend('?backend=webgl2')).toBe('webgl2');
    expect(readForcedBackend('?backend=unsupported')).toBe('unsupported');
  });

  it('reads only the backend parameter and tolerates other params', () => {
    expect(readForcedBackend('?foo=1&backend=webgl2&bar=2')).toBe('webgl2');
  });
});
