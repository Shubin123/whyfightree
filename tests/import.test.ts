import { describe, expect, it } from 'vitest';
import { generateScene } from '../src/core/burnModel';
import { exportFileName, toBurnMapJson } from '../src/data/export';
import { ImportError, parseBurnMapJson, parseDnbrCsv, parseImportedFile } from '../src/data/import';

const MINIMAL = JSON.stringify({
  format: 'burnmap/v1',
  name: 'Test fire',
  sourceType: 'satellite',
  width: 2,
  height: 2,
  cellSize: 25,
  elevation: [100, 110, 120, 130],
  dnbr: [0, 0.3, 0.5, 0.9],
});

describe('parseBurnMapJson', () => {
  it('reads a well-formed file', () => {
    const scene = parseBurnMapJson(MINIMAL);
    expect(scene.name).toBe('Test fire');
    expect(scene.sourceType).toBe('satellite');
    expect(scene.dnbr.cellSize).toBe(25);
    [0, 0.3, 0.5, 0.9].forEach((expected, index) => {
      expect(scene.dnbr.data[index]).toBeCloseTo(expected, 6);
    });
    expect([...scene.elevation.data]).toEqual([100, 110, 120, 130]);
  });

  it('defaults elevation to a flat plane when it is omitted', () => {
    const scene = parseBurnMapJson(
      JSON.stringify({ width: 2, height: 2, cellSize: 10, dnbr: [0, 0, 0, 0] }),
    );
    expect([...scene.elevation.data]).toEqual([0, 0, 0, 0]);
    expect(scene.sourceType).toBe('imported');
  });

  it('explains what is wrong instead of failing opaquely', () => {
    expect(() => parseBurnMapJson('not json')).toThrow(ImportError);
    expect(() => parseBurnMapJson('[]')).toThrow(/JSON object/);
    expect(() => parseBurnMapJson(JSON.stringify({ format: 'burnmap/v9' }))).toThrow(/burnmap\/v1/);
    expect(() => parseBurnMapJson(JSON.stringify({ width: 1, height: 2, dnbr: [] }))).toThrow(
      /at least 2/,
    );
    expect(() =>
      parseBurnMapJson(JSON.stringify({ width: 2, height: 2, dnbr: [0, 1, 2] })),
    ).toThrow(/expected 4/);
    expect(() =>
      parseBurnMapJson(JSON.stringify({ width: 2, height: 2, dnbr: [0, 1, 'x', 3] })),
    ).toThrow(/non-numeric value at index 2/);
  });
});

describe('parseDnbrCsv', () => {
  it('reads a rectangular grid and skips comments', () => {
    const scene = parseDnbrCsv('# fire\n0.1,0.2\n0.3,0.4\n', 15);
    expect(scene.dnbr.width).toBe(2);
    expect(scene.dnbr.height).toBe(2);
    expect(scene.dnbr.cellSize).toBe(15);
    // Storage is Float32Array, so compare with tolerance rather than exactly.
    [0.1, 0.2, 0.3, 0.4].forEach((expected, index) => {
      expect(scene.dnbr.data[index]).toBeCloseTo(expected, 6);
    });
  });

  it('reports ragged rows and bad values by position', () => {
    expect(() => parseDnbrCsv('0.1,0.2\n0.3\n')).toThrow(/Row 2 has 1 columns/);
    expect(() => parseDnbrCsv('0.1,oops\n0.3,0.4\n')).toThrow(/row 1, column 2/);
    expect(() => parseDnbrCsv('0.1,0.2\n')).toThrow(/at least 2 rows/);
  });
});

describe('parseImportedFile', () => {
  it('dispatches on extension and falls back to sniffing', () => {
    expect(parseImportedFile('scene.json', MINIMAL).name).toBe('Test fire');
    expect(parseImportedFile('scene.csv', '1,2\n3,4').dnbr.width).toBe(2);
    expect(parseImportedFile('scene.unknown', MINIMAL).name).toBe('Test fire');
    expect(parseImportedFile('scene.unknown', '1,2\n3,4').dnbr.width).toBe(2);
  });
});

describe('export round trip', () => {
  it('re-imports an exported scene unchanged', () => {
    const original = generateScene(
      {
        seed: 7,
        width: 16,
        height: 12,
        cellSize: 30,
        baseElevation: 500,
        relief: 300,
        terrainFrequency: 3,
        ignition: { x: 0.4, y: 0.6 },
        windDirectionDeg: 90,
        windElongation: 2,
        fireRadius: 0.35,
        edgeRoughness: 0.3,
        intensity: 1,
        regrowth: 0.3,
      },
      {
        id: 'test',
        name: 'Round trip',
        sourceType: 'satellite',
        sensor: 'test',
        acquired: 'today',
        region: 'nowhere',
        notes: 'n/a',
      },
    );

    const restored = parseBurnMapJson(toBurnMapJson(original));
    expect(restored.dnbr.width).toBe(original.dnbr.width);
    expect(restored.dnbr.height).toBe(original.dnbr.height);
    expect(restored.dnbr.cellSize).toBe(original.dnbr.cellSize);
    for (let i = 0; i < original.dnbr.data.length; i += 1) {
      expect(restored.dnbr.data[i]).toBeCloseTo(original.dnbr.data[i]!, 3);
      expect(restored.elevation.data[i]).toBeCloseTo(original.elevation.data[i]!, 1);
    }
  });

  it('builds a readable file name', () => {
    expect(
      exportFileName(
        {
          id: 'x',
          name: 'Aerial photography',
          sourceType: 'aerial',
          sensor: '',
          acquired: '',
          region: '',
          notes: '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        'png',
      ),
    ).toBe('whyfightree-aerial-photography.png');
  });
});
