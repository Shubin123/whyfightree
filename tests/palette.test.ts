import { describe, expect, it } from 'vitest';
import { fbm2D, makeRandom, valueNoise2D } from '../src/core/noise';
import { dnbrRamp, elevationRamp, hexToRgb, imageryColor, mixRgb } from '../src/core/palette';
import { SEVERITY_CLASSES } from '../src/core/severity';

describe('noise', () => {
  it('is reproducible across calls', () => {
    const a = makeRandom(99);
    const b = makeRandom(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('stays inside the unit interval', () => {
    for (let i = 0; i < 500; i += 1) {
      const value = fbm2D(3, i * 0.13, i * 0.07);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous between lattice points', () => {
    const a = valueNoise2D(5, 2, 2);
    const b = valueNoise2D(5, 2.01, 2);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });
});

describe('palette', () => {
  it('parses both hex forms and rejects junk', () => {
    expect(hexToRgb('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToRgb('#000')).toEqual([0, 0, 0]);
    expect(hexToRgb('#8c1d1d')[0]).toBeCloseTo(140 / 255, 6);
    expect(() => hexToRgb('#zzz')).toThrow(RangeError);
  });

  it('clamps the mix factor', () => {
    expect(mixRgb([0, 0, 0], [1, 1, 1], -1)).toEqual([0, 0, 0]);
    expect(mixRgb([0, 0, 0], [1, 1, 1], 2)).toEqual([1, 1, 1]);
    expect(mixRgb([0, 0, 0], [1, 1, 1], 0.5)).toEqual([0.5, 0.5, 0.5]);
  });

  it('darkens and reddens as dNBR climbs', () => {
    const unburned = dnbrRamp(0);
    const high = dnbrRamp(1);
    const luminance = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
    expect(luminance(high)).toBeLessThan(luminance(unburned));
    expect(high[0]).toBeGreaterThan(high[1]!);
  });

  it('clamps the ramps outside their domain', () => {
    expect(dnbrRamp(-99)).toEqual(dnbrRamp(-0.5));
    expect(dnbrRamp(99)).toEqual(dnbrRamp(1.3));
    expect(elevationRamp(-1)).toEqual(elevationRamp(0));
    expect(elevationRamp(9)).toEqual(elevationRamp(1));
  });

  it('has a legend colour for every severity class', () => {
    for (const cls of SEVERITY_CLASSES) {
      expect(() => hexToRgb(cls.color)).not.toThrow();
    }
  });

  it('renders burned ground darker than unburned canopy', () => {
    const canopy = imageryColor(0, 0.5, 0.5);
    const burned = imageryColor(0.9, 0.5, 0.5);
    expect(burned[0] + burned[1] + burned[2]).toBeLessThan(canopy[0] + canopy[1] + canopy[2]);
  });
});
