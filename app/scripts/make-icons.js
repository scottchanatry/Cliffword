#!/usr/bin/env node
/**
 * Renders the app icon, the Android adaptive icon layers, the splash image, the favicon and the
 * Google Play graphics from the brand mark (assets/brand/mark.svg) with Playwright's Chromium.
 *
 * The mark: two rows of word tiles on ink, and the story stops at a dashed amber gap with three
 * dots, the app's core idea. No text in the app icon.
 *
 *   assets/icon.png                       1024 x 1024, opaque RGB (the App Store rejects alpha)
 *   assets/adaptive-icon-foreground.png   1024 x 1024, the mark inside the central 66 % circle, transparent
 *   assets/adaptive-icon-background.png   1024 x 1024, solid ink
 *   assets/adaptive-icon-monochrome.png   1024 x 1024, white mark on transparent (themed icons)
 *   assets/splash-icon.png                1024 x 1024, the icon as a rounded square, small enough for
 *                                         Android 12's circular splash mask, transparent around it
 *   assets/favicon.png                    48 x 48, the rounded icon
 *   assets/brand/icon.svg                 the full icon as SVG (generated; for the website)
 *   store/graphics/play-icon-512.png      512 x 512, 32-bit PNG (RGBA, opaque), full bleed
 *   store/graphics/play-feature-graphic.png  1024 x 500, 24-bit PNG without alpha: the mark,
 *                                         "Cliffword" in Newsreader, the subtitle in Inter
 *
 * Run: npm run icons [-- --preview <dir>]  (--preview also writes the icon at 29, 58 and 120 px,
 * rounded as iOS shows it, to check it at small sizes).
 * Needs Playwright with Chromium: `npm i -g playwright && npx playwright install chromium` (it is
 * not a dependency of the app).
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const APP = path.resolve(__dirname, '..');
const ASSETS = path.join(APP, 'assets');
const GRAPHICS = path.join(APP, 'store', 'graphics');
const MARK_SVG = fs.readFileSync(path.join(ASSETS, 'brand', 'mark.svg'), 'utf8');

const INK = '#16181D';
const GROUND = '#F3F4F1';
const MUTED = '#5B616B';

/** The mark's own size (its viewBox). */
const MARK_W = 724;
const MARK_H = 450;
/** The mark's width as a share of the icon's side. */
const ICON_MARK = 0.742;
/** iOS's corner radius as a share of the side (the continuous corner is close to this). */
const CORNER = 0.2237;

