import { describe, expect, it } from 'vitest';
import { AutoFramer, type AutoFramerRig } from '../../src/renderer/shared/AutoFramer.js';

function makeRig(): AutoFramerRig & {
  distance: number;
  userRevision: number;
  animating: boolean;
  writes: Array<{ distance: number; source: 'system' | 'user' | undefined }>;
} {
  const rig = {
    distance: 10,
    userRevision: 0,
    animating: false,
    writes: [] as Array<{ distance: number; source: 'system' | 'user' | undefined }>,
    getOrbit() {
      return { azimuthDeg: 20, polarDeg: 70, distance: this.distance };
    },
    setOrbit(_azimuthDeg: number, _polarDeg: number, distance: number, source?: 'system' | 'user') {
      this.distance = distance;
      this.writes.push({ distance, source });
      if (source === 'user') this.userRevision += 1;
    },
    isAnimating() {
      return this.animating;
    },
    getUserInteractionRevision() {
      return this.userRevision;
    }
  } satisfies AutoFramerRig & {
    distance: number;
    userRevision: number;
    animating: boolean;
    writes: Array<{ distance: number; source: 'system' | 'user' | undefined }>;
  };
  return rig;
}

describe('AutoFramer presentation-camera policy', () => {
  it('snaps a paused scene to a bounded visible extent', () => {
    const rig = makeRig();
    const framer = new AutoFramer({ minUnits: 4, maxUnits: 100, margin: 2 });

    framer.update(rig, 80, 0, undefined, true);

    expect(rig.distance).toBe(100);
    expect(framer.requestedDistance).toBe(100);
    expect(rig.writes.at(-1)?.source).toBe('system');
  });

  it('does not interpret its own system write as viewer takeover', () => {
    const rig = makeRig();
    const framer = new AutoFramer({ minUnits: 1, maxUnits: 100, margin: 2 });

    framer.update(rig, 5, 1 / 60);
    framer.update(rig, 10, 1 / 60);

    expect(framer.enabled).toBe(true);
    expect(rig.writes.every((write) => write.source === 'system')).toBe(true);
  });

  it('disables permanently after a direct user revision', () => {
    const rig = makeRig();
    const framer = new AutoFramer({ minUnits: 1, maxUnits: 100, margin: 2 });

    framer.update(rig, 5, 1 / 60);
    rig.setOrbit(20, 70, 42, 'user');
    framer.update(rig, 20, 1 / 60);
    framer.update(rig, 80, 1 / 60);

    expect(framer.enabled).toBe(false);
    expect(rig.distance).toBe(42);
    expect(framer.requestedDistance).toBeLessThan(42);
  });

  it('waits for arrival animation before taking ownership', () => {
    const rig = makeRig();
    rig.animating = true;
    const framer = new AutoFramer({ minUnits: 1, maxUnits: 100, margin: 2 });

    framer.update(rig, 20, 0.25);
    expect(rig.writes).toHaveLength(0);

    rig.animating = false;
    framer.update(rig, 20, 0.25);
    expect(rig.writes).toHaveLength(1);
    expect(rig.writes[0]?.source).toBe('system');
  });
});
