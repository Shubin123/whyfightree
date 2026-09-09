import * as THREE from 'three';
import type { BurnScene } from '../core/burnModel';
import { marchingSquares, type Segment } from '../core/contour';
import { gridRange, type Grid } from '../core/grid';
import { dnbrRamp, elevationRamp, imageryColor, SEVERITY_RGB, type Rgb } from '../core/palette';
import { valueNoise2D } from '../core/noise';
import { BURNED_THRESHOLD, severityClassFor, type SeverityKey } from '../core/severity';

export type ColorMode = 'severity' | 'dnbr' | 'elevation' | 'imagery';

/** Longest horizontal side of any scene, in world units. Keeps framing stable. */
const WORLD_SIZE = 200;
const DIMMED: Rgb = [0.16, 0.17, 0.18];

export interface SurfaceOptions {
  readonly colorMode: ColorMode;
  readonly exaggeration: number;
  readonly visibleClasses: ReadonlySet<SeverityKey>;
  readonly showPerimeter: boolean;
}

function mixToward(color: Rgb, target: Rgb): Rgb {
  return [
    color[0] * 0.25 + target[0] * 0.75,
    color[1] * 0.25 + target[1] * 0.75,
    color[2] * 0.25 + target[2] * 0.75,
  ];
}

/**
 * Vertex indices tracing the border of the grid clockwise, with the first
 * vertex repeated at the end so the ring closes.
 */
function borderIndices(width: number, height: number): number[] {
  const ring: number[] = [];
  for (let x = 0; x < width; x += 1) ring.push(x);
  for (let y = 1; y < height; y += 1) ring.push(y * width + width - 1);
  for (let x = width - 2; x >= 0; x -= 1) ring.push((height - 1) * width + x);
  for (let y = height - 2; y >= 1; y -= 1) ring.push(y * width);
  ring.push(ring[0]!);
  return ring;
}

/**
 * The scene's 3D surface: one indexed mesh with per-vertex colours, plus the
 * fire perimeter drawn as an overlay. Colour and height are updated in place on
 * the existing buffers — rebuilding the geometry on every slider tick would
 * drop frames on the 256 x 256 satellite scene.
 */
export class TerrainSurface {
  readonly object = new THREE.Group();

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly mesh: THREE.Mesh;
  private readonly perimeter: THREE.LineSegments;
  private readonly perimeterSegments: readonly Segment[];
  private readonly skirt: THREE.Mesh;
  private readonly skirtIndices: readonly number[];
  private readonly elevationRange: { min: number; max: number };
  private readonly worldPerMetre: number;
  private options: SurfaceOptions;

  constructor(
    readonly scene: BurnScene,
    options: SurfaceOptions,
  ) {
    this.options = options;
    this.elevationRange = gridRange(scene.elevation);

    const { width, height, cellSize } = scene.elevation;
    const longest = Math.max(width - 1, height - 1) * cellSize;
    this.worldPerMetre = WORLD_SIZE / longest;

    this.geometry = this.buildGeometry();
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.02,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.object.add(this.mesh);

    this.skirtIndices = borderIndices(width, height);
    this.skirt = this.buildSkirt();
    this.object.add(this.skirt);

    this.perimeterSegments = marchingSquares(scene.dnbr, BURNED_THRESHOLD);
    this.perimeter = this.buildPerimeter();
    this.object.add(this.perimeter);

    this.applyHeights();
    this.applyColors();
  }

  /** The mesh's horizontal footprint in world units. */
  get extentWorld(): { x: number; z: number } {
    const { width, height, cellSize } = this.scene.elevation;
    return {
      x: (width - 1) * cellSize * this.worldPerMetre,
      z: (height - 1) * cellSize * this.worldPerMetre,
    };
  }

