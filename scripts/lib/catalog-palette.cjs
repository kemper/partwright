// Shared palette helpers for the catalog bake/extract scripts
// (build-catalog-entry.cjs, extract-catalog-palettes.cjs).
'use strict';

/** [r,g,b] in 0..1 → '#rrggbb'. */
function rgbToHex(c) {
  return '#' + c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
}

/** Extract a flat `{label: '#rrggbb'}` palette from a baked catalog entry's
 *  byLabel colorRegions, scanning versions newest-first (the painted snapshot
 *  is committed last). Returns null when no version carries byLabel regions
 *  (e.g. manifold-js entries whose colors are baked via api.label({color})). */
function paletteFromEntry(entry) {
  const versions = (entry && entry.versions) || [];
  for (let i = versions.length - 1; i >= 0; i--) {
    const byLabel = (versions[i].colorRegions || [])
      .filter((r) => r.descriptor && r.descriptor.kind === 'byLabel' && Array.isArray(r.color));
    if (byLabel.length) {
      const palette = {};
      for (const r of byLabel) palette[r.descriptor.label] = rgbToHex(r.color);
      return palette;
    }
  }
  return null;
}

module.exports = { paletteFromEntry, rgbToHex };
