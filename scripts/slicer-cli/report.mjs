// Pure report logic for `slicer-cli check`: turn what OUR reader sees in a 3MF
// and what the real slicer reports about the same file into one list of
// pass/fail checks. No I/O here, so it unit-tests in the vitest tier
// (tests/unit/slicerReport.test.ts).

/** Size agreement tolerance between our reader and the slicer, in mm. */
export const SIZE_TOLERANCE_MM = 0.05;

/** The slicer's fixed plate-render cameras (`--camera-view`). */
export const SLICER_VIEWS = { 0: 'iso', 1: 'top-front', 2: 'left', 3: 'right', 10: 'iso-1', 11: 'iso-2', 12: 'iso-3' };

/** Parse `--views 0,1,left,iso-2` into view numbers. Throws on an unknown view. */
export function parseViews(spec) {
  const byName = Object.fromEntries(Object.entries(SLICER_VIEWS).map(([n, name]) => [name, Number(n)]));
  return String(spec).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const n = /^\d+$/.test(s) ? Number(s) : byName[s];
    if (n === undefined || !(n in SLICER_VIEWS)) throw new Error(`unknown view "${s}". Valid: ${Object.entries(SLICER_VIEWS).map(([k, v]) => `${k} (${v})`).join(', ')}`);
    return n;
  });
}

const round = (n, digits = 3) => Number(n.toFixed(digits));

/**
 * Summarise a `parse3MF` result (src/import/parsers/threemf.ts): per-object
 * size and filament slots, and how many triangles each filament slot paints.
 * Filament slots are 1-based, matching the slicer's numbering.
 */
export function summarizeFile(parsed) {
  const { mesh, triColor, palette, objects } = parsed;
  const { vertProperties, triVerts, numProp } = mesh;
  const perSlot = new Array(palette.length).fill(0);
  let uncolouredTriangles = 0;
  for (let t = 0; t < triColor.length; t++) {
    if (triColor[t] >= 0) perSlot[triColor[t]]++; else uncolouredTriangles++;
  }
  const outObjects = objects.map((o) => {
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    const slots = new Set();
    for (let t = o.firstTriangle; t < o.firstTriangle + o.triangleCount; t++) {
      if (triColor[t] >= 0) slots.add(triColor[t] + 1);
      for (let k = 0; k < 3; k++) {
        const v = triVerts[t * 3 + k] * numProp;
        for (let a = 0; a < 3; a++) {
          const c = vertProperties[v + a];
          if (c < min[a]) min[a] = c;
          if (c > max[a]) max[a] = c;
        }
      }
    }
    const empty = o.triangleCount === 0;
    return {
      name: o.name,
      ...(o.plate !== undefined ? { plate: o.plate } : {}),
      triangles: o.triangleCount,
      size: empty ? [0, 0, 0] : [round(max[0] - min[0]), round(max[1] - min[1]), round(max[2] - min[2])],
      minZ: empty ? 0 : round(min[2]),
      filaments: [...slots].sort((a, b) => a - b),
    };
  });
  return {
    flavor: parsed.flavor,
    ...(parsed.application ? { application: parsed.application } : {}),
    colorSource: parsed.colorSource,
    triangles: mesh.numTri,
    objects: outObjects,
    plates: (parsed.plates ?? []).map((p) => ({ id: p.id, name: p.name })),
    filaments: palette.map((p, i) => ({ slot: i + 1, hex: p.hex, name: p.name, triangles: perSlot[i] })),
    uncolouredTriangles,
    splitPaintedTriangles: parsed.splitPaintedTriangles ?? 0,
    skippedParts: parsed.skippedParts ?? 0,
  };
}

/**
 * Summarise the slicer's `result.json` files. `load` is the result of any run
 * that loaded the file (a plate render, or the slice when rendering is off);
 * `slice` is the slice run's result, or null when slicing was skipped.
 */
