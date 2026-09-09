import type { BurnScene, SourceType } from '../core/burnModel';
import { createGrid, type Grid } from '../core/grid';

export class ImportError extends Error {
  override readonly name = 'ImportError';
}

/** Guards against a mistyped raster locking the browser up for minutes. */
const MAX_CELLS = 4_000_000;

interface BurnMapFile {
  format?: unknown;
  name?: unknown;
  sourceType?: unknown;
  sensor?: unknown;
  acquired?: unknown;
  region?: unknown;
  notes?: unknown;
  width?: unknown;
  height?: unknown;
  cellSize?: unknown;
  elevation?: unknown;
  dnbr?: unknown;
}

const SOURCE_TYPES: readonly SourceType[] = ['satellite', 'aerial', 'lidar', 'imported'];

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function toGrid(values: readonly number[], width: number, height: number, cellSize: number): Grid {
  const grid = createGrid(width, height, cellSize);
  grid.data.set(values);
  return grid;
}

function readNumberArray(value: unknown, label: string, expected: number): number[] {
  if (!Array.isArray(value)) {
    throw new ImportError(`"${label}" must be an array of ${expected} numbers.`);
  }
  if (value.length !== expected) {
    throw new ImportError(`"${label}" has ${value.length} values, expected ${expected}.`);
  }
  return value.map((entry, index) => {
    const num = typeof entry === 'number' ? entry : Number(entry);
    if (!Number.isFinite(num)) {
      throw new ImportError(`"${label}" contains a non-numeric value at index ${index}.`);
    }
    return num;
  });
}

/** Parses the documented `burnmap/v1` JSON exchange format. */
export function parseBurnMapJson(text: string): BurnScene {
  let raw: BurnMapFile;
  try {
    raw = JSON.parse(text) as BurnMapFile;
  } catch (error) {
    throw new ImportError(`File is not valid JSON: ${(error as Error).message}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ImportError('Expected a JSON object at the top level.');
  }
  if (typeof raw.format === 'string' && !raw.format.startsWith('burnmap/v1')) {
    throw new ImportError(`Unsupported format "${raw.format}"; this build reads burnmap/v1.`);
  }

  const width = Number(raw.width);
  const height = Number(raw.height);
  const cellSize = Number(raw.cellSize ?? 30);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new ImportError('"width" and "height" must be integers of at least 2.');
  }
  if (width * height > MAX_CELLS) {
    throw new ImportError(`Raster is ${width}x${height}; the viewer caps at ${MAX_CELLS} cells.`);
  }
  if (!(cellSize > 0)) {
    throw new ImportError('"cellSize" must be a positive number of metres.');
  }

  const expected = width * height;
  const dnbrValues = readNumberArray(raw.dnbr, 'dnbr', expected);
  const elevationValues =
    raw.elevation === undefined
      ? new Array<number>(expected).fill(0)
      : readNumberArray(raw.elevation, 'elevation', expected);

  const sourceType = SOURCE_TYPES.includes(raw.sourceType as SourceType)
    ? (raw.sourceType as SourceType)
    : 'imported';

  return {
    id: 'imported',
    name: asString(raw.name, 'Imported raster'),
    sourceType,
    sensor: asString(raw.sensor, 'User supplied'),
    acquired: asString(raw.acquired, 'Unknown acquisition date'),
    region: asString(raw.region, `${width} × ${height} cells at ${cellSize} m`),
    notes: asString(raw.notes, 'Imported from a local burnmap/v1 file.'),
    elevation: toGrid(elevationValues, width, height, cellSize),
    dnbr: toGrid(dnbrValues, width, height, cellSize),
  };
}

/**
 * Parses a bare CSV of dNBR values — one row per raster row. Terrain is flat,
 * because a severity CSV carries no elevation; the map still reads correctly,
 * it just renders as a draped plane.
 */
export function parseDnbrCsv(text: string, cellSize = 30): BurnScene {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/[,;\t]+/));

  if (rows.length < 2) throw new ImportError('CSV needs at least 2 rows of dNBR values.');
  const width = rows[0]!.length;
  if (width < 2) throw new ImportError('CSV needs at least 2 columns of dNBR values.');

  const values: number[] = [];
  rows.forEach((row, y) => {
    if (row.length !== width) {
      throw new ImportError(`Row ${y + 1} has ${row.length} columns, expected ${width}.`);
    }
    row.forEach((cell, x) => {
      const num = Number(cell);
      if (!Number.isFinite(num)) {
        throw new ImportError(`Value at row ${y + 1}, column ${x + 1} is not a number: "${cell}"`);
      }
      values.push(num);
    });
  });

  const height = rows.length;
  return {
    id: 'imported',
    name: 'Imported CSV',
    sourceType: 'imported',
    sensor: 'User supplied CSV',
    acquired: 'Unknown acquisition date',
    region: `${width} × ${height} cells at ${cellSize} m`,
    notes: 'dNBR only — no elevation in a CSV, so the terrain renders flat.',
    elevation: createGrid(width, height, cellSize),
    dnbr: toGrid(values, width, height, cellSize),
  };
}

/** Chooses a parser from the file name, falling back to sniffing the content. */
export function parseImportedFile(fileName: string, text: string): BurnScene {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) return parseBurnMapJson(text);
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return parseDnbrCsv(text);
  return text.trimStart().startsWith('{') ? parseBurnMapJson(text) : parseDnbrCsv(text);
}
