import { generateScene, type BurnScene, type SceneRecipe } from '../core/burnModel';

export interface SampleDefinition {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly recipe: SceneRecipe;
  readonly meta: Omit<BurnScene, 'elevation' | 'dnbr'>;
}

/**
 * The three data sources the project ships with. They differ in ground sample
 * distance and extent the way the real products do: a satellite scene covers
 * the whole fire coarsely, a drone survey covers one drainage in detail.
 */
export const SAMPLES: readonly SampleDefinition[] = [
  {
    id: 'sentinel2',
    name: 'Satellite imagery',
    summary: 'Sentinel-2 dNBR over the full fire perimeter, 20 m cells.',
    recipe: {
      seed: 20240817,
      width: 256,
      height: 256,
      cellSize: 20,
      baseElevation: 780,
      relief: 640,
      terrainFrequency: 3.2,
      ignition: { x: 0.32, y: 0.72 },
      windDirectionDeg: 35,
      windElongation: 1.9,
      fireRadius: 0.34,
      edgeRoughness: 0.42,
      intensity: 0.95,
      regrowth: 0.35,
    },
    meta: {
      id: 'sentinel2',
      name: 'Satellite imagery',
      sourceType: 'satellite',
      sensor: 'Sentinel-2 MSI (B8A / B12), 20 m',
      acquired: 'Pre-fire 2024-07-02 · Post-fire 2024-08-17',
      region: 'Ridge Creek complex — 26.2 km²',
      notes:
        'Standard dNBR composite. Wide coverage at the cost of detail: single ' +
        'cells average 400 m² of canopy, so isolated unburned islands are lost.',
    },
  },
  {
    id: 'aerial',
    name: 'Aerial photography',
    summary: 'Fixed-wing multispectral survey of the head of the fire, 5 m cells.',
    recipe: {
      seed: 771203,
      width: 224,
      height: 224,
      cellSize: 5,
      baseElevation: 910,
      relief: 150,
      terrainFrequency: 3.4,
      ignition: { x: 0.24, y: 0.78 },
      windDirectionDeg: 22,
      windElongation: 2.3,
      fireRadius: 0.46,
      edgeRoughness: 0.34,
      intensity: 1.08,
      regrowth: 0.28,
    },
    meta: {
      id: 'aerial',
      name: 'Aerial photography',
      sourceType: 'aerial',
      sensor: 'Fixed-wing MicaSense RedEdge, 5 m resampled',
      acquired: 'Post-fire 2024-08-21',
      region: 'Head of the fire — 1.25 km²',
      notes:
        'Flown four days after containment. Fine enough to resolve the unburned ' +
        'riparian corridor and individual crown-scorch patches.',
    },
  },
  {
    id: 'lidar',
    name: 'Lidar & field plots',
    summary: 'Airborne lidar terrain with severity calibrated to CBI field plots, 2 m cells.',
    recipe: {
      seed: 4419,
      width: 200,
      height: 200,
      cellSize: 2,
      baseElevation: 1150,
      relief: 70,
      terrainFrequency: 2.4,
      ignition: { x: 0.5, y: 0.68 },
      windDirectionDeg: 350,
      windElongation: 1.5,
      fireRadius: 0.42,
      edgeRoughness: 0.28,
      intensity: 1.25,
      regrowth: 0.18,
    },
    meta: {
      id: 'lidar',
      name: 'Lidar & field plots',
      sourceType: 'lidar',
      sensor: 'Airborne lidar DTM 2 m + 34 CBI plots',
      acquired: 'Post-fire 2024-09-04',
      region: 'Upper basin — 0.16 km²',
      notes:
        'Bare-earth terrain from lidar returns, severity interpolated from ' +
        'Composite Burn Index plots. The reference product for this fire.',
    },
  },
];

const cache = new Map<string, BurnScene>();

/** Builds (and memoises) a sample scene; generation costs ~50 ms per scene. */
export function loadSample(id: string): BurnScene {
  const cached = cache.get(id);
  if (cached) return cached;
  const definition = SAMPLES.find((s) => s.id === id);
  if (!definition) throw new RangeError(`unknown sample: ${id}`);
  const scene = generateScene(definition.recipe, definition.meta);
  cache.set(id, scene);
  return scene;
}
