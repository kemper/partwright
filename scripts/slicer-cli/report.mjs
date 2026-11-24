// Pure report logic for `slicer-cli check`: turn what OUR reader sees in a 3MF
// and what the real slicer reports about the same file into one list of
// pass/fail checks. No I/O here, so it unit-tests in the vitest tier
// (tests/unit/slicerReport.test.ts).

/** Size agreement tolerance between our reader and the slicer, in mm. */
const SIZE_TOLERANCE_MM = 0.05;

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
    // Colour changes by layer height written in the project, flattened.
    layerChanges: (parsed.layerChanges ?? []).flatMap((p) => p.entries.map((e) => ({ plate: p.plate, topZ: e.topZ, kind: e.kind, slot: e.slot, color: e.color }))),
    splitPaintedTriangles: parsed.splitPaintedTriangles ?? 0,
    skippedParts: parsed.skippedParts ?? 0,
  };
}

const succeeded = (result, exit) => !!result && result.return_code === 0 && (exit === null || exit === undefined || exit === 0);

/** Why a slicer run did not succeed, in words. `exit` is the process exit status. */
function failure(result, exit) {
  if (!result) return `the slicer wrote no result (exit ${exit ?? 'unknown'}); it may have crashed`;
  if (result.return_code !== 0) return `${result.error_string ?? 'unknown error'} (code ${result.return_code})`;
  return `the slicer reported success but exited with status ${exit}`;
}

/**
 * Summarise what the slicer runs produced.
 *
 * @param {object} runs
 * @param {object|null} runs.load   `result.json` of the first run that loaded the file (a plate render, or the slice)
 * @param {number|null} runs.loadExit  that run's process exit status
 * @param {boolean} [runs.renderAttempted]  plate renders were requested
 * @param {string[]} [runs.renderFailures]  one line per render that failed
 * @param {boolean} [runs.sliceSkipped]   the caller asked not to slice
 * @param {boolean} [runs.sliceAttempted] a slice was started
 * @param {object|null} [runs.slice]      the slice run's `result.json` (null = none written)
 * @param {number|null} [runs.sliceExit]  the slice run's process exit status
 */
export function summarizeSlicer({ load = null, loadExit = null, renderAttempted = false, renderFailures = [], sliceSkipped = false, sliceAttempted = false, slice = null, sliceExit = null }) {
  const loaded = succeeded(load, loadExit);
  // null = not attempted (skipped, or the file never loaded); false = attempted and failed.
  const sliced = !sliceAttempted ? null : succeeded(slice, sliceExit);
  const out = {
    loaded,
    ...(loaded ? {} : { loadError: failure(load, loadExit) }),
    rendered: renderAttempted ? renderFailures.length === 0 : null,
    ...(renderFailures.length > 0 ? { renderErrors: renderFailures } : {}),
    sliced,
    sliceSkipped,
    ...(sliced === false ? { sliceError: failure(slice, sliceExit) } : {}),
    plates: [],
  };
  for (const p of (sliced ? slice.sliced_plates ?? [] : [])) {
    out.plates.push({
      id: p.id,
      objects: (p.objects ?? []).map((o) => ({
        name: o.name,
        triangles: o.triangle_count,
        size: [round(o.bbox?.width ?? 0), round(o.bbox?.depth ?? 0), round(o.bbox?.height ?? 0)],
        z: round(o.bbox?.z ?? 0),
      })),
      // `used` is decided on the raw weight: a small accent can round to 0.00 g.
      filaments: (p.filaments ?? []).map((f) => ({ slot: f.id, used: (f.main_used_g ?? 0) > 0, grams: round(f.main_used_g ?? 0, 2), totalGrams: round(f.total_used_g ?? 0, 2) })),
      filamentChanges: p.filament_change_times ?? 0,
      printSeconds: Math.round(p.main_predication ?? p.total_predication ?? 0),
      ...(p.warning_message ? { warning: p.warning_message } : {}),
    });
  }
  return out;
}

const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const isUnique = (keys) => new Set(keys).size === keys.length;

/**
 * Pair each file object with the slicer's object for it. By name when names
 * are unique on both sides; else by plate + name; else by position, which can
 * pair the wrong objects in a multi-plate file, so that case is reported.
 */
function pairObjects(fileObjects, slicerObjects) {
  const byKey = (key) => {
    if (!isUnique(fileObjects.map(key)) || !isUnique(slicerObjects.map(key))) return null;
    return fileObjects.map((fo) => [fo, slicerObjects.find((so) => key(so) === key(fo))]);
  };
  const pairs = byKey((o) => o.name) ?? byKey((o) => `${o.plate ?? ''}|${o.name}`);
  if (pairs) return { pairs, byPosition: false };
  return { pairs: fileObjects.map((fo, i) => [fo, slicerObjects[i]]), byPosition: true };
}

/**
 * Compare the two summaries. Returns `{ checks, warnings }`; each check is
 * `{ name, ok, detail }`. `file` is null when our reader could not parse the
 * 3MF (`context.fileError` says why). `expect` holds optional caller
 * expectations: `{ filaments, objects, plates }`.
 */
