#!/usr/bin/env node
/**
 * Renders the illustrations (assets/illustrations/src/<group>/<id>.svg) to the PNGs the app
 * shows with <Image> (react-native-svg is not a dependency):
 *
 *   assets/illustrations/<group>/<id>@2x.png and <id>@3x.png (phones), and <id>.png (1x)
 *
 * React Native picks the density file and lays the image out at its 1x size in points, so
 * `require('.../covers/food-lima.png')` (no suffix) is enough in code. The 1x file is small and
 * is there because Jest (and Android mdpi, and the web export) resolve the bare name. Each group has a
 * drawing canvas (the SVG viewBox, in the style guide's pixel units) and a 1x size in points,
 * chosen for the largest place a screen shows it (see assets/illustrations/README.md):
 *
 *   group    canvas (viewBox)   1x (points)   @2x          @3x
 *   covers   1200 x 600         400 x 200     800 x 400    1200 x 600   opaque
 *   scenes   1200 x 500         432 x 180     864 x 360    1296 x 540   opaque
 *   cast     256 x 256          96 x 96       192 x 192    288 x 288    transparent outside the circle
 *   vocab    256 x 256          128 x 128     256 x 256    384 x 384    transparent
 *
 * Every PNG is palette-quantized (at most 256 colors, median cut refined by a few k-means
 * passes, alpha kept through tRNS) by the small encoder below, so the flat art stays small
 * without any extra dependency.
 *
 * Skin: every person in every picture has the same skin, SKIN below (README, "Skin"). The
 * sources mark skin with class="skin" (and a shadow on skin with class="skin-shade"); before
 * rendering, the paint of each such element is set to SKIN / SKIN_SHADE, and a source that says
 * otherwise is rewritten to match. So changing the skin is one line here plus a run of this
 * script. src/illustrations/skin.test.ts reads both constants from this file.
 *
 * Run:  node scripts/make-illustrations.js [--only id,id] [--group covers] [--sheet <dir>]
 *   --only   renders just these ids (any group)
 *   --group  renders just this group
 *   --sheet  also writes contact sheets (one per group, at 1x on the ground color) to <dir>
 * Needs Playwright with Chromium (not a dependency of the app), as scripts/make-icons.js does.
 */
/* global __dirname, Buffer */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const APP = path.resolve(__dirname, '..');
const ROOT = path.join(APP, 'assets', 'illustrations');
const SRC = path.join(ROOT, 'src');

const GROUND = '#F3F4F1';
const MUTED = '#5B616B';

/** The one skin for every illustrated person (amber, like the default emoji yellow). */
const SKIN = '#FFC46B';
/** The one shade for a shadow on skin (amber deep), if a figure needs one. */
const SKIN_SHADE = '#F08A1D';
const SKIN_PAINT = { skin: SKIN, 'skin-shade': SKIN_SHADE };

/**
 * Paints every element marked class="skin" or class="skin-shade" with SKIN or SKIN_SHADE: its
 * fill, or its stroke when the fill is "none" (tube arms and legs, fingers drawn as lines).
 */
function applySkin(svg) {
  return svg.replace(/<([a-zA-Z][\w:-]*)(\s[^<>]*?)?(\/?)>/g, (tag, name, attrs = '', close) => {
    const classes = (attrs.match(/\sclass="([^"]*)"/) || [])[1];
    const kind = classes && classes.split(/\s+/).find((c) => c in SKIN_PAINT);
    if (!kind) return tag;
    const paint = /\sfill="none"/.test(attrs) ? 'stroke' : 'fill';
    const re = new RegExp(`(\\s${paint}=")[^"]*(")`);
    const next = re.test(attrs) ? attrs.replace(re, `$1${SKIN_PAINT[kind]}$2`) : `${attrs} ${paint}="${SKIN_PAINT[kind]}"`;
    return `<${name}${next}${close}>`;
  });
}

/** canvas: the SVG viewBox; point: the 1x size React Native lays the image out at. */
const GROUPS = {
  covers: { canvas: [1200, 600], point: [400, 200], alpha: false },
  scenes: { canvas: [1200, 500], point: [432, 180], alpha: false },
  cast: { canvas: [256, 256], point: [96, 96], alpha: true },
  vocab: { canvas: [256, 256], point: [128, 128], alpha: true },
};
const SCALES = [1, 2, 3];
const fileName = (id, scale) => (scale === 1 ? `${id}.png` : `${id}@${scale}x.png`);