// ---- PNG (8-bit RGB and RGBA, non-interlaced) -----------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Encodes RGBA pixels as an RGBA (alpha: true) or RGB PNG. */
function encodePng(width, height, rgba, { alpha }) {
  const channels = alpha ? 4 : 3;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = alpha ? 6 : 2;
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = y * stride + 1 + x * channels;
      raw[d] = rgba[s];
      raw[d + 1] = rgba[s + 1];
      raw[d + 2] = rgba[s + 2];
      if (alpha) raw[d + 3] = rgba[s + 3];
    }
  }
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Decodes an 8-bit RGB or RGBA PNG (what Chromium writes) to { width, height, rgba }. */
function decodePng(png) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (pos < png.length) {
    const len = png.readUInt32BE(pos);
    const type = png.toString('ascii', pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) throw new Error('Only 8-bit RGB/RGBA, non-interlaced PNGs are read.');
    } else if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? pixels[y * stride + i - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
      const c = i >= channels && y > 0 ? pixels[(y - 1) * stride + i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      pixels[y * stride + i] = v & 0xff;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = pixels[i * channels];
    rgba[i * 4 + 1] = pixels[i * channels + 1];
    rgba[i * 4 + 2] = pixels[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, rgba };
}

// ---- Compositions (HTML pages Chromium renders) ------------------------------------------
const fontFace = (family, file) =>
  `@font-face { font-family: '${family}'; src: url(data:font/ttf;base64,${fs.readFileSync(path.join(APP, 'node_modules/@expo-google-fonts', file)).toString('base64')}) format('truetype'); }`;

/** The mark at `width` px, its top-left at (x, y); `colors` override the CSS variables. */
function mark(x, y, width, colors = {}) {
  const vars = Object.entries(colors)
    .map(([k, v]) => `--cw-${k}: ${v};`)
    .join(' ');
  const svg = MARK_SVG.replace('<svg ', `<svg style="position:absolute; left:${x}px; top:${y}px; width:${width}px; height:${(width * MARK_H) / MARK_W}px; ${vars}" `);
  return svg;
}

/** The icon: an ink square (rounded by `radius`) with the mark centred, `side` px, at (x, y). */
function icon(x, y, side, radius = 0) {
  const w = side * ICON_MARK;
  const h = (w * MARK_H) / MARK_W;
  return `<div style="position:absolute; left:${x}px; top:${y}px; width:${side}px; height:${side}px; border-radius:${radius}px; background:${INK}; overflow:hidden">${mark((side - w) / 2, (side - h) / 2, w)}</div>`;
}

function page(width, height, body, { background = 'transparent', fonts = '' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
    html, body { margin: 0; background: transparent; }
    #frame { position: relative; width: ${width}px; height: ${height}px; background: ${background}; overflow: hidden; }
  </style></head><body><div id="frame">${body}</div></body></html>`;
}

/** The adaptive icon's mark: inside the central circle Android keeps (66 % of the layer), with a margin. */
function adaptiveMark(colors) {
  const diagonal = Math.hypot(MARK_W, MARK_H);
  const width = (MARK_W * (0.6 * 1024)) / diagonal;
  const height = (width * MARK_H) / MARK_W;
  return mark((1024 - width) / 2, (1024 - height) / 2, width, colors);
}

/**
 * Android 12+ masks the splash icon to a circle of 2/3 of the image: the rounded square fits
 * inside it (its corners included), so the same image works there and on iOS.
 */
const SPLASH_SIDE = Math.floor(1024 * 0.52);

function featureGraphic() {
  const fonts = [fontFace('Newsreader', 'newsreader/600SemiBold/Newsreader_600SemiBold.ttf'), fontFace('Inter', 'inter/500Medium/Inter_500Medium.ttf')].join('\n');
  const side = 248;
  const body = `
    ${icon(132, (500 - side) / 2, side, side * CORNER)}
    <div style="position:absolute; left:${132 + side + 64}px; top:0; height:500px; display:flex; flex-direction:column; justify-content:center; gap:14px">
      <div style="font-family:Newsreader; font-size:118px; line-height:1; letter-spacing:-1.5px; color:${INK}">Cliffword</div>
      <div style="font-family:Inter; font-size:38px; line-height:1.2; color:${MUTED}">Finish the sentence <span style="color:${INK}">out loud</span></div>
    </div>`;
  return page(1024, 500, body, { background: GROUND, fonts });
}

const OUTPUTS = [
  { file: path.join(ASSETS, 'icon.png'), size: [1024, 1024], alpha: false, html: () => page(1024, 1024, icon(0, 0, 1024)) },
  { file: path.join(ASSETS, 'adaptive-icon-foreground.png'), size: [1024, 1024], alpha: true, html: () => page(1024, 1024, adaptiveMark()) },
  { file: path.join(ASSETS, 'adaptive-icon-background.png'), size: [1024, 1024], alpha: false, html: () => page(1024, 1024, '', { background: INK }) },
  {
    file: path.join(ASSETS, 'adaptive-icon-monochrome.png'),
    size: [1024, 1024],
    alpha: true,
    html: () => page(1024, 1024, adaptiveMark({ old: '#FFFFFF', new: '#FFFFFF', gap: '#FFFFFF' })),
  },
  {
    file: path.join(ASSETS, 'splash-icon.png'),
    size: [1024, 1024],
    alpha: true,
    html: () => page(1024, 1024, icon((1024 - SPLASH_SIDE) / 2, (1024 - SPLASH_SIDE) / 2, SPLASH_SIDE, SPLASH_SIDE * CORNER)),
  },
  { file: path.join(ASSETS, 'favicon.png'), size: [48, 48], alpha: true, html: () => page(48, 48, icon(0, 0, 48, 48 * CORNER)) },
  // Google applies its own mask to the Play icon: full bleed, 32-bit.
  { file: path.join(GRAPHICS, 'play-icon-512.png'), size: [512, 512], alpha: true, html: () => page(512, 512, icon(0, 0, 512)) },
  { file: path.join(GRAPHICS, 'play-feature-graphic.png'), size: [1024, 500], alpha: false, html: featureGraphic },
];

/** The full icon as one SVG file (the mark nested in an ink square), for the website and docs. */
function iconSvg() {
  const w = 1024 * ICON_MARK;
  const h = (w * MARK_H) / MARK_W;
  const inner = MARK_SVG.replace(/^<svg [^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <!-- Generated by scripts/make-icons.js from mark.svg: edit mark.svg and run npm run icons. -->
  <rect width="1024" height="1024" fill="${INK}"/>
  <svg x="${(1024 - w) / 2}" y="${(1024 - h) / 2}" width="${w}" height="${h}" viewBox="0 0 ${MARK_W} ${MARK_H}">${inner}</svg>
</svg>
`;
}

async function render(browser, html, [width, height], deviceScaleFactor = 1) {
  const p = await browser.newPage({ viewport: { width: Math.max(width, 64), height: Math.max(height, 64) }, deviceScaleFactor });
  await p.setContent(html);
  await p.evaluate(() => document.fonts.ready);
  const png = await p.locator('#frame').screenshot({ omitBackground: true });
  await p.close();
  return decodePng(png);
}

async function main() {
  const previewAt = process.argv.indexOf('--preview');
  const previewDir = previewAt > 0 ? path.resolve(process.argv[previewAt + 1] ?? '') : null;
  fs.mkdirSync(GRAPHICS, { recursive: true });
  fs.writeFileSync(path.join(ASSETS, 'brand', 'icon.svg'), iconSvg());
  const browser = await chromium.launch();
  try {
    for (const out of OUTPUTS) {
      const { width, height, rgba } = await render(browser, out.html(), out.size);
      if (width !== out.size[0] || height !== out.size[1]) throw new Error(`${out.file}: rendered ${width}x${height}`);
      if (!out.alpha) {
        for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) throw new Error(`${out.file} must be opaque`);
      }
      const png = encodePng(width, height, rgba, { alpha: out.alpha });
      fs.writeFileSync(out.file, png);
      console.log(`${path.relative(APP, out.file)} ${width}x${height} ${out.alpha ? 'RGBA' : 'RGB'} ${(png.length / 1024).toFixed(1)} KB`);
    }
    if (previewDir) {
      fs.mkdirSync(previewDir, { recursive: true });
      for (const size of [29, 58, 120]) {
        const { width, height, rgba } = await render(browser, page(size, size, icon(0, 0, size, size * CORNER)), [size, size]);
        fs.writeFileSync(path.join(previewDir, `icon-${size}.png`), encodePng(width, height, rgba, { alpha: true }));
      }
      console.log(`previews in ${previewDir}`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
