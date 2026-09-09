import type { Grid } from './grid';
import { cellAreaHectares } from './grid';

/**
 * Burn severity is expressed as dNBR (differenced Normalised Burn Ratio): the
 * pre-fire NBR minus the post-fire NBR. The class breaks below are the USGS /
 * UN-SPIDER standard table, which is what makes a map produced here comparable
 * with published burn severity products rather than a pretty gradient.
 */
export interface SeverityClass {
  readonly key: SeverityKey;
  readonly label: string;
  /** Inclusive lower bound of the dNBR range. */
  readonly min: number;
  /** Exclusive upper bound of the dNBR range. */
  readonly max: number;
  /** Hex colour used for both the 3D surface and the legend. */
  readonly color: string;
  readonly description: string;
}

export type SeverityKey =
  'regrowth-high' | 'regrowth-low' | 'unburned' | 'low' | 'moderate-low' | 'moderate-high' | 'high';

export const SEVERITY_CLASSES: readonly SeverityClass[] = [
  {
    key: 'regrowth-high',
    label: 'High regrowth',
    min: -Infinity,
    max: -0.25,
    color: '#1c6b3c',
    description: 'Canopy denser than before the fire — vigorous post-fire recovery.',
  },
  {
    key: 'regrowth-low',
    label: 'Low regrowth',
    min: -0.25,
    max: -0.1,
    color: '#4f9d5d',
    description: 'Slight greening relative to the pre-fire scene.',
  },
  {
    key: 'unburned',
    label: 'Unburned',
    min: -0.1,
    max: 0.1,
    color: '#7f9885',
    description: 'No detectable change in the burn ratio.',
  },
  {
    key: 'low',
    label: 'Low severity',
    min: 0.1,
    max: 0.27,
    color: '#f2d264',
    description: 'Surface fuels scorched, canopy largely intact.',
  },
  {
    key: 'moderate-low',
    label: 'Moderate-low',
    min: 0.27,
    max: 0.44,
    color: '#f0a03c',
    description: 'Understorey consumed, patchy canopy scorch.',
  },
  {
    key: 'moderate-high',
    label: 'Moderate-high',
    min: 0.44,
    max: 0.66,
    color: '#e05a2b',
    description: 'Most canopy scorched, heavy consumption of surface fuels.',
  },
  {
    key: 'high',
    label: 'High severity',
    min: 0.66,
    max: Infinity,
    color: '#8c1d1d',
    description: 'Stand replacing — canopy consumed, mineral soil exposed.',
  },
];

const CLASS_BY_KEY = new Map(SEVERITY_CLASSES.map((c) => [c.key, c]));

export function severityClassFor(dnbr: number): SeverityClass {
  // NaN sorts into "unburned" rather than throwing: real rasters carry nodata
  // holes, and a hole should read as "nothing measured here", not crash a map.
  if (!Number.isFinite(dnbr)) return CLASS_BY_KEY.get('unburned')!;
  for (const cls of SEVERITY_CLASSES) {
    if (dnbr >= cls.min && dnbr < cls.max) return cls;
  }
  return SEVERITY_CLASSES[SEVERITY_CLASSES.length - 1]!;
}

export function severityClassByKey(key: SeverityKey): SeverityClass {
  const cls = CLASS_BY_KEY.get(key);
  if (!cls) throw new RangeError(`unknown severity class: ${key}`);
  return cls;
}

/** Burned area is everything at or above the "low severity" break. */
export const BURNED_THRESHOLD = 0.1;

export interface SeverityStat {
  readonly cls: SeverityClass;
  readonly cells: number;
  readonly hectares: number;
  /** Share of the whole scene, 0..1. */
  readonly fraction: number;
}

export interface SeveritySummary {
  readonly stats: readonly SeverityStat[];
  readonly totalCells: number;
  readonly totalHectares: number;
  readonly burnedHectares: number;
  readonly meanDnbr: number;
}

/** Per-class cell counts and areas — the numbers shown beside the legend. */
export function summariseSeverity(dnbr: Grid): SeveritySummary {
  const counts = new Map<SeverityKey, number>(SEVERITY_CLASSES.map((c) => [c.key, 0]));
  let sum = 0;
  for (const value of dnbr.data) {
    const cls = severityClassFor(value);
    counts.set(cls.key, (counts.get(cls.key) ?? 0) + 1);
    sum += Number.isFinite(value) ? value : 0;
  }

  const totalCells = dnbr.data.length;
  const cellHa = cellAreaHectares(dnbr);
  const stats = SEVERITY_CLASSES.map((cls) => {
    const cells = counts.get(cls.key) ?? 0;
    return {
      cls,
      cells,
      hectares: cells * cellHa,
      fraction: totalCells > 0 ? cells / totalCells : 0,
    };
  });

  const burnedHectares = stats
    .filter((s) => s.cls.min >= BURNED_THRESHOLD)
    .reduce((acc, s) => acc + s.hectares, 0);

  return {
    stats,
    totalCells,
    totalHectares: totalCells * cellHa,
    burnedHectares,
    meanDnbr: totalCells > 0 ? sum / totalCells : 0,
  };
}
