#!/usr/bin/env node
/**
 * Generates the placeholder app icon, Android adaptive icon layers, splash image and
 * favicon in assets/, using only Node built-ins (zlib for PNG).
 *
 * The mark: an ink cliff edge on the ground color, with an amber dot (the next word) just
 * past the edge. Run: node scripts/make-icons.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GROUND = [0xf3, 0xf4, 0xf1, 255];
const INK = [0x16, 0x18, 0x1d, 255];
const AMBER = [0xf0, 0x8a, 0x1d, 255];
const WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

// ---- PNG encoding -------------------------------------------------------------------
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
function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- Shapes, in a 0..1 unit square ---------------------------------------------------
function insidePolygon(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const insideCircle = (x, y, [cx, cy, r]) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

/** The mark: cliff polygon and dot, scaled by s around the center. */
function mark(s) {
  const t = (v) => 0.5 + (v - 0.5) * s;
  return {
    cliff: [
      [-1, t(0.58)],
      [t(0.56), t(0.58)],
      [t(0.6), t(0.62)],
      [t(0.63), 2],
      [-1, 2],
    ],
    dot: [t(0.74), t(0.45), 0.075 * s],
  };
}

/**
 * Renders size x size pixels with 4x4 supersampling. layers: [{ test(x, y), color }],
 * painted in order over the background.
 */
function render(size, background, layers) {
  const out = Buffer.alloc(size * size * 4);
  const N = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const x = (px + (sx + 0.5) / N) / size;
          const y = (py + (sy + 0.5) / N) / size;
          let c = background;
          for (const layer of layers) if (layer.test(x, y)) c = layer.color;
          const a = c[3] / 255;
          acc[0] += c[0] * a;
          acc[1] += c[1] * a;
          acc[2] += c[2] * a;
          acc[3] += a;
        }
      }
      const i = (py * size + px) * 4;
      const alpha = acc[3] / (N * N);
      out[i] = alpha ? Math.round(acc[0] / acc[3]) : 0;
      out[i + 1] = alpha ? Math.round(acc[1] / acc[3]) : 0;
      out[i + 2] = alpha ? Math.round(acc[2] / acc[3]) : 0;
      out[i + 3] = Math.round(alpha * 255);
    }
  }
  return out;
}

function layersFor(scale, cliffColor, dotColor) {
  const m = mark(scale);
  return [
    { test: (x, y) => insidePolygon(x, y, m.cliff), color: cliffColor },
    { test: (x, y) => insideCircle(x, y, m.dot), color: dotColor },
  ];
}

const outputs = [
  // iOS and store icon: full bleed, opaque.
  { file: 'icon.png', size: 1024, bg: GROUND, layers: layersFor(1, INK, AMBER) },
  // Android adaptive icon: the launcher masks to the central ~66%, so the mark is smaller.
  { file: 'adaptive-icon-foreground.png', size: 1024, bg: CLEAR, layers: layersFor(0.7, INK, AMBER) },
  { file: 'adaptive-icon-background.png', size: 1024, bg: GROUND, layers: [] },
  { file: 'adaptive-icon-monochrome.png', size: 1024, bg: CLEAR, layers: layersFor(0.7, WHITE, WHITE) },
  // Splash image, drawn on the ground color by expo-splash-screen.
  { file: 'splash-icon.png', size: 1024, bg: CLEAR, layers: layersFor(0.9, INK, AMBER) },
  { file: 'favicon.png', size: 48, bg: GROUND, layers: layersFor(1, INK, AMBER) },
];

const assetsDir = path.resolve(__dirname, '../assets');
fs.mkdirSync(assetsDir, { recursive: true });
for (const { file, size, bg, layers } of outputs) {
  const png = encodePng(size, size, render(size, bg, layers));
  fs.writeFileSync(path.join(assetsDir, file), png);
  console.log(`assets/${file} ${size}x${size} ${(png.length / 1024).toFixed(1)} KB`);
}
