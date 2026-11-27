// Tekent de iconen (procentteken op een afgerond vlak) en schrijft ze als PNG.
// Gebruik: node tools/make-icons.mjs
//
// Het icoon van 128 px krijgt 16 px transparante rand (beeld 96 px), zoals de Chrome Web Store
// aanraadt. Daarnaast komt het store-logo van 300 px voor Edge Add-ons in store/.

import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'extension', 'icons');
const storeDir = join(root, 'store');
const SIZES = [16, 32, 48, 128];
// Transparante rand per formaat, in pixels.
const PADDING = { 128: 16 };
const VARIANTS = {
  active: [21, 128, 61], // groen: cashback gevonden
  inactive: [148, 155, 165], // grijs: niets gevonden
};
const SAMPLES = 4; // supersampling per as voor gladde randen

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Coördinaten lopen van 0 tot 1. Geeft 'bg', 'fg' of null (transparant).
function shade(x, y) {
  const radius = 0.22;
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  if (Math.hypot(x - cx, y - cy) > radius) return null;

  const slash = distanceToSegment(x, y, 0.69, 0.2, 0.31, 0.8) < 0.055;
  const ring = (ox, oy) => {
    const d = Math.hypot(x - ox, y - oy);
    return d < 0.155 && d > 0.065;
  };
  return slash || ring(0.3, 0.32) || ring(0.7, 0.68) ? 'fg' : 'bg';
}

function render(size, [r, g, b], pad = PADDING[size] || 0) {
  const art = size - 2 * pad;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const kind = shade((px - pad + (sx + 0.5) / SAMPLES) / art, (py - pad + (sy + 0.5) / SAMPLES) / art);
          if (!kind) continue;
          alpha++;
          red += kind === 'fg' ? 255 : r;
          green += kind === 'fg' ? 255 : g;
          blue += kind === 'fg' ? 255 : b;
        }
      }
      const offset = (py * size + px) * 4;
      if (alpha > 0) {
        pixels[offset] = Math.round(red / alpha);
        pixels[offset + 1] = Math.round(green / alpha);
        pixels[offset + 2] = Math.round(blue / alpha);
        pixels[offset + 3] = Math.round((alpha / (SAMPLES * SAMPLES)) * 255);
      }
    }
  }
  return pixels;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per kanaal
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    pixels.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outDir, { recursive: true });
for (const [name, color] of Object.entries(VARIANTS)) {
  for (const size of SIZES) {
    const file = join(outDir, `${name}-${size}.png`);
    writeFileSync(file, encodePng(size, render(size, color)));
    console.log('geschreven', file);
  }
}

// Store-logo voor Edge Add-ons: 300 x 300, zonder rand.
mkdirSync(storeDir, { recursive: true });
const logo = join(storeDir, 'logo-300.png');
writeFileSync(logo, encodePng(300, render(300, VARIANTS.active, 0)));
console.log('geschreven', logo);
