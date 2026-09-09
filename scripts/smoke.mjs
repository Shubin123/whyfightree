/**
 * End-to-end smoke test: builds nothing, just drives a real Chrome against a
 * running server and checks the things a unit test cannot — that WebGL comes
 * up, the terrain actually draws pixels, and the panel populates.
 *
 *   npm run build && npm run preview -- --port 4173 &
 *   npm run smoke -- http://localhost:4173/whyfightree/
 *
 * Chrome is located via CHROME_PATH or the usual install locations.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { launch } from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:5173/';
const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const executablePath = CANDIDATES.find((path) => existsSync(path));
if (!executablePath) {
  console.error('No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.');
  process.exit(2);
}

const failures = [];
const browser = await launch({
  executablePath,
  headless: 'shell',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // CI runners have no user namespace for Chrome's sandbox to use.
    ...(process.env.CI ? ['--no-sandbox'] : []),
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
  await page.waitForSelector('.legend__item', { timeout: 20_000 });
  await page.waitForFunction(() => document.getElementById('loading')?.hidden === true, {
    timeout: 20_000,
  });

  const report = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    return {
      canvas: Boolean(canvas) && canvas.width > 100 && canvas.height > 100,
      webgl: Boolean(gl),
      legendRows: document.querySelectorAll('.legend__item').length,
      totalsRows: document.querySelectorAll('#totals dd').length,
      sources: document.querySelectorAll('#source-select option').length,
      colorModes: document.querySelectorAll('#color-mode button').length,
      burned: document.querySelectorAll('#totals dd')[1]?.textContent ?? '',
    };
  });

  if (!report.canvas) failures.push('no sized canvas in the viewport');
  if (!report.webgl) failures.push('WebGL context missing');
  if (report.legendRows !== 7) failures.push(`expected 7 legend rows, got ${report.legendRows}`);
  if (report.sources !== 3) failures.push(`expected 3 sample sources, got ${report.sources}`);
  if (report.colorModes !== 4) failures.push(`expected 4 colour modes, got ${report.colorModes}`);
  if (!/ha|km²/.test(report.burned)) failures.push(`burned area not reported: "${report.burned}"`);

  // A terrain that renders as a flat background colour would still pass every
  // DOM check above, so look at the pixels.
  const shot = await page.screenshot({ encoding: 'binary' });
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/smoke.png', shot);

  const variety = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const { data } = ctx.getImageData(0, 0, copy.width, copy.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 97) {
      seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    }
    return seen.size;
  });
  if (variety < 12) failures.push(`canvas looks blank (${variety} distinct colours)`);

  console.log(
    `canvas=${report.canvas} webgl=${report.webgl} legend=${report.legendRows} ` +
      `sources=${report.sources} colours=${variety} burned=${report.burned}`,
  );
} finally {
  await browser.close();
}

if (failures.length > 0) {
  console.error(`\nSmoke test failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log('Smoke test passed. Screenshot: artifacts/smoke.png');
