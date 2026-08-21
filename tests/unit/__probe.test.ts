import { describe, it } from 'vitest';
import {
  cellHasStar, directionToCubeCell, makeStarfieldParams,
  sampleStarfieldRadiance, starFaceCoords, faceCoordsToDirection
} from '../../src/shaders/starfield.js';

describe('probe', () => {
  it('probes', () => {
    const p = makeStarfieldParams({ starDensity: 0.3, cellsPerFaceSide: 32 });
    let stars = 0;
    for (let f = 0; f < 6; f++)
      for (let i = 0; i < 32; i++)
        for (let j = 0; j < 32; j++) if (cellHasStar(f, i, j, p)) stars++;
    console.log('stars:', stars);
    // pick first star and try to see it
    outer: for (let f = 0; f < 6; f++)
      for (let i = 0; i < 32; i++)
        for (let j = 0; j < 32; j++) {
          if (!cellHasStar(f, i, j, p)) continue;
          const { fu, fv } = starFaceCoords(f, i, j, p);
          const sd = faceCoordsToDirection(f, fu, fv);
          const cell = directionToCubeCell(sd, 32);
          console.log('star f,i,j', f, i, j, 'sd', sd, 'cellOfStarDir', cell);
          const r = sampleStarfieldRadiance(sd, p);
          console.log('radiance at star dir', r);
          break outer;
        }
  });
});
