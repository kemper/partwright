#!/usr/bin/env node
// montage.mjs — arrange N PNGs into a labeled grid PNG. Used to build the
// "all targets" and "all comparisons" contact sheets.
//
// Usage:
//   node scripts/inverse-cad/montage.mjs <in.png>[:label] <in.png>[:label] ...
//     --out out.png [--cols N] [--gap G] [--label-height H]

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';

async function main() {
  const argv = process.argv.slice(2);
  const items = [];
  let out = null;
  let cols = 0;
  let gap = 6;
  let labelH = 22;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (a === '--cols') cols = parseInt(argv[++i], 10);
    else if (a === '--gap') gap = parseInt(argv[++i], 10);
    else if (a === '--label-height') labelH = parseInt(argv[++i], 10);
    else {
      const [file, ...labelParts] = a.split(':');
      items.push({ file, label: labelParts.join(':') || null });
    }
  }
  if (!items.length || !out) { console.error('Usage: montage.mjs <in.png>[:label] ... --out out.png [--cols N]'); process.exit(2); }

  if (!cols) cols = Math.ceil(Math.sqrt(items.length));
  const rows = Math.ceil(items.length / cols);

  const metas = await Promise.all(items.map(async (it) => {
    const buf = readFileSync(it.file);
    const m = await sharp(buf).metadata();
    return { buf, width: m.width, height: m.height, label: it.label };
  }));

  const tileW = Math.max(...metas.map((m) => m.width));
  const tileH = Math.max(...metas.map((m) => m.height)) + labelH;
  const W = cols * tileW + (cols - 1) * gap;
  const H = rows * tileH + (rows - 1) * gap;

  const overlays = [];
  metas.forEach((m, i) => {
    const cx = (i % cols) * (tileW + gap);
    const cy = Math.floor(i / cols) * (tileH + gap);
    overlays.push({ input: m.buf, top: cy + labelH, left: cx });
    if (m.label) {
      const svg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${tileW}" height="${labelH}">` +
        `<rect x="0" y="0" width="${tileW}" height="${labelH}" fill="#f4f4f6"/>` +
        `<text x="6" y="${labelH - 6}" font-family="sans-serif" font-size="14" fill="#111">${m.label}</text>` +
        `</svg>`
      );
      overlays.push({ input: svg, top: cy, left: cx });
    }
  });

  await sharp({ create: { width: W, height: H, channels: 3, background: { r: 220, g: 220, b: 220 } } })
    .composite(overlays)
    .png()
    .toFile(out);
  console.log(out, `(${cols}×${rows} tiles, ${items.length} images)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
