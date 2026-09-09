/**
 * Regenerates `public/sample.burnmap.json`, the download offered in the panel
 * as a format reference. Kept small (32 x 32) so a reader can open it and see
 * the whole structure at once.
 *
 *   npx vite-node scripts/make-template.ts
 */
import { writeFileSync } from 'node:fs';
import { generateScene } from '../src/core/burnModel';
import { toBurnMapJson } from '../src/data/export';

const scene = generateScene(
  {
    seed: 1312,
    width: 32,
    height: 32,
    cellSize: 30,
    baseElevation: 640,
    relief: 260,
    terrainFrequency: 2.6,
    ignition: { x: 0.38, y: 0.7 },
    windDirectionDeg: 40,
    windElongation: 1.8,
    fireRadius: 0.4,
    edgeRoughness: 0.3,
    intensity: 1,
    regrowth: 0.3,
  },
  {
    id: 'template',
    name: 'Format template',
    sourceType: 'satellite',
    sensor: 'Example — replace with your own sensor',
    acquired: 'Pre-fire 2024-07-02 · Post-fire 2024-08-17',
    region: '32 × 32 cells at 30 m (0.92 km²)',
    notes:
      'Minimal burnmap/v1 example. "dnbr" and "elevation" are row-major arrays ' +
      'of width × height values; elevation is metres, dnbr is unitless.',
  },
);

const target = new URL('../public/sample.burnmap.json', import.meta.url);
writeFileSync(target, `${JSON.stringify(JSON.parse(toBurnMapJson(scene)), null, 1)}\n`);
console.log(`wrote ${target.pathname}`);
