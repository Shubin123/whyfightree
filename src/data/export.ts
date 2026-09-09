import type { BurnScene } from '../core/burnModel';

/** Decimals kept when exporting; more than this is noise at any sensor's precision. */
const DNBR_PRECISION = 4;
const ELEVATION_PRECISION = 2;

function round(values: Float32Array, decimals: number): number[] {
  const factor = 10 ** decimals;
  return Array.from(values, (v) => Math.round(v * factor) / factor);
}

/**
 * Serialises a scene to the same `burnmap/v1` format the importer reads, so a
 * generated sample can be exported, edited in another tool, and loaded back.
 */
export function toBurnMapJson(scene: BurnScene): string {
  const { elevation, dnbr } = scene;
  return JSON.stringify({
    format: 'burnmap/v1',
    name: scene.name,
    sourceType: scene.sourceType,
    sensor: scene.sensor,
    acquired: scene.acquired,
    region: scene.region,
    notes: scene.notes,
    width: dnbr.width,
    height: dnbr.height,
    cellSize: dnbr.cellSize,
    elevation: round(elevation.data, ELEVATION_PRECISION),
    dnbr: round(dnbr.data, DNBR_PRECISION),
  });
}

/** A file name that sorts well and says what the raster is. */
export function exportFileName(scene: BurnScene, extension: string): string {
  const slug = scene.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `whyfightree-${slug || 'scene'}.${extension}`;
}
