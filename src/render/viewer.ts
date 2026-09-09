import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TerrainSurface } from './terrain';

export interface HoverSample {
  /** Fractional grid coordinates of the surface point under the pointer. */
  readonly gridX: number;
  readonly gridY: number;
}

/**
 * Owns the WebGL context, camera and lighting. The surface is swapped in and
 * out of this viewer as the user changes data source, so nothing here knows
 * about severity classes — it only knows how to light and frame a terrain.
 */
export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private readonly sun: THREE.DirectionalLight;
  /** Distance the sun is parked from the origin; also bounds its shadow frustum. */
  private readonly sunRadius = 400;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly resizeObserver: ResizeObserver;
  private surface: TerrainSurface | null = null;
  private hoverHandler: ((hit: HoverSample | null) => void) | null = null;
  private frameHandle = 0;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color().setStyle('#0d1113');
    this.scene.fog = new THREE.Fog(new THREE.Color().setStyle('#0d1113'), 320, 780);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 3000);
    this.camera.position.set(150, 130, 190);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 30;
    this.controls.maxDistance = 700;

    const hemisphere = new THREE.HemisphereLight(
      new THREE.Color().setStyle('#9fb6c8'),
      new THREE.Color().setStyle('#3a3128'),
      0.85,
    );
    this.scene.add(hemisphere);

    this.sun = new THREE.DirectionalLight(new THREE.Color().setStyle('#fff2dc'), 2.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    // These bounds are re-fitted to each scene in frame().
    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -200;
    shadowCamera.right = 200;
    shadowCamera.top = 200;
    shadowCamera.bottom = -200;
    shadowCamera.near = 1;
    shadowCamera.far = 900;
    this.sun.shadow.bias = -0.0006;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.setSunAngles(315, 42);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerleave', this.onPointerLeave);
  }

  setSurface(surface: TerrainSurface): void {
    if (this.surface) {
      this.scene.remove(this.surface.object);
      this.surface.dispose();
    }
    this.surface = surface;
    this.scene.add(surface.object);
    this.frame();
  }

  /** Places the sun by compass bearing and altitude, both in degrees. */
  setSunAngles(azimuthDeg: number, elevationDeg: number): void {
    const azimuth = (azimuthDeg * Math.PI) / 180;
    const elevation = (Math.max(3, elevationDeg) * Math.PI) / 180;
    const radius = this.sunRadius;
    this.sun.position.set(
      radius * Math.cos(elevation) * Math.sin(azimuth),
      radius * Math.sin(elevation),
      radius * Math.cos(elevation) * Math.cos(azimuth),
    );
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
  }

  onHover(handler: (hit: HoverSample | null) => void): void {
    this.hoverHandler = handler;
  }

  /**
   * Points the camera at the current surface from a readable three-quarter
   * view. Framing is derived from the surface's bounding box rather than its
   * footprint, because a small, steep scene can be taller than it is wide —
   * fitting to the footprint alone puts the camera inside the terrain.
   */
  frame(): void {
    if (!this.surface) return;
    const box = new THREE.Box3().setFromObject(this.surface.object);
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const distance = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 0.92;

    this.camera.position
      .copy(center)
      .addScaledVector(new THREE.Vector3(0.62, 0.52, 0.85).normalize(), distance);
    this.camera.near = Math.max(0.1, distance / 200);
    this.camera.far = distance * 12;
    this.camera.updateProjectionMatrix();

    this.controls.target.copy(center);
    this.controls.minDistance = radius * 0.25;
    this.controls.maxDistance = distance * 4;
    this.controls.update();

    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = distance * 0.75;
      this.scene.fog.far = distance * 2.6;
    }

    // Keep the shadow frustum just big enough for the model, so the 2048 map
    // is spent on the terrain rather than empty space around it.
    const shadowCamera = this.sun.shadow.camera;
    const half = radius * 1.15;
    shadowCamera.left = -half;
    shadowCamera.right = half;
    shadowCamera.top = half;
    shadowCamera.bottom = -half;
    shadowCamera.far = this.sunRadius + radius * 2;
    shadowCamera.updateProjectionMatrix();
  }

  start(): void {
    const loop = () => {
      this.frameHandle = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop(): void {
    cancelAnimationFrame(this.frameHandle);
  }

  /** Renders once and returns the frame as a PNG data URL. */
  captureImage(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerleave', this.onPointerLeave);
    this.surface?.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private resize(): void {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.surface || !this.hoverHandler) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.surface.raycastTarget(), false);
    const first = hits[0];
    if (!first) {
      this.hoverHandler(null);
      return;
    }
    const grid = this.surface.worldToGrid(first.point);
    this.hoverHandler({ gridX: grid.x, gridY: grid.y });
  };

  private readonly onPointerLeave = (): void => {
    this.hoverHandler?.(null);
  };
}
