import { SEVERITY_CLASSES } from './severity';

/** An sRGB colour with components in 0..1. */
export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new RangeError(`not a hex colour: ${hex}`);
  const int = Number.parseInt(full, 16);
  return [((int >> 16) & 255) / 255, ((int >> 8) & 255) / 255, (int & 255) / 255];
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

interface Stop {
  readonly at: number;
  readonly color: Rgb;
}

function rampAt(stops: readonly Stop[], value: number): Rgb {
  const first = stops[0]!;
  if (value <= first.at) return first.color;
  for (let i = 1; i < stops.length; i += 1) {
    const prev = stops[i - 1]!;
    const next = stops[i]!;
    if (value <= next.at) {
      return mixRgb(prev.color, next.color, (value - prev.at) / (next.at - prev.at));
    }
  }
  return stops[stops.length - 1]!.color;
}

/**
 * Continuous dNBR ramp. The stops sit on the class breaks, so the smooth ramp
 * and the classified view agree about where a boundary is — switching between
 * them should not move a feature.
 */
const DNBR_STOPS: readonly Stop[] = [
  { at: -0.5, color: hexToRgb('#134e2e') },
  { at: -0.1, color: hexToRgb('#6fae72') },
  { at: 0.1, color: hexToRgb('#9fb3a4') },
  { at: 0.27, color: hexToRgb('#f2d264') },
  { at: 0.44, color: hexToRgb('#f0a03c') },
  { at: 0.66, color: hexToRgb('#e05a2b') },
  { at: 1.0, color: hexToRgb('#8c1d1d') },
  { at: 1.3, color: hexToRgb('#4a0d10') },
];

export function dnbrRamp(value: number): Rgb {
  return rampAt(DNBR_STOPS, Number.isFinite(value) ? value : 0);
}

/** Hypsometric tint, from valley greens through rock to snow. */
const ELEVATION_STOPS: readonly Stop[] = [
  { at: 0, color: hexToRgb('#2f5d3f') },
  { at: 0.35, color: hexToRgb('#8a9a52') },
  { at: 0.6, color: hexToRgb('#c2a26b') },
  { at: 0.82, color: hexToRgb('#8d7259') },
  { at: 1, color: hexToRgb('#e8e6e1') },
];

export function elevationRamp(normalised: number): Rgb {
  return rampAt(ELEVATION_STOPS, normalised);
}

const CANOPY = hexToRgb('#3d6b3a');
const MEADOW = hexToRgb('#7d8f4a');
const ASH = hexToRgb('#211d1b');
const SCORCH = hexToRgb('#6b4a34');

/**
 * A plausible post-fire natural-colour view: unburned canopy varies with
 * elevation, and burned ground darkens towards ash as severity climbs.
 */
export function imageryColor(dnbr: number, elevationNorm: number, fuel: number): Rgb {
  const vegetation = mixRgb(CANOPY, MEADOW, Math.min(1, elevationNorm * 0.9 + fuel * 0.2));
  if (dnbr <= 0.1) return vegetation;
  const burn = Math.min(1, (dnbr - 0.1) / 0.8);
  return mixRgb(mixRgb(vegetation, SCORCH, Math.min(1, burn * 1.8)), ASH, burn * 0.85);
}

export const SEVERITY_RGB: ReadonlyMap<string, Rgb> = new Map(
  SEVERITY_CLASSES.map((cls) => [cls.key, hexToRgb(cls.color)]),
);
