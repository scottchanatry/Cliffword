#!/usr/bin/env node
/**
 * Captures the store screenshots (app/store/screenshots/<device>/<n>-<name>.png) from a web
 * export that includes the dev fixture gallery (/preview/<fixture>, EXPO_PUBLIC_PREVIEW=1; see
 * app/README.md, "Routes, controllers and views"). The fixtures are the app's real views on
 * made-up content ("Luna de Santurce" by the made-up Rayo K., the market story), so the shots
 * show no real song, artist or album art.
 *
 *   node scripts/store-screenshots.js --build          export the web preview, then capture
 *   node scripts/store-screenshots.js --web <dir>      capture from an existing preview export
 *
 * The export goes to <tmp>/cliffword-shots-web unless --web names a folder. A tiny static
 * server (index.html for unknown paths, as the single-page export needs) serves it, and
 * Playwright's Chromium captures each screen as a phone: touch, mobile viewport, 3x (2.5x on
 * Android). Only the fixture is in the frame: the gallery index is never opened, and the
 * capture waits until the screen's own testID is on the page. A PNG over 1.5 MB is written as
 * a high-quality JPEG instead (both stores take either).
 *
 * Needs Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`).
 */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const APP = path.resolve(__dirname, '..');
const OUT = path.join(APP, 'store', 'screenshots');
const MAX_PNG_BYTES = 1.5 * 1024 * 1024;

/**
 * Apple's 6.9" (1320 x 2868) and 6.5" (1284 x 2778) sizes, and an Android phone at 1080 x 2160:
 * Google Play refuses a screenshot whose long side is more than twice the short side, so a
 * 20:9 phone frame (1080 x 2400) would be rejected.
 */
const DEVICES = [
  { name: 'iphone-6.9', viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 },
  { name: 'iphone-6.5', viewport: { width: 428, height: 926 }, deviceScaleFactor: 3 },
  { name: 'android-phone', viewport: { width: 432, height: 864 }, deviceScaleFactor: 2.5, android: true },
];

/**
 * The six screens, in store order: the fixture, the testID that says it has rendered, and for
 * Android the fixture without Apple Music (the Play listing says it is iOS only): the library
 * says "Not available on Android yet" and the lyric cliff has no player bar.
 */
const SCREENS = [
  { name: 'story-cliff', fixture: 'b1', ready: 'story-view' },
  { name: 'landing', fixture: 'b2', ready: 'landing-headline' },
  { name: 'self-repair', fixture: 'a2', ready: 'story-view' },
  { name: 'music-library', fixture: 'c3', android: 'c3-android', ready: 'music-screen' },
  { name: 'lyric-cliff', fixture: 'c1', android: 'c1-manual', ready: 'song-view' },
  { name: 'profile', fixture: 'profile', ready: 'profile-screen' },
];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
};

/** Serves `root`; any path that is not a file gets index.html (the export is a single-page app). */
function serve(root) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    let file = path.join(root, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function capture(browser, base, device, screen, index) {
  const context = await browser.newContext({ viewport: device.viewport, deviceScaleFactor: device.deviceScaleFactor, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const fixture = device.android && screen.android ? screen.android : screen.fixture;
  await page.goto(`${base}/preview/${fixture}`, { waitUntil: 'networkidle' });
  await page.waitForSelector(`[data-testid="${screen.ready}"]`, { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  // No caret, no scroll bars. The story's "Report this sentence" footer link is left out: on the
  // shorter Android frame it pushes the command chips below the fold, and it sells nothing.
  await page.addStyleTag({
    content: [
      '* { caret-color: transparent !important; scrollbar-width: none !important; }',
      '::-webkit-scrollbar { display: none; }',
      '[data-testid="story-report"] { display: none !important; }',
    ].join('\n'),
  });
  // Let the entry animations settle.
  await page.waitForTimeout(800);
  if (errors.length > 0) throw new Error(`${fixture}: ${errors.join('; ')}`);
  const dir = path.join(OUT, device.name);
  const stem = path.join(dir, `${index + 1}-${screen.name}`);
  let png = await page.screenshot({ type: 'png' });
  let file = `${stem}.png`;
  if (png.length > MAX_PNG_BYTES) {
    png = await page.screenshot({ type: 'jpeg', quality: 92 });
    file = `${stem}.jpg`;
  }
  for (const ext of ['.png', '.jpg']) if (fs.existsSync(stem + ext)) fs.unlinkSync(stem + ext);
  fs.writeFileSync(file, png);
  await context.close();
  return { file, bytes: png.length };
}

async function main() {
  const web = path.resolve(arg('--web') ?? path.join(os.tmpdir(), 'cliffword-shots-web'));
  if (process.argv.includes('--build')) {
    execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', web], {
      cwd: APP,
      stdio: 'inherit',
      env: { ...process.env, EXPO_PUBLIC_PREVIEW: '1' },
    });
  }
  if (!fs.existsSync(path.join(web, 'index.html'))) throw new Error(`No web export in ${web}: run with --build, or pass --web <dir>.`);
  const server = await serve(web);
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    for (const device of DEVICES) {
      fs.mkdirSync(path.join(OUT, device.name), { recursive: true });
      for (const [i, screen] of SCREENS.entries()) {
        const { file, bytes } = await capture(browser, base, device, screen, i);
        console.log(`${path.relative(APP, file)} ${(bytes / 1024).toFixed(0)} KB`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
