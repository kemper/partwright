import { describe, it, expect } from 'vitest';
import { build3MFProject, type PartExport } from '../../src/export/threemfProject';
import { parse3MF } from '../../src/import/parsers/threemf';
import { openZip } from '../../src/import/zipReader';
import type { MeshData } from '../../src/geometry/types';

/** A closed box, 10 × 10 × `h` mm, sitting at z = `z0`. Optionally painted per triangle. */
function boxMesh(h: number, z0 = 0, colors?: [number, number, number][]): MeshData {
  const v = [0, 0, z0, 10, 0, z0, 10, 10, z0, 0, 10, z0, 0, 0, z0 + h, 10, 0, z0 + h, 10, 10, z0 + h, 0, 10, z0 + h];
  const t = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  const mesh: MeshData = { vertProperties: new Float32Array(v), triVerts: new Uint32Array(t), numVert: 8, numTri: 12, numProp: 3 };
  if (colors) mesh.triColors = new Uint8Array(Array.from({ length: 12 }, (_, i) => colors[i % colors.length]).flat());
  return mesh;
}

const LAYERS = { changes: [{ z: 0, color: '#f0f0f0' }, { z: 4, color: '#dc1e1e' }, { z: 8, color: '#1e50dc' }] };

async function exportAndRead(parts: PartExport[], opts: Parameters<typeof build3MFProject>[1] = {}) {
  const warnings: string[] = [];
  const bytes = new Uint8Array(await build3MFProject(parts, { bambu: true, onWarning: m => warnings.push(m), ...opts }).blob.arrayBuffer());
  const zip = openZip(bytes);
  const entry = zip.find('Metadata/custom_gcode_per_layer.xml');
  const xml = entry ? new TextDecoder().decode(await zip.read(entry)) : null;
  const settingsEntry = zip.find('Metadata/project_settings.config');
  const settings = (settingsEntry ? JSON.parse(new TextDecoder().decode(await zip.read(settingsEntry))) : {}) as Record<string, unknown>;
  return { parsed: await parse3MF(bytes), xml, settings, warnings };
}