// ---- PNG decode (what Chromium writes: 8-bit RGB or RGBA, non-interlaced) ----------------
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

// ---- Palette quantization ----------------------------------------------------------------
/**
 * Reduces RGBA pixels to at most `max` colors. Fully transparent pixels share one entry.
 * The flat fills keep their exact colors (pinned entries); the edge and blend colors are
 * clustered premultiplied (a faint edge pixel's RGB matters little) by a weighted median cut,
 * then refined with a few k-means passes. Returns { palette: [[r,g,b,a]], indices: Uint8Array }.
 */
function quantize(rgba, max = 256) {
  const count = rgba.length / 4;
  const hist = new Map();
  for (let i = 0; i < count; i++) {
    const a = rgba[i * 4 + 3];
    const key = a === 0 ? 0 : ((rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | a) >>> 0;
    hist.set(key, (hist.get(key) || 0) + 1);
  }
  const hasClear = hist.has(0);
  const colors = [];
  for (const [key, n] of hist) {
    if (key === 0) continue;
    const r = key >>> 24;
    const g = (key >>> 16) & 255;
    const b = (key >>> 8) & 255;
    const a = key & 255;
    colors.push({ key, n, v: [(r * a) / 255, (g * a) / 255, (b * a) / 255, a] });
  }
  const slots = max - (hasClear ? 1 : 0);
  let centers;
  if (colors.length <= slots) {
    centers = colors.map((c) => c.v.slice());
  } else {
    // The flat fills keep their exact colors: every color covering at least 0.05 % of the
    // image gets its own entry (at most half the palette) and never moves.
    const byCount = colors.slice().sort((p, q) => q.n - p.n);
    const fixed = byCount.filter((c) => c.n >= count * 0.0005).slice(0, slots >> 1);
    const fixedKeys = new Set(fixed.map((c) => c.key));
    const rest = colors.filter((c) => !fixedKeys.has(c.key));
    const free = slots - fixed.length;
    // Median cut over the rest (edges, blends): split the box with the largest weighted spread
    // along its widest channel, at the weighted median.
    const boxes = rest.length ? [rest] : [];
    const spread = (box) => {
      let best = 0;
      let channel = 0;
      for (let ch = 0; ch < 4; ch++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const c of box) {
          if (c.v[ch] < lo) lo = c.v[ch];
          if (c.v[ch] > hi) hi = c.v[ch];
        }
        if (hi - lo > best) {
          best = hi - lo;
          channel = ch;
        }
      }
      const weight = box.reduce((s, c) => s + c.n, 0);
      return { score: best * Math.sqrt(weight), channel };
    };
    while (boxes.length && boxes.length < free) {
      let pick = -1;
      let pickInfo = null;
      for (let i = 0; i < boxes.length; i++) {
        if (boxes[i].length < 2) continue;
        const info = spread(boxes[i]);
        if (!pickInfo || info.score > pickInfo.score) {
          pick = i;
          pickInfo = info;
        }
      }
      if (pick < 0 || pickInfo.score === 0) break;
      const box = boxes[pick].sort((p, q) => p.v[pickInfo.channel] - q.v[pickInfo.channel]);
      const total = box.reduce((s, c) => s + c.n, 0);
      // The cut closest to half the weight, keeping both sides non-empty.
      let acc = 0;
      let cut = 1;
      let bestGap = Infinity;
      for (let i = 0; i < box.length - 1; i++) {
        acc += box[i].n;
        const gap = Math.abs(acc - total / 2);
        if (gap < bestGap) {
          bestGap = gap;
          cut = i + 1;
        }
      }
      boxes.splice(pick, 1, box.slice(0, cut), box.slice(cut));
    }
    const mean = (box) => {
      const sum = [0, 0, 0, 0];
      let n = 0;
      for (const c of box) {
        for (let ch = 0; ch < 4; ch++) sum[ch] += c.v[ch] * c.n;
        n += c.n;
      }
      return sum.map((s) => s / n);
    };
    let moving = boxes.map(mean);
    const pinned = fixed.map((c) => c.v.slice());
    // k-means refinement of the free entries; the pinned ones stay put.
    for (let pass = 0; pass < 6; pass++) {
      const all = pinned.concat(moving);
      const sums = moving.map(() => [0, 0, 0, 0, 0]);
      for (const c of colors) {
        const j = nearest(all, c.v) - pinned.length;
        if (j < 0) continue;
        const s = sums[j];
        for (let ch = 0; ch < 4; ch++) s[ch] += c.v[ch] * c.n;
        s[4] += c.n;
      }
      moving = moving.map((old, j) => (sums[j][4] ? sums[j].slice(0, 4).map((s) => s / sums[j][4]) : old));
    }
    centers = pinned.concat(moving);
  }
  const palette = [];
  if (hasClear) palette.push([0, 0, 0, 0]);
  for (const v of centers) {
    const a = Math.round(v[3]);
    const un = (x) => (a ? Math.max(0, Math.min(255, Math.round((x * 255) / a))) : 0);
    palette.push([un(v[0]), un(v[1]), un(v[2]), a]);
  }
  const indexOf = new Map();
  if (hasClear) indexOf.set(0, 0);
  for (const c of colors) indexOf.set(c.key, nearest(centers, c.v) + (hasClear ? 1 : 0));
  const indices = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const a = rgba[i * 4 + 3];
    const key = a === 0 ? 0 : ((rgba[i * 4] << 24) | (rgba[i * 4 + 1] << 16) | (rgba[i * 4 + 2] << 8) | a) >>> 0;
    indices[i] = indexOf.get(key);
  }
  return { palette, indices };
}