export function buildChecks(file, slicer, expect = {}, context = {}) {
  const checks = [];
  const warnings = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // Our reader is the app's own import path: failing on the app's own export is a defect.
  add('reader-parses', !!file, file ? 'our 3MF reader parsed the file' : `our 3MF reader could not parse the file: ${context.fileError ?? 'unknown error'}`);
  add('slicer-loads', slicer.loaded, slicer.loaded ? 'the slicer opened the file' : slicer.loadError);
  if (slicer.rendered !== null) add('slicer-renders', slicer.rendered, slicer.rendered ? 'every requested plate render was written' : slicer.renderErrors.join('; '));
  if (!slicer.sliceSkipped) {
    add('slicer-slices', slicer.sliced === true, slicer.sliced === true ? 'the slicer produced G-code' : (slicer.sliceError ?? 'not attempted: the file did not load'));
  }

  const sObjects = slicer.plates.flatMap((p) => p.objects.map((o) => ({ ...o, plate: p.id })));
  const sSlots = [...new Set(slicer.plates.flatMap((p) => p.filaments.filter((f) => f.used).map((f) => f.slot)))].sort((a, b) => a - b);

  if (file && slicer.sliced) {
    add('object-count', file.objects.length === sObjects.length, `file has ${file.objects.length}, slicer sliced ${sObjects.length}`);

    const { pairs, byPosition } = pairObjects(file.objects, sObjects);
    if (byPosition && file.objects.length > 1) warnings.push('object names repeat, so file and slicer objects were paired by position; a size mismatch (or match) may be between the wrong objects');
    const sizeProblems = [];
    const offBed = [];
    for (const [fo, so] of pairs) {
      if (Math.abs(fo.minZ) > SIZE_TOLERANCE_MM) offBed.push(`"${fo.name}" starts at z = ${fo.minZ} mm`);
      if (!so) { sizeProblems.push(`"${fo.name}" is not in the slicer's result`); continue; }
      const off = fo.size.map((d, a) => Math.abs(d - so.size[a]));
      if (off.some((d) => d > SIZE_TOLERANCE_MM)) sizeProblems.push(`"${fo.name}": file ${fo.size.join(' × ')} mm, slicer ${so.size.join(' × ')} mm`);
      if (fo.triangles !== so.triangles) warnings.push(`"${fo.name}": the file has ${fo.triangles} triangles, the slicer kept ${so.triangles} (it repaired or dropped some)`);
    }
    add('object-sizes', sizeProblems.length === 0, sizeProblems.length === 0 ? `all ${file.objects.length} object(s) agree within ${SIZE_TOLERANCE_MM} mm` : sizeProblems.join('; '));
    add('objects-on-bed', offBed.length === 0, offBed.length === 0 ? 'every object sits on z = 0' : offBed.join('; '));

    // Layer changes only take effect on a plate that prints in one filament:
    // the slicer ignores them where an object carries paint.
    const switches = (file.layerChanges ?? []).filter((c) => c.kind === 'filament');
    const paintedPlate = (id) => {
      const objects = file.objects.filter((o) => (o.plate ?? 1) === id);
      return objects.some((o) => o.filaments.length > 1) || new Set(objects.flatMap((o) => o.filaments)).size > 1;
    };
    const ignoredPlates = new Set([...new Set(switches.map((c) => c.plate))].filter(paintedPlate));
    const effective = switches.filter((c) => !ignoredPlates.has(c.plate));

    // Filaments the file asks for: every painted slot, plus the slots its
    // (effective) layer changes switch to.
    const fSlots = [...new Set([...file.filaments.filter((f) => f.triangles > 0).map((f) => f.slot), ...effective.map((c) => c.slot)])].sort((a, b) => a - b);
    add('filaments-used', sameSet(fSlots, sSlots), `file uses slots [${fSlots.join(', ')}]${effective.length > 0 ? ` (${effective.length} by layer change)` : ''}, slicer extruded slots [${sSlots.join(', ')}]`);

    // On a single-filament plate the slicer must make exactly the declared number of filament changes.
    for (const plate of slicer.plates) {
      const wanted = switches.filter((c) => c.plate === plate.id);
      if (wanted.length === 0) continue;
      if (ignoredPlates.has(plate.id)) {
        warnings.push(`plate ${plate.id}: the file has ${wanted.length} layer colour change(s), but its objects use more than one filament, so the slicer ignores them`);
        continue;
      }
      add('layer-changes', plate.filamentChanges === wanted.length, `plate ${plate.id}: file declares ${wanted.length} layer colour change(s), slicer made ${plate.filamentChanges} filament change(s)`);
    }
  }

  // A plain (non-project) 3MF lists no plates: its objects share one implicit plate.
  const filePlates = file ? file.plates.length || (file.objects.length > 0 ? 1 : 0) : null;
  if (expect.filaments !== undefined) {
    const got = slicer.sliced ? sSlots.length : file ? file.filaments.filter((f) => f.triangles > 0).length : null;
    add('expect-filaments', got === expect.filaments, `expected ${expect.filaments}, got ${got ?? 'unknown'}${slicer.sliced ? '' : ' (from the file; not sliced)'}`);
  }
  if (expect.objects !== undefined) {
    const got = slicer.sliced ? sObjects.length : file ? file.objects.length : null;
    add('expect-objects', got === expect.objects, `expected ${expect.objects}, got ${got ?? 'unknown'}${slicer.sliced ? '' : ' (from the file; not sliced)'}`);
  }
  if (expect.plates !== undefined) {
    const got = slicer.sliced ? slicer.plates.length : filePlates;
    add('expect-plates', got === expect.plates, `expected ${expect.plates}, got ${got ?? 'unknown'}${slicer.sliced ? '' : ' (from the file; not sliced)'}`);
  }

  for (const p of slicer.plates) if (p.warning) warnings.push(`slicer, plate ${p.id}: ${p.warning}`);
  if (file) {
    if (file.splitPaintedTriangles > 0) warnings.push(`${file.splitPaintedTriangles} triangle(s) are split between filaments; our reader reports each by its dominant filament`);
    if (file.skippedParts > 0) warnings.push(`${file.skippedParts} modifier/support part(s) in the file are not printed geometry and were skipped`);
  }
  return { checks, warnings };
}