export function summarizeSlicer(load, slice) {
  const ok = (r) => !!r && r.return_code === 0;
  const out = {
    loaded: ok(load),
    ...(load && !ok(load) ? { loadError: `${load.error_string ?? 'unknown error'} (code ${load.return_code})` } : {}),
    ...(!load ? { loadError: 'the slicer wrote no result' } : {}),
    sliced: slice === null ? null : ok(slice),
    ...(slice && !ok(slice) ? { sliceError: `${slice.error_string ?? 'unknown error'} (code ${slice.return_code})` } : {}),
    plates: [],
  };
  for (const p of (ok(slice) ? slice.sliced_plates ?? [] : [])) {
    out.plates.push({
      id: p.id,
      objects: (p.objects ?? []).map((o) => ({
        name: o.name,
        triangles: o.triangle_count,
        size: [round(o.bbox?.width ?? 0), round(o.bbox?.depth ?? 0), round(o.bbox?.height ?? 0)],
        z: round(o.bbox?.z ?? 0),
      })),
      filaments: (p.filaments ?? []).map((f) => ({ slot: f.id, grams: round(f.main_used_g ?? 0, 2), totalGrams: round(f.total_used_g ?? 0, 2) })),
      filamentChanges: p.filament_change_times ?? 0,
      printSeconds: Math.round(p.main_predication ?? p.total_predication ?? 0),
      ...(p.warning_message ? { warning: p.warning_message } : {}),
    });
  }
  return out;
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Compare the two summaries. Returns `{ checks, warnings }`; each check is
 * `{ name, ok, detail }`. `file` may be null (our reader could not parse it).
 * `expect` holds optional caller expectations: `{ filaments, objects, plates }`.
 */
export function buildChecks(file, slicer, expect = {}) {
  const checks = [];
  const warnings = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  add('slicer-loads', slicer.loaded, slicer.loaded ? 'the slicer opened the file' : slicer.loadError);
  if (slicer.sliced !== null) add('slicer-slices', slicer.sliced, slicer.sliced ? 'the slicer produced G-code' : (slicer.sliceError ?? 'not attempted: the file did not load'));

  const sObjects = slicer.plates.flatMap((p) => p.objects);
  const sSlots = [...new Set(slicer.plates.flatMap((p) => p.filaments.filter((f) => f.grams > 0).map((f) => f.slot)))].sort((a, b) => a - b);

  if (file && slicer.sliced) {
    add('object-count', file.objects.length === sObjects.length, `file has ${file.objects.length}, slicer sliced ${sObjects.length}`);

    // Match by name when names are unique on both sides, else by order.
    const unique = (list) => new Set(list.map((o) => o.name)).size === list.length;
    const byName = unique(file.objects) && unique(sObjects);
    const sizeProblems = [];
    const offBed = [];
    file.objects.forEach((fo, i) => {
      const so = byName ? sObjects.find((o) => o.name === fo.name) : sObjects[i];
      if (!so) { sizeProblems.push(`"${fo.name}" is not in the slicer's result`); return; }
      const off = fo.size.map((d, a) => Math.abs(d - so.size[a]));
      if (off.some((d) => d > SIZE_TOLERANCE_MM)) sizeProblems.push(`"${fo.name}": file ${fo.size.join(' × ')} mm, slicer ${so.size.join(' × ')} mm`);
      if (fo.triangles !== so.triangles) warnings.push(`"${fo.name}": the file has ${fo.triangles} triangles, the slicer kept ${so.triangles} (it repaired or dropped some)`);
      if (Math.abs(fo.minZ) > SIZE_TOLERANCE_MM) offBed.push(`"${fo.name}" starts at z = ${fo.minZ} mm`);
    });
    add('object-sizes', sizeProblems.length === 0, sizeProblems.length === 0 ? `all ${file.objects.length} object(s) agree within ${SIZE_TOLERANCE_MM} mm` : sizeProblems.join('; '));
    add('objects-on-bed', offBed.length === 0, offBed.length === 0 ? 'every object sits on z = 0' : offBed.join('; '));

    const fSlots = file.filaments.filter((f) => f.triangles > 0).map((f) => f.slot);
    add('filaments-used', sameSet(fSlots, sSlots), `file paints slots [${fSlots.join(', ')}], slicer extruded slots [${sSlots.join(', ')}]`);
  }

  if (expect.filaments !== undefined) {
    const got = slicer.sliced ? sSlots.length : file ? file.filaments.filter((f) => f.triangles > 0).length : null;
    add('expect-filaments', got === expect.filaments, `expected ${expect.filaments}, got ${got ?? 'unknown'}${slicer.sliced ? '' : ' (from the file; not sliced)'}`);
  }
  if (expect.objects !== undefined) {
    const got = slicer.sliced ? sObjects.length : file ? file.objects.length : null;
    add('expect-objects', got === expect.objects, `expected ${expect.objects}, got ${got ?? 'unknown'}`);
  }
  if (expect.plates !== undefined) {
    const got = slicer.sliced ? slicer.plates.length : file ? file.plates.length : null;
    add('expect-plates', got === expect.plates, `expected ${expect.plates}, got ${got ?? 'unknown'}`);
  }

  for (const p of slicer.plates) if (p.warning) warnings.push(`slicer, plate ${p.id}: ${p.warning}`);
  if (file) {
    if (file.splitPaintedTriangles > 0) warnings.push(`${file.splitPaintedTriangles} triangle(s) are split between filaments; our reader reports each by its dominant filament`);
    if (file.skippedParts > 0) warnings.push(`${file.skippedParts} modifier/support part(s) in the file are not printed geometry and were skipped`);
  } else {
    warnings.push('our own 3MF reader could not parse the file, so the file-vs-slicer checks were skipped');
  }
  return { checks, warnings };
}