  update(options: Partial<SurfaceOptions>): void {
    const next = { ...this.options, ...options };
    const heightsChanged = next.exaggeration !== this.options.exaggeration;
    const colorsChanged =
      next.colorMode !== this.options.colorMode ||
      next.visibleClasses !== this.options.visibleClasses;
    this.options = next;

    if (heightsChanged) {
      this.applyHeights();
      this.applySkirtHeights();
      this.applyPerimeterHeights();
    }
    if (colorsChanged) this.applyColors();
    this.perimeter.visible = next.showPerimeter;
  }

  /** Converts a world-space hit into fractional grid coordinates. */
  worldToGrid(point: THREE.Vector3): { x: number; y: number } {
    const extent = this.extentWorld;
    const { width, height } = this.scene.elevation;
    return {
      x: ((point.x + extent.x / 2) / extent.x) * (width - 1),
      y: ((point.z + extent.z / 2) / extent.z) * (height - 1),
    };
  }

  raycastTarget(): THREE.Object3D {
    return this.mesh;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.skirt.geometry.dispose();
    (this.skirt.material as THREE.Material).dispose();
    this.perimeter.geometry.dispose();
    (this.perimeter.material as THREE.Material).dispose();
    this.object.clear();
  }

  private buildGeometry(): THREE.BufferGeometry {
    const { width, height } = this.scene.elevation;
    const count = width * height;
    const geometry = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const extent = this.extentWorld;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        positions[i * 3] = (x / (width - 1) - 0.5) * extent.x;
        positions[i * 3 + 2] = (y / (height - 1) - 0.5) * extent.z;
        uvs[i * 2] = x / (width - 1);
        uvs[i * 2 + 1] = 1 - y / (height - 1);
      }
    }

    const indices = new Uint32Array((width - 1) * (height - 1) * 6);
    let cursor = 0;
    for (let y = 0; y < height - 1; y += 1) {
      for (let x = 0; x < width - 1; x += 1) {
        const a = y * width + x;
        const b = a + 1;
        const c = a + width;
        const d = c + 1;
        indices[cursor++] = a;
        indices[cursor++] = c;
        indices[cursor++] = b;
        indices[cursor++] = b;
        indices[cursor++] = c;
        indices[cursor++] = d;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    return geometry;
  }

  private heightAt(index: number): number {
    const metres = this.scene.elevation.data[index] ?? 0;
    return (metres - this.elevationRange.min) * this.worldPerMetre * this.options.exaggeration;
  }

  /**
   * A wall dropped from the border of the terrain to a flat base, so the model
   * reads as a block of ground cut from the landscape instead of a floating
   * sheet with a visibly hollow underside.
   */
  private buildSkirt(): THREE.Mesh {
    const ring = this.skirtIndices.length;
    const positions = new Float32Array(ring * 2 * 3);
    const colors = new Float32Array(ring * 2 * 3);
    const indices = new Uint32Array((ring - 1) * 6);

    const top = new THREE.Color().setStyle('#7d7062');
    const bottom = new THREE.Color().setStyle('#3b342d');
    for (let i = 0; i < ring; i += 1) {
      colors.set([top.r, top.g, top.b], i * 6);
      colors.set([bottom.r, bottom.g, bottom.b], i * 6 + 3);
    }

    let cursor = 0;
    for (let i = 0; i < ring - 1; i += 1) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices[cursor++] = a;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = d;
      indices[cursor++] = c;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    // DoubleSide sidesteps winding differences between the four edges; the base
    // is never visible anyway because the camera is clamped above the horizon.
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    this.writeSkirt(positions);
    return mesh;
  }

  private applySkirtHeights(): void {
    const attribute = this.skirt.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.writeSkirt(attribute.array as Float32Array);
    attribute.needsUpdate = true;
    this.skirt.geometry.computeVertexNormals();
    this.skirt.geometry.computeBoundingSphere();
  }

  private writeSkirt(positions: Float32Array): void {
    const surface = this.geometry.getAttribute('position').array as Float32Array;
    const depth = 4 + this.options.exaggeration * 1.5;
    this.skirtIndices.forEach((vertex, i) => {
      const x = surface[vertex * 3] ?? 0;
      const z = surface[vertex * 3 + 2] ?? 0;
      const y = this.heightAt(vertex);
      positions.set([x, y, z], i * 6);
      positions.set([x, -depth, z], i * 6 + 3);
    });
  }

  private applyHeights(): void {
    const attribute = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const positions = attribute.array as Float32Array;
    for (let i = 0; i < this.scene.elevation.data.length; i += 1) {
      positions[i * 3 + 1] = this.heightAt(i);
    }
    attribute.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }

  private applyColors(): void {
    const attribute = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const colors = attribute.array as Float32Array;
    const { dnbr, elevation } = this.scene;
    const span = Math.max(1e-6, this.elevationRange.max - this.elevationRange.min);
    const scratch = new THREE.Color();

    for (let i = 0; i < dnbr.data.length; i += 1) {
      const value = dnbr.data[i] ?? 0;
      const elevationNorm = ((elevation.data[i] ?? 0) - this.elevationRange.min) / span;
      const rgb = this.colorFor(i, value, elevationNorm, dnbr);
      // setRGB with an explicit colour space lets three convert into its linear
      // working space; writing sRGB straight into the buffer washes the map out.
      scratch.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      colors[i * 3] = scratch.r;
      colors[i * 3 + 1] = scratch.g;
      colors[i * 3 + 2] = scratch.b;
    }
    attribute.needsUpdate = true;
  }

  private colorFor(index: number, value: number, elevationNorm: number, dnbr: Grid): Rgb {
    const { colorMode, visibleClasses } = this.options;
    if (colorMode === 'elevation') return elevationRamp(elevationNorm);

    const cls = severityClassFor(value);
    const visible = visibleClasses.has(cls.key);

    if (colorMode === 'imagery') {
      const x = index % dnbr.width;
      const y = Math.floor(index / dnbr.width);
      const fuel = valueNoise2D(17, x * 0.08, y * 0.08);
      const color = imageryColor(value, elevationNorm, fuel);
      return visible ? color : mixToward(color, DIMMED);
    }
    if (colorMode === 'dnbr') {
      const color = dnbrRamp(value);
      return visible ? color : mixToward(color, DIMMED);
    }
    return visible ? (SEVERITY_RGB.get(cls.key) ?? DIMMED) : DIMMED;
  }

  private buildPerimeter(): THREE.LineSegments {
    const positions = new Float32Array(this.perimeterSegments.length * 6);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.writePerimeter(positions);

    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setStyle('#f4f1ea'),
      transparent: true,
      opacity: 0.8,
    });
    const lines = new THREE.LineSegments(geometry, material);
    lines.visible = this.options.showPerimeter;
    lines.renderOrder = 2;
    return lines;
  }

  private applyPerimeterHeights(): void {
    const attribute = this.perimeter.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.writePerimeter(attribute.array as Float32Array);
    attribute.needsUpdate = true;
    this.perimeter.geometry.computeBoundingSphere();
  }

  private writePerimeter(positions: Float32Array): void {
    const extent = this.extentWorld;
    const { width, height } = this.scene.elevation;
    // Lift the line clear of the surface so it is not lost to z-fighting.
    const lift = 0.4 + this.options.exaggeration * 0.25;

    this.perimeterSegments.forEach((segment, i) => {
      const write = (offset: number, gx: number, gy: number) => {
        const ix = Math.min(width - 1, Math.max(0, Math.round(gx)));
        const iy = Math.min(height - 1, Math.max(0, Math.round(gy)));
        positions[offset] = (gx / (width - 1) - 0.5) * extent.x;
        positions[offset + 1] = this.heightAt(iy * width + ix) + lift;
        positions[offset + 2] = (gy / (height - 1) - 0.5) * extent.z;
      };
      write(i * 6, segment.x1, segment.y1);
      write(i * 6 + 3, segment.x2, segment.y2);
    });
  }
}
