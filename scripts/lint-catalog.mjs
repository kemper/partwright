#!/usr/bin/env node
// lint:catalog — guards the size of catalog entries committed under
// public/catalog/*.partwright.json.
//
// Why this exists: catalog entries embed a base64 PNG thumbnail and, when an
// author paints with coordinate selectors (paintInBox / paintNear / paintFaces)
// instead of `paintByLabels`, a per-triangle id list is serialised into the
// file. On a complex model that list balloons — a real SDF vase once reached
// 17 MB (the norm is ~250 KB). Because /catalog eagerly fetches every entry on
// page load, one bloated file slows the whole page. `paintByLabels` stores only
// the label name and re-resolves on load, keeping files small. See
// public/catalog/README.md and public/ai/colors.md.
//
// Two tiers, mirroring the repo's gate-vs-advisory convention:
//   - HARD_LIMIT_KB  — a GATE. Any entry over this fails the job (exit 1). Set
//     comfortably above the largest legitimate (thumbnail-dominated) entry but
//     far below the multi-MB coordinate-paint regression class, so it catches
//     the regression without tripping on normal growth.
//   - SOFT_LIMIT_KB  — ADVISORY. Entries over this are flagged (but don't fail)
//     as candidates to re-author with `byLabel` paint.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HARD_LIMIT_KB = 1500;
const SOFT_LIMIT_KB = 500;
// LAZY entries — those whose manifest row declares a sidecar `thumbnail` —
// are never fetched at /catalog page load (the tile renders from the sidecar
// image; the payload downloads only on click), so the page-load rationale
// behind HARD_LIMIT_KB doesn't apply to them. Their ceiling is instead the
// Cloudflare Pages per-file cap (25 MiB): an entry over THAT silently fails
// to deploy, which is the regression this tier catches. Keep lazy entries
// rare and deliberate — each one still costs repo size and clone time.
const LAZY_HARD_LIMIT_KB = 25 * 1024;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalogDir = join(repoRoot, 'public', 'catalog');

const manifest = JSON.parse(readFileSync(join(catalogDir, 'manifest.json'), 'utf8'));
const lazyFiles = new Set((manifest.entries ?? []).filter((e) => e.thumbnail).map((e) => e.file));

const files = readdirSync(catalogDir)
  .filter((f) => f.endsWith('.partwright.json'))
  .map((f) => ({ name: f, kb: statSync(join(catalogDir, f)).size / 1024, lazy: lazyFiles.has(f) }))
  .sort((a, b) => b.kb - a.kb);

if (files.length === 0) {
  console.error(`lint:catalog: no .partwright.json entries found in ${catalogDir}`);
  process.exit(1);
}

const over = files.filter((f) => f.kb > (f.lazy ? LAZY_HARD_LIMIT_KB : HARD_LIMIT_KB));
const advisory = files.filter((f) => !f.lazy && f.kb > SOFT_LIMIT_KB && f.kb <= HARD_LIMIT_KB);
const lazy = files.filter((f) => f.lazy);

const kb = (n) => `${n.toFixed(0)} KB`;

if (advisory.length > 0) {
  console.log(`lint:catalog: ${advisory.length} entr${advisory.length === 1 ? 'y' : 'ies'} over the ${SOFT_LIMIT_KB} KB advisory budget (consider \`paintByLabels\` over coordinate paint):`);
  for (const f of advisory) console.log(`  · ${f.name}  ${kb(f.kb)}`);
}

if (lazy.length > 0) {
  console.log(`lint:catalog: ${lazy.length} LAZY entr${lazy.length === 1 ? 'y' : 'ies'} (sidecar thumbnail, fetched on click — ${LAZY_HARD_LIMIT_KB / 1024} MiB deploy cap applies):`);
  for (const f of lazy) console.log(`  · ${f.name}  ${kb(f.kb)}`);
}

if (over.length > 0) {
  console.error(`\nlint:catalog: FAIL — ${over.length} entr${over.length === 1 ? 'y' : 'ies'} exceed their hard limit (${HARD_LIMIT_KB} KB eager / ${LAZY_HARD_LIMIT_KB} KB lazy):`);
  for (const f of over) console.error(`  ✘ ${f.name}  ${kb(f.kb)}${f.lazy ? ' (lazy)' : ''}`);
  console.error('\nEager entries: re-author the paint with `label()` + `paintByLabels` (stores label names, not per-triangle id lists) and re-bake. Lazy entries: over the Cloudflare per-file deploy cap — shrink the embedded mesh. See public/catalog/README.md.');
  process.exit(1);
}

console.log(`lint:catalog: OK — ${files.length} entries, largest ${kb(files[0].kb)} (limit ${HARD_LIMIT_KB} KB).`);
