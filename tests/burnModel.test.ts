import { describe, expect, it } from 'vitest';
import { generateElevation, generateSeverity, type SceneRecipe } from '../src/core/burnModel';
import { gridRange } from '../src/core/grid';
import { summariseSeverity } from '../src/core/severity';
import { loadSample, SAMPLES } from '../src/data/samples';

const RECIPE: SceneRecipe = {
  seed: 42,
  width: 48,
  height: 48,
  cellSize: 20,
  baseElevation: 800,
  relief: 500,
  terrainFrequency: 3,
  ignition: { x: 0.35, y: 0.7 },
  windDirectionDeg: 30,
  windElongation: 2,
  fireRadius: 0.35,
  edgeRoughness: 0.3,
  intensity: 1,
  regrowth: 0.3,
};

describe('generateElevation', () => {
  it('is deterministic for a seed', () => {
    const a = generateElevation(RECIPE);
    const b = generateElevation(RECIPE);
    expect([...a.data]).toEqual([...b.data]);
  });

  it('produces relief within the requested envelope', () => {
    const { min, max } = gridRange(generateElevation(RECIPE));
    expect(max).toBeGreaterThan(min);
    expect(max - min).toBeLessThanOrEqual(RECIPE.relief * 1.6);
    expect(min).toBeGreaterThan(RECIPE.baseElevation - RECIPE.relief);
  });

  it('changes shape when the seed changes', () => {
    const a = generateElevation(RECIPE);
    const b = generateElevation({ ...RECIPE, seed: 43 });
    expect([...a.data]).not.toEqual([...b.data]);
  });
});

describe('generateSeverity', () => {
  const elevation = generateElevation(RECIPE);

  it('is deterministic for a seed', () => {
    expect([...generateSeverity(RECIPE, elevation).data]).toEqual([
      ...generateSeverity(RECIPE, elevation).data,
    ]);
  });

  it('burns hottest near the ignition point and cools away from the scar', () => {
    const dnbr = generateSeverity(RECIPE, elevation);
    const at = (u: number, v: number) => {
      const x = Math.round(u * (RECIPE.width - 1));
      const y = Math.round(v * (RECIPE.height - 1));
      return dnbr.data[y * RECIPE.width + x]!;
    };

    expect(at(RECIPE.ignition.x, RECIPE.ignition.y)).toBeGreaterThan(0.27);
    // The far upwind corner is outside an ellipse that runs to the north-east.
    expect(at(0.97, 0.97)).toBeLessThan(0.1);
  });

  it('scales with the intensity parameter', () => {
    const mild = summariseSeverity(generateSeverity({ ...RECIPE, intensity: 0.5 }, elevation));
    const severe = summariseSeverity(generateSeverity({ ...RECIPE, intensity: 1.4 }, elevation));
    expect(severe.meanDnbr).toBeGreaterThan(mild.meanDnbr);
    expect(severe.burnedHectares).toBeGreaterThan(mild.burnedHectares);
  });
});

describe('shipped samples', () => {
  it.each(SAMPLES.map((sample) => sample.id))('%s produces a usable burn scene', (id) => {
    const scene = loadSample(id);
    const summary = summariseSeverity(scene.dnbr);

    expect(scene.elevation.width).toBe(scene.dnbr.width);
    expect(scene.elevation.height).toBe(scene.dnbr.height);
    // A scene that is entirely burned or entirely green would be a bad demo.
    expect(summary.burnedHectares).toBeGreaterThan(summary.totalHectares * 0.05);
    expect(summary.burnedHectares).toBeLessThan(summary.totalHectares * 0.95);
    expect(summary.stats.find((s) => s.cls.key === 'high')!.cells).toBeGreaterThan(0);
  });

  it('memoises generated scenes', () => {
    expect(loadSample('sentinel2')).toBe(loadSample('sentinel2'));
    expect(() => loadSample('nope')).toThrow(RangeError);
  });
});
