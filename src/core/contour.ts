import type { Grid } from './grid';

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Where a threshold crossing falls between two samples, linearly. */
function lerpEdge(a: number, b: number, threshold: number): number {
  const denom = b - a;
  if (Math.abs(denom) < 1e-9) return 0.5;
  return Math.min(1, Math.max(0, (threshold - a) / denom));
}

/**
 * Marching squares over a grid, returning the iso-line as unordered segments in
 * grid coordinates. Used to draw the fire perimeter — the dNBR 0.1 crossing —
 * as a crisp line on top of the shaded surface, which is far easier to read
 * than a colour boundary alone.
 */
export function marchingSquares(grid: Grid, threshold: number): Segment[] {
  const { width, height, data } = grid;
  const segments: Segment[] = [];

  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const tl = data[y * width + x] ?? 0;
      const tr = data[y * width + x + 1] ?? 0;
      const br = data[(y + 1) * width + x + 1] ?? 0;
      const bl = data[(y + 1) * width + x] ?? 0;

      let code = 0;
      if (tl >= threshold) code |= 8;
      if (tr >= threshold) code |= 4;
      if (br >= threshold) code |= 2;
      if (bl >= threshold) code |= 1;
      if (code === 0 || code === 15) continue;

      const top = { x: x + lerpEdge(tl, tr, threshold), y };
      const right = { x: x + 1, y: y + lerpEdge(tr, br, threshold) };
      const bottom = { x: x + lerpEdge(bl, br, threshold), y: y + 1 };
      const left = { x, y: y + lerpEdge(tl, bl, threshold) };

      const push = (a: { x: number; y: number }, b: { x: number; y: number }) =>
        segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });

      switch (code) {
        case 1:
        case 14:
          push(left, bottom);
          break;
        case 2:
        case 13:
          push(bottom, right);
          break;
        case 3:
        case 12:
          push(left, right);
          break;
        case 4:
        case 11:
          push(top, right);
          break;
        case 6:
        case 9:
          push(top, bottom);
          break;
        case 7:
        case 8:
          push(left, top);
          break;
        // Saddles: the cell centre decides which pair of corners connects.
        case 5:
        case 10: {
          const center = (tl + tr + br + bl) / 4;
          const centerInside = center >= threshold;
          if ((code === 5) === centerInside) {
            push(left, top);
            push(bottom, right);
          } else {
            push(left, bottom);
            push(top, right);
          }
          break;
        }
      }
    }
  }
  return segments;
}
