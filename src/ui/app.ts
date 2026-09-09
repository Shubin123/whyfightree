import type { BurnScene } from '../core/burnModel';
import { sampleBilinear } from '../core/grid';
import {
  SEVERITY_CLASSES,
  severityClassFor,
  summariseSeverity,
  type SeverityKey,
} from '../core/severity';
import { exportFileName, toBurnMapJson } from '../data/export';
import { ImportError, parseImportedFile } from '../data/import';
import { loadSample, SAMPLES } from '../data/samples';
import { TerrainSurface, type ColorMode, type SurfaceOptions } from '../render/terrain';
import { Viewer } from '../render/viewer';

const COLOR_MODES: readonly { value: ColorMode; label: string }[] = [
  { value: 'severity', label: 'Severity class' },
  { value: 'dnbr', label: 'dNBR ramp' },
  { value: 'elevation', label: 'Elevation' },
  { value: 'imagery', label: 'Post-fire imagery' },
];

const ALL_CLASSES: ReadonlySet<SeverityKey> = new Set(SEVERITY_CLASSES.map((c) => c.key));

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

function formatArea(hectares: number): string {
  if (hectares >= 1000) return `${(hectares / 100).toFixed(1)} km²`;
  if (hectares >= 10) return `${hectares.toFixed(0)} ha`;
  return `${hectares.toFixed(1)} ha`;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * Wires the control panel to the renderer. The app keeps one `SurfaceOptions`
 * object as the single source of truth and pushes deltas into the surface, so
 * the DOM never has to be read back to work out the current state.
 */
export class App {
  private readonly viewer: Viewer;
  private surface: TerrainSurface | null = null;
  private importedScene: BurnScene | null = null;
  private options: SurfaceOptions = {
    colorMode: 'severity',
    exaggeration: 2,
    visibleClasses: ALL_CLASSES,
    showPerimeter: true,
  };

  private readonly sourceSelect = el<HTMLSelectElement>('source-select');
  private readonly legendList = el<HTMLUListElement>('legend');
  private readonly hud = el<HTMLDivElement>('hud');
  private readonly loading = el<HTMLDivElement>('loading');
  private readonly dropzone = el<HTMLDivElement>('dropzone');
  private readonly importError = el<HTMLParagraphElement>('import-error');

  constructor() {
    this.viewer = new Viewer(el<HTMLElement>('viewport'));
    this.viewer.onHover((hit) => this.renderHud(hit));
    this.buildSourceOptions();
    this.buildColorModes();
    this.bindControls();
    this.bindDropTarget();
    this.viewer.start();
  }

  /** Loads a sample by id, yielding a frame first so the spinner can paint. */
  async selectSample(id: string): Promise<void> {
    this.loading.hidden = false;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const scene = id === 'imported' ? this.importedScene : loadSample(id);
    if (scene) this.showScene(scene);
    this.loading.hidden = true;
  }

  private showScene(scene: BurnScene): void {
    this.surface = new TerrainSurface(scene, this.options);
    this.viewer.setSurface(this.surface);
    this.renderMeta(scene);
    this.renderLegend(scene);
  }

  private updateOptions(patch: Partial<SurfaceOptions>): void {
    this.options = { ...this.options, ...patch };
    this.surface?.update(patch);
  }

  private buildSourceOptions(): void {
    this.sourceSelect.replaceChildren(
      ...SAMPLES.map((sample) => new Option(sample.name, sample.id)),
    );
    if (this.importedScene) {
      this.sourceSelect.append(new Option(this.importedScene.name, 'imported'));
    }
  }

  private buildColorModes(): void {
    const container = el<HTMLDivElement>('color-mode');
    container.replaceChildren(
      ...COLOR_MODES.map(({ value, label }) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.dataset.mode = value;
        button.setAttribute('aria-pressed', String(value === this.options.colorMode));
        button.addEventListener('click', () => {
          this.updateOptions({ colorMode: value });
          container.querySelectorAll('button').forEach((other) => {
            other.setAttribute('aria-pressed', String(other.dataset.mode === value));
          });
        });
        return button;
      }),
    );
  }

  private bindControls(): void {
    this.sourceSelect.addEventListener('change', () => {
      void this.selectSample(this.sourceSelect.value);
    });

    const exaggeration = el<HTMLInputElement>('exaggeration');
    const exaggerationValue = el<HTMLOutputElement>('exaggeration-value');
    exaggeration.addEventListener('input', () => {
      const value = Number(exaggeration.value);
      exaggerationValue.textContent = `${value.toFixed(1)}×`;
      this.updateOptions({ exaggeration: value });
    });

    const azimuth = el<HTMLInputElement>('sun-azimuth');
    const azimuthValue = el<HTMLOutputElement>('sun-azimuth-value');
    const altitude = el<HTMLInputElement>('sun-altitude');
    const altitudeValue = el<HTMLOutputElement>('sun-altitude-value');
    const applySun = () => {
      azimuthValue.textContent = `${azimuth.value}°`;
      altitudeValue.textContent = `${altitude.value}°`;
      this.viewer.setSunAngles(Number(azimuth.value), Number(altitude.value));
    };
    azimuth.addEventListener('input', applySun);
    altitude.addEventListener('input', applySun);

    el<HTMLInputElement>('show-perimeter').addEventListener('change', (event) => {
      this.updateOptions({ showPerimeter: (event.target as HTMLInputElement).checked });
    });

    el<HTMLButtonElement>('reset-view').addEventListener('click', () => this.viewer.frame());
    el<HTMLButtonElement>('export-png').addEventListener('click', () => this.exportPng());
    el<HTMLButtonElement>('export-json').addEventListener('click', () => this.exportJson());

    el<HTMLInputElement>('import-input').addEventListener('change', (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (file) void this.importFile(file);
      input.value = '';
    });

    window.addEventListener('keydown', (event) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (event.key === 'r') this.viewer.frame();
      if (event.key === 'p') {
        const toggle = el<HTMLInputElement>('show-perimeter');
        toggle.checked = !toggle.checked;
        this.updateOptions({ showPerimeter: toggle.checked });
      }
    });
  }

  private bindDropTarget(): void {
    const viewport = el<HTMLElement>('viewport');
    let depth = 0;

    viewport.addEventListener('dragenter', (event) => {
      event.preventDefault();
      depth += 1;
      this.dropzone.hidden = false;
    });
    viewport.addEventListener('dragover', (event) => event.preventDefault());
    viewport.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.dropzone.hidden = true;
    });
    viewport.addEventListener('drop', (event) => {
      event.preventDefault();
      depth = 0;
      this.dropzone.hidden = true;
      const file = event.dataTransfer?.files?.[0];
      if (file) void this.importFile(file);
    });
  }

  private async importFile(file: File): Promise<void> {
    this.importError.hidden = true;
    this.loading.hidden = false;
    try {
      const text = await file.text();
      const scene = parseImportedFile(file.name, text);
      this.importedScene = scene;
      this.buildSourceOptions();
      this.sourceSelect.value = 'imported';
      this.showScene(scene);
    } catch (error) {
      const message = error instanceof ImportError ? error.message : `Could not read ${file.name}.`;
      this.importError.textContent = message;
      this.importError.hidden = false;
    } finally {
      this.loading.hidden = true;
    }
  }

  private exportPng(): void {
    if (!this.surface) return;
    const anchor = document.createElement('a');
    anchor.href = this.viewer.captureImage();
    anchor.download = exportFileName(this.surface.scene, 'png');
    anchor.click();
  }

  private exportJson(): void {
    if (!this.surface) return;
    const blob = new Blob([toBurnMapJson(this.surface.scene)], { type: 'application/json' });
    downloadBlob(blob, exportFileName(this.surface.scene, 'burnmap.json'));
  }

  private renderMeta(scene: BurnScene): void {
    const summary = SAMPLES.find((s) => s.id === scene.id)?.summary;
    el<HTMLParagraphElement>('source-summary').textContent = summary ?? scene.notes;

    const rows: [string, string][] = [
      ['Sensor', scene.sensor],
      ['Acquired', scene.acquired],
      ['Extent', scene.region],
    ];
    const meta = el<HTMLDListElement>('source-meta');
    meta.replaceChildren();
    for (const [term, value] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      meta.append(dt, dd);
    }
    if (summary) {
      const notes = document.createElement('dd');
      notes.className = 'meta__notes';
      notes.textContent = scene.notes;
      meta.append(notes);
    }
  }

  private renderLegend(scene: BurnScene): void {
    const summary = summariseSeverity(scene.dnbr);

    this.legendList.replaceChildren(
      ...summary.stats.map((stat) => {
        const item = document.createElement('li');
        item.className = 'legend__item';

        const button = document.createElement('button');
        button.type = 'button';
        button.title = `${stat.cls.description} (dNBR ${formatBreak(stat.cls.min)} to ${formatBreak(stat.cls.max)})`;
        button.setAttribute('aria-pressed', String(this.options.visibleClasses.has(stat.cls.key)));

        const swatch = document.createElement('span');
        swatch.className = 'legend__swatch';
        swatch.style.background = stat.cls.color;

        const label = document.createElement('span');
        label.className = 'legend__label';
        label.textContent = stat.cls.label;

        const value = document.createElement('span');
        value.className = 'legend__value';
        value.textContent = `${formatArea(stat.hectares)} · ${(stat.fraction * 100).toFixed(1)}%`;

        const bar = document.createElement('span');
        bar.className = 'legend__bar';
        const fill = document.createElement('span');
        fill.style.width = `${Math.min(100, stat.fraction * 100)}%`;
        fill.style.background = stat.cls.color;
        bar.append(fill);

        button.append(swatch, label, value, bar);
        button.addEventListener('click', () => this.toggleClass(stat.cls.key));
        item.append(button);
        return item;
      }),
    );

    const totals = el<HTMLDListElement>('totals');
    totals.replaceChildren();
    const entries: [string, string][] = [
      ['Mapped area', formatArea(summary.totalHectares)],
      ['Burned (dNBR ≥ 0.10)', formatArea(summary.burnedHectares)],
      ['Mean dNBR', summary.meanDnbr.toFixed(3)],
      ['Cell size', `${scene.dnbr.cellSize} m`],
    ];
    for (const [term, value] of entries) {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      totals.append(dt, dd);
    }
  }

  /**
   * Clicking a legend row isolates that class; clicking the isolated class
   * again restores the full map. Isolating dims the rest of the terrain rather
   * than hiding it, so the burn stays in its topographic context.
   */
  private toggleClass(key: SeverityKey): void {
    const current = this.options.visibleClasses;
    const isolated = current.size === 1 && current.has(key);
    const next: ReadonlySet<SeverityKey> = isolated ? ALL_CLASSES : new Set([key]);
    this.updateOptions({ visibleClasses: next });
    this.legendList.querySelectorAll('button').forEach((button, index) => {
      const cls = SEVERITY_CLASSES[index];
      button.setAttribute('aria-pressed', String(cls ? next.has(cls.key) : false));
    });
  }

  private renderHud(hit: { gridX: number; gridY: number } | null): void {
    if (!hit || !this.surface) {
      this.hud.hidden = true;
      return;
    }
    const { elevation, dnbr } = this.surface.scene;
    const z = sampleBilinear(elevation, hit.gridX, hit.gridY);
    const value = sampleBilinear(dnbr, hit.gridX, hit.gridY);
    const cls = severityClassFor(value);

    this.hud.hidden = false;
    el('hud-elevation').textContent = `${z.toFixed(0)} m`;
    el('hud-dnbr').textContent = value.toFixed(3);
    el('hud-class').textContent = cls.label;
    el('hud-position').textContent =
      `E ${(hit.gridX * dnbr.cellSize).toFixed(0)} m · S ${(hit.gridY * dnbr.cellSize).toFixed(0)} m`;
  }
}

function formatBreak(value: number): string {
  if (value === -Infinity) return '−∞';
  if (value === Infinity) return '+∞';
  return value.toFixed(2);
}