describe('3MF project export — colours by layer height', () => {
  it('writes one filament per band and a switch at the top of each band\'s first layer', async () => {
    const { parsed, xml, settings, warnings } = await exportAndRead([{ name: 'block', mesh: boxMesh(12, 5), layerColors: LAYERS }]);
    expect(warnings).toEqual([]);
    expect(parsed.palette.map(p => p.hex)).toEqual(['#f0f0f0', '#dc1e1e', '#1e50dc']);
    // The object itself is one filament: the first band's.
    expect(new Set(Array.from(parsed.triColor).map(i => parsed.palette[i].hex))).toEqual(new Set(['#f0f0f0']));
    expect(parsed.layerChanges).toEqual([{ plate: 1, entries: [
      { topZ: 4.2, kind: 'filament', slot: 2, color: '#dc1e1e' },
      { topZ: 8.2, kind: 'filament', slot: 3, color: '#1e50dc' },
    ] }]);
    expect(xml).toContain('<mode value="MultiAsSingle"/>');
    // The template's own layer heights are kept when nothing overrides them.
    expect(settings.layer_height).toBe('0.2');
    expect(settings.initial_layer_print_height).toBe('0.2');
    expect((settings.filament_colour as string[])).toEqual(['#F0F0F0', '#DC1E1E', '#1E50DC']);
  });

  it('uses the declared layer heights for both the switches and the project profile', async () => {
    const spec = { changes: [{ z: 0, color: '#f0f0f0' }, { z: 5, color: '#dc1e1e' }, { z: 9, color: '#1e50dc' }], layerHeight: 0.16, firstLayerHeight: 0.24 };
    const { parsed, settings } = await exportAndRead([{ name: 'block', mesh: boxMesh(12), layerColors: spec }]);
    // 5 mm snaps to the boundary at 0.24 + 30 × 0.16 = 5.04; the first new layer tops out at 5.2.
    expect(parsed.layerChanges![0].entries.map(e => e.topZ)).toEqual([5.2, 9.2]);
    expect(settings.layer_height).toBe('0.16');
    expect(settings.initial_layer_print_height).toBe('0.24');
  });

  it('with no entry on the bed, the object starts in the default filament', async () => {
    const { parsed } = await exportAndRead([{ name: 'block', mesh: boxMesh(12), layerColors: { changes: [{ z: 6, color: '#dc1e1e' }] } }]);
    expect(parsed.palette.map(p => p.hex)).toEqual(['#d9d9d9', '#dc1e1e']);
    expect(parsed.layerChanges![0].entries).toEqual([{ topZ: 6.2, kind: 'filament', slot: 2, color: '#dc1e1e' }]);
  });

  it('leaves a layer-coloured object\'s paint out and says so', async () => {
    const painted = boxMesh(12, 0, [[255, 0, 0], [0, 255, 0]]);
    const { parsed, warnings } = await exportAndRead([{ name: 'block', mesh: painted, layerColors: LAYERS }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('both paint and layer colours');
    expect(parsed.palette.map(p => p.hex)).toEqual(['#f0f0f0', '#dc1e1e', '#1e50dc']); // no paint colours
    expect(parsed.layerChanges![0].entries).toHaveLength(2);
  });

  it('keeps other objects\' paint, and gives each object its own plate\'s switches', async () => {
    const painted = boxMesh(6, 0, [[0, 128, 0]]);
    const { parsed, warnings } = await exportAndRead([{ name: 'green', mesh: painted }, { name: 'block', mesh: boxMesh(12), layerColors: LAYERS }]);
    expect(warnings).toEqual([]);
    expect(parsed.palette.map(p => p.hex)).toEqual(['#008000', '#f0f0f0', '#dc1e1e', '#1e50dc']);
    expect(parsed.layerChanges).toEqual([{ plate: 2, entries: [
      { topZ: 4.2, kind: 'filament', slot: 3, color: '#dc1e1e' },
      { topZ: 8.2, kind: 'filament', slot: 4, color: '#1e50dc' },
    ] }]);
  });

  it('skips the switches for a plate shared with a different object, with a warning', async () => {
    const { parsed, warnings } = await exportAndRead(
      [{ name: 'plain', mesh: boxMesh(6) }, { name: 'block', mesh: boxMesh(12), layerColors: LAYERS }],
      { plateLayout: 'grid' },
    );
    expect(parsed.layerChanges).toBeUndefined();
    expect(warnings.join(' ')).toContain('Give each layer-coloured object its own plate');
  });

  it('keeps the switches when every object on the plate declares the same ones', async () => {
    const { parsed, warnings } = await exportAndRead(
      [{ name: 'a', mesh: boxMesh(12), layerColors: LAYERS }, { name: 'b', mesh: boxMesh(12), layerColors: LAYERS }],
      { plateLayout: 'grid' },
    );
    expect(warnings).toEqual([]);
    expect(parsed.layerChanges).toHaveLength(1);
    expect(parsed.layerChanges![0].entries).toHaveLength(2);
  });

  it('a generic (non-project) export carries no layer colours and says so', async () => {
    const { parsed, xml, warnings } = await exportAndRead([{ name: 'block', mesh: boxMesh(12), layerColors: LAYERS }], { bambu: false });
    expect(xml).toBeNull();
    expect(parsed.layerChanges).toBeUndefined();
    expect(warnings.join(' ')).toContain('only written to the Bambu/Orca project export');
  });

  it('an export with no layer colours is unchanged: no file, no warnings', async () => {
    const { xml, warnings, parsed } = await exportAndRead([{ name: 'block', mesh: boxMesh(12) }]);
    expect(xml).toBeNull();
    expect(warnings).toEqual([]);
    expect(parsed.palette.map(p => p.hex)).toEqual(['#d9d9d9']);
  });
});
