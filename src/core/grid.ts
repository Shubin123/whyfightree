/**
 * A regular raster of float samples, the common currency of this app: every
 * data source — satellite, aerial, lidar — is resampled to one of these before
 * it reaches the renderer.
 */
export interface Grid {
  /** Number of samples along the west-east axis. */
  readonly width: number;
  /** Number of samples along the north-south axis. */
  readonly height: number;
  /** Ground distance between neighbouring samples, in metres. */
  readonly cellSize: number;
  /** Row-major samples, `width * height` long. */
  readonly data: Float32Array;
}

export function createGrid(width: number, height: number, cellSize: number): Grid {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new RangeError(`grid must be at least 2x2 integers, got ${width}x${height}`);
  }
  if (!(cellSize > 0)) {
    throw new RangeError(`cellSize must be positive, got ${cellSize}`);
  }
  return { width, height, cellSize, data: new Float32Array(width * height) };
}

/** Reads a sample, clamping out-of-range coordinates to the edge. */
export function sampleAt(grid: Grid, x: number, y: number): number {
  const cx = Math.min(grid.width - 1, Math.max(0, Math.round(x)));
  const cy = Math.min(grid.height - 1, Math.max(0, Math.round(y)));
  return grid.data[cy * grid.width + cx] ?? 0;
}

/**
 * Bilinear lookup in grid coordinates. Used for hover read-outs, where the
 * pointer lands between samples and nearest-neighbour would visibly quantise.
 */
export function sampleBilinear(grid: Grid, x: number, y: number): number {
  const fx = Math.min(grid.width - 1, Math.max(0, x));
  const fy = Math.min(grid.height - 1, Math.max(0, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(grid.width - 1, x0 + 1);
  const y1 = Math.min(grid.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = grid.data[y0 * grid.width + x0] ?? 0;
  const v10 = grid.data[y0 * grid.width + x1] ?? 0;
  const v01 = grid.data[y1 * grid.width + x0] ?? 0;
  const v11 = grid.data[y1 * grid.width + x1] ?? 0;
  return (v00 * (1 - tx) + v10 * tx) * (1 - ty) + (v01 * (1 - tx) + v11 * tx) * ty;
}

export interface GridRange {
  readonly min: number;
  readonly max: number;
}

export function gridRange(grid: Grid): GridRange {
  let min = Infinity;
  let max = -Infinity;
  for (const v of grid.data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : { min: 0, max: 0 };
}

/** Ground area covered by a single cell, in hectares. */
export function cellAreaHectares(grid: Grid): number {
  return (grid.cellSize * grid.cellSize) / 10_000;
}
