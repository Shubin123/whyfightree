import { createGrid, type Grid } from './grid';
import { fbm2D } from './noise';

/**
 * Parameters for a synthetic scene. Real deployments swap this out for a raster
 * import, but the generator is what makes the demo self-contained and the tests
 * deterministic — see `src/data/samples.ts` for the shipped recipes.
 */
export interface SceneRecipe {
  readonly seed: number;
  readonly width: number;
  readonly height: number;
  /** Ground sample distance in metres, matching the sensor being imitated. */
  readonly cellSize: number;
  readonly baseElevation: number;
  readonly relief: number;
  /** Terrain detail: higher values pack more ridges into the same extent. */
  readonly terrainFrequency: number;
  /** Ignition point in normalised scene coordinates, 0..1. */
  readonly ignition: { readonly x: number; readonly y: number };
  /** Direction the wind blows *towards*, in degrees clockwise from north. */
  readonly windDirectionDeg: number;
  /** How far the scar is stretched downwind relative to across-wind. */
  readonly windElongation: number;
  /** Scar radius across-wind, as a fraction of the scene's shorter side. */
  readonly fireRadius: number;
  /** Amplitude of the noise that breaks up the fire perimeter, 0..1. */
  readonly edgeRoughness: number;
  /** Overall energy of the burn; scales peak dNBR. */
  readonly intensity: number;
  /** Fraction of the scene showing post-fire greening, 0..1. */
  readonly regrowth: number;
}

/** A terrain plus the co-registered burn severity raster measured over it. */
export interface BurnScene {
  readonly id: string;
  readonly name: string;
  readonly sourceType: SourceType;
  readonly sensor: string;
  readonly acquired: string;
  readonly region: string;
  readonly notes: string;
  readonly elevation: Grid;
  readonly dnbr: Grid;
}

export type SourceType = 'satellite' | 'aerial' | 'lidar' | 'imported';

const TAU = Math.PI * 2;

/** Sinuous drainage running roughly north-south; doubles as a fuel break. */
function riverOffset(seed: number, v: number): number {
  return 0.5 + 0.18 * Math.sin(v * TAU * 0.9 + seed * 0.017) + 0.07 * Math.sin(v * TAU * 2.3);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function generateElevation(recipe: SceneRecipe): Grid {
  const grid = createGrid(recipe.width, recipe.height, recipe.cellSize);
  const { width, height, seed, terrainFrequency, relief, baseElevation } = recipe;

  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    const river = riverOffset(seed, v);
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);
      const base = fbm2D(seed, u * terrainFrequency, v * terrainFrequency, { octaves: 6 });
      // Ridged noise reads as mountainous rather than rolling-hill lumpy.
      const ridged = 1 - Math.abs(2 * base - 1);
      const shaped = 0.55 * base + 0.45 * ridged * ridged;
      // Carve the drainage: a gaussian trough centred on the river's path.
      const d = (u - river) / 0.045;
      const valley = Math.exp(-0.5 * d * d);
      grid.data[y * width + x] = baseElevation + relief * (shaped - 0.55 * valley);
    }
  }
  return grid;
}

/** Uphill gradient of the terrain at a cell, in metres per metre. */
function slopeVector(elevation: Grid, x: number, y: number): [number, number, number] {
  const { width, height, data, cellSize } = elevation;
  const xm = Math.max(0, x - 1);
  const xp = Math.min(width - 1, x + 1);
  const ym = Math.max(0, y - 1);
  const yp = Math.min(height - 1, y + 1);
  const dzdx = ((data[y * width + xp] ?? 0) - (data[y * width + xm] ?? 0)) / ((xp - xm) * cellSize);
  const dzdy = ((data[yp * width + x] ?? 0) - (data[ym * width + x] ?? 0)) / ((yp - ym) * cellSize);
  const magnitude = Math.hypot(dzdx, dzdy);
  return [dzdx, dzdy, magnitude];
}

/**
 * Builds the severity raster over an existing terrain. Three effects shape it,
 * in rough order of contribution: an elliptical scar stretched downwind, fuel
 * load variation, and upslope run — fire climbs, so slopes facing into the wind
 * burn hotter than the lee side of the same ridge.
 */
export function generateSeverity(recipe: SceneRecipe, elevation: Grid): Grid {
  const grid = createGrid(recipe.width, recipe.height, recipe.cellSize);
  const { width, height, seed } = recipe;

  const theta = (recipe.windDirectionDeg * Math.PI) / 180;
  // Screen space is x east, y south; a bearing of 0 blows towards the north.
  const windX = Math.sin(theta);
  const windY = -Math.cos(theta);

  for (let y = 0; y < height; y += 1) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const u = x / (width - 1);

      // Distance from ignition, measured in a frame aligned with the wind and
      // squashed across-wind, which turns the circle into the classic ellipse.
      const dx = u - recipe.ignition.x;
      const dy = v - recipe.ignition.y;
      const along = dx * windX + dy * windY;
      const across = -dx * windY + dy * windX;
      const stretched = Math.hypot(
        along >= 0 ? along / recipe.windElongation : along * 1.6,
        across,
      );

      const perimeterNoise = (fbm2D(seed + 77, u * 6, v * 6, { octaves: 4 }) - 0.5) * 2;
      const radius = recipe.fireRadius * (1 + recipe.edgeRoughness * perimeterNoise);
      // The falloff starts well inside the perimeter so severity grades across
      // the scar, the way it does in the field, instead of forming a flat plateau
      // ringed by a thin gradient.
      const scar = 1 - smoothstep(radius * 0.4, radius, stretched);

      const fuel = fbm2D(seed + 311, u * 9, v * 9, { octaves: 4 });
      const [gx, gy, slope] = slopeVector(elevation, x, y);
      const slopeNorm = Math.min(1, slope / 0.6);
      const alignment = slope > 1e-6 ? (gx * windX + gy * windY) / slope : 0;
      const upslopeRun = Math.max(0, alignment) * slopeNorm;

      // The drainage keeps fuels damp, so severity drops off near the river.
      const river = riverOffset(seed, v);
      const riverDist = Math.abs(u - river) / 0.05;
      const fuelBreak = smoothstep(0, 1, Math.min(1, riverDist));

      const energy = recipe.intensity * (0.35 + 0.5 * fuel + 0.45 * upslopeRun) * fuelBreak;
      const burned = scar * energy * 1.15;

      // Outside the scar the signal is regrowth and sensor noise, not zero.
      // Greening only ever lowers dNBR, so it stays on the negative side of the
      // scale where the two regrowth classes live.
      const green = fbm2D(seed + 991, u * 4, v * 4, { octaves: 3 });
      const greening = -recipe.regrowth * Math.max(0, (green - 0.35) / 0.65) ** 1.3 * 1.1;
      const sensorNoise = (fbm2D(seed + 5, u * 24, v * 24, { octaves: 2 }) - 0.5) * 0.05;

      grid.data[y * width + x] = burned + (1 - scar) * greening + sensorNoise;
    }
  }
  return grid;
}

export function generateScene(
  recipe: SceneRecipe,
  meta: Omit<BurnScene, 'elevation' | 'dnbr'>,
): BurnScene {
  const elevation = generateElevation(recipe);
  const dnbr = generateSeverity(recipe, elevation);
  return { ...meta, elevation, dnbr };
}