function nearest(centers, v) {
  let best = 0;
  let bestD = Infinity;
  for (let j = 0; j < centers.length; j++) {
    const c = centers[j];
    const d0 = c[0] - v[0];
    const d1 = c[1] - v[1];
    const d2 = c[2] - v[2];
    const d3 = c[3] - v[3];
    const d = d0 * d0 + d1 * d1 + d2 * d2 + 2 * d3 * d3;
    if (d < bestD) {
      bestD = d;
      best = j;
    }
  }
  return best;
}

// ---- PNG encode (8-bit indexed, with tRNS when any entry is not opaque) -----------------
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

function encodeIndexed(width, height, { palette, indices }) {
  // Entries with alpha first, so tRNS can stop at the last translucent one.
  const order = palette.map((_, i) => i).sort((p, q) => (palette[p][3] === 255) - (palette[q][3] === 255));
  const remap = new Uint8Array(palette.length);
  order.forEach((old, i) => (remap[old] = i));
  const sorted = order.map((i) => palette[i]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 3;
  const plte = Buffer.from(sorted.flatMap(([r, g, b]) => [r, g, b]));
  const translucent = sorted.filter((c) => c[3] !== 255).length;
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = remap[indices[y * width + x]];
  }
  const chunks = [SIGNATURE, chunk('IHDR', header), chunk('PLTE', plte)];
  if (translucent) chunks.push(chunk('tRNS', Buffer.from(sorted.slice(0, translucent).map((c) => c[3]))));
  chunks.push(chunk('IDAT', zlib.deflateSync(raw, { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

// ---- Rendering -----------------------------------------------------------------------------
function page(width, height, body, background = 'transparent') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    #frame { position: relative; width: ${width}px; height: ${height}px; background: ${background}; overflow: hidden; }
    #frame > svg { display: block; width: 100%; height: 100%; }
  </style></head><body><div id="frame">${body}</div></body></html>`;
}

async function shoot(browser, html, [width, height], scale) {
  const p = await browser.newPage({ viewport: { width: Math.max(width, 64), height: Math.max(height, 64) }, deviceScaleFactor: scale });
  await p.setContent(html);
  const png = await p.locator('#frame').screenshot({ omitBackground: true });
  await p.close();
  return decodePng(png);
}

function list(only, group) {
  const items = [];
  for (const [name, spec] of Object.entries(GROUPS)) {
    if (group && group !== name) continue;
    const dir = path.join(SRC, name);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.svg')) continue;
      const id = file.slice(0, -4);
      if (only && !only.includes(id)) continue;
      const source = fs.readFileSync(path.join(dir, file), 'utf8');
      const svg = applySkin(source);
      if (svg !== source) {
        fs.writeFileSync(path.join(dir, file), svg);
        console.log(`${name}/${id}: skin set to ${SKIN} in the source`);
      }
      items.push({ group: name, id, spec, svg });
    }
  }
  return items;
}

function checkViewBox(item) {
  const m = item.svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const [w, h] = item.spec.canvas;
  if (!m || +m[1] !== w || +m[2] !== h) throw new Error(`${item.group}/${item.id}.svg: viewBox must be 0 0 ${w} ${h}`);
}

/** One contact sheet per group: every picture at 1x on the ground color, with its id. */
function sheetHtml(group, items) {
  const [w, h] = GROUPS[group].point;
  const cols = Math.max(1, Math.min(group === 'vocab' ? 7 : group === 'cast' ? 6 : 2, items.length));
  const cell = (it) => `<figure style="margin:0; width:${w}px">
      <div style="width:${w}px; height:${h}px; ${group === 'vocab' ? `background:#FFFFFF; border-radius:20px;` : ''}">${it.svg.replace('<svg ', '<svg style="display:block;width:100%;height:100%" ')}</div>
      <figcaption style="font:500 12px/16px -apple-system, system-ui, sans-serif; color:${MUTED}; margin-top:6px; text-align:center">${it.id}</figcaption>
    </figure>`;
  const width = cols * w + (cols - 1) * 20 + 48;
  const rows = Math.ceil(items.length / cols);
  const height = rows * (h + 22) + (rows - 1) * 20 + 48;
  const body = `<div style="padding:24px; display:grid; grid-template-columns:repeat(${cols}, ${w}px); gap:20px">${items.map(cell).join('')}</div>`;
  return { html: page(width, height, body, GROUND), size: [width, height] };
}

async function main() {
  const arg = (name) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const only = arg('--only')?.split(',');
  const group = arg('--group');
  const sheetDir = arg('--sheet') ? path.resolve(arg('--sheet')) : null;
  const items = list(only, group);
  if (!items.length) throw new Error('No SVGs matched.');
  const browser = await chromium.launch();
  let total = 0;
  try {
    for (const item of items) {
      checkViewBox(item);
      const outDir = path.join(ROOT, item.group);
      fs.mkdirSync(outDir, { recursive: true });
      const sizes = [];
      for (const scale of SCALES) {
        const { width, height, rgba } = await shoot(browser, page(...item.spec.point, item.svg), item.spec.point, scale);
        const [pw, ph] = item.spec.point;
        if (width !== pw * scale || height !== ph * scale) throw new Error(`${item.id}: rendered ${width}x${height}`);
        if (!item.spec.alpha) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
        const png = encodeIndexed(width, height, quantize(rgba));
        fs.writeFileSync(path.join(outDir, fileName(item.id, scale)), png);
        total += png.length;
        sizes.push(`@${scale}x ${width}x${height} ${(png.length / 1024).toFixed(1)} KB`);
      }
      console.log(`${item.group}/${item.id}  ${sizes.join('  ')}`);
    }
    if (sheetDir) {
      fs.mkdirSync(sheetDir, { recursive: true });
      for (const name of Object.keys(GROUPS)) {
        const its = items.filter((it) => it.group === name);
        if (!its.length) continue;
        const { html, size } = sheetHtml(name, its);
        const p = await browser.newPage({ viewport: { width: size[0], height: size[1] }, deviceScaleFactor: 1 });
        await p.setContent(html);
        await p.locator('#frame').screenshot({ path: path.join(sheetDir, `sheet-${name}.png`) });
        await p.close();
        console.log(`sheet ${path.join(sheetDir, `sheet-${name}.png`)}`);
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`${items.length} illustrations, ${(total / 1024 / 1024).toFixed(2)} MB written this run`);
  let all = 0;
  for (const name of Object.keys(GROUPS)) {
    const dir = path.join(ROOT, name);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.png')) all += fs.statSync(path.join(dir, f)).size;
  }
  console.log(`all illustration PNGs: ${(all / 1024 / 1024).toFixed(2)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
