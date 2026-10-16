import { describe, it, expect } from 'vitest';
import { parse3MF, weldMesh, normalizeHexColor } from '../../src/import/parsers/threemf';
import { openZip, looksLikeZip } from '../../src/import/zipReader';
import { dominantPaintColorState, encodePaintColorState } from '../../src/export/paintColor3mf';
import { buildZip } from '../../src/export/zip';
import { build3MF } from '../../src/export/threemf';
import { build3MFProject } from '../../src/export/threemfProject';
import { classifyImportSource } from '../../src/import/importInbox';
import { classifyRemoteResource, ensureExtensionForSource } from '../../src/import/urlImport';
import type { MeshData } from '../../src/geometry/types';

const enc = (s: string) => new TextEncoder().encode(s);

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

// A unit tetrahedron (4 verts, 4 outward-wound faces) as 3MF mesh XML.
function tetraMesh(extraTriAttrs: string[] = []): string {
  const tris = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [0, 3, 2]];
  return `<mesh><vertices>
    <vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="0"/><vertex x="0" y="0" z="10"/>
  </vertices><triangles>
    ${tris.map((t, i) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}" ${extraTriAttrs[i] ?? ''}/>`).join('\n    ')}
  </triangles></mesh>`;
}

function pkg(files: Record<string, string>): Uint8Array {
  return buildZip(Object.entries({ '_rels/.rels': RELS, ...files }).map(([name, text]) => ({ name, data: enc(text) })));
}

/** Signed volume (positive for outward-wound closed meshes). */
function signedVolume(m: MeshData): number {
  let v = 0;
  const p = m.vertProperties;
  for (let t = 0; t < m.numTri; t++) {
    const [a, b, c] = [m.triVerts[t * 3], m.triVerts[t * 3 + 1], m.triVerts[t * 3 + 2]];
    v += (p[a * 3] * (p[b * 3 + 1] * p[c * 3 + 2] - p[b * 3 + 2] * p[c * 3 + 1])
      - p[a * 3 + 1] * (p[b * 3] * p[c * 3 + 2] - p[b * 3 + 2] * p[c * 3])
      + p[a * 3 + 2] * (p[b * 3] * p[c * 3 + 1] - p[b * 3 + 1] * p[c * 3])) / 6;
  }
  return v;
}

/** A deflate-compressed single-entry ZIP (the writer under test is STORE-only). */
async function deflatedZip(name: string, data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const comp = new Uint8Array(await new Response(stream).arrayBuffer());
  const nameBytes = enc(name);
  const local = new Uint8Array(30 + nameBytes.length + comp.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true);
  lv.setUint32(18, comp.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30); local.set(comp, 30 + nameBytes.length);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true);
  cv.setUint32(20, comp.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true); central.set(nameBytes, 46);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true); ev.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + central.length + eocd.length);
  out.set(local); out.set(central, local.length); out.set(eocd, local.length + central.length);
  return out;
}

describe('zipReader', () => {
  it('reads STORE entries written by the exporter zip builder', async () => {
    const zip = openZip(buildZip([{ name: 'a/b.txt', data: enc('hello') }]));
    expect(zip.entries.map(e => e.name)).toEqual(['a/b.txt']);
    expect(await zip.readText(zip.find('/A/B.TXT')!)).toBe('hello');
  });

  it('inflates DEFLATE entries', async () => {
    const text = 'x'.repeat(5000) + 'tail';
    const zip = openZip(await deflatedZip('big.txt', enc(text)));
    expect(zip.entries[0].method).toBe(8);
    expect(await zip.readText(zip.find('big.txt')!)).toBe(text);
  });

  it('rejects non-zip input and detects the magic', () => {
    expect(() => openZip(enc('solid cube\nendsolid'))).toThrow(/ZIP/);
    expect(looksLikeZip(buildZip([{ name: 'x', data: enc('y') }]))).toBe(true);
    expect(looksLikeZip(enc('solid'))).toBe(false);
  });
});

describe('dominantPaintColorState', () => {
  it('decodes every leaf the exporter can write', () => {
    for (let s = 0; s <= 254; s++) expect(dominantPaintColorState(encodePaintColorState(s))).toBe(s);
  });

  it('takes the majority filament of a split triangle', () => {
    // Nibble stream (read right-to-left): root split 3 sides (4 children) →
    // children states 1, 1, 2, 0. String is the nibbles reversed.
    expect(dominantPaintColorState('08443')).toBe(1);
    // Mostly unpainted → inherit (0).
    expect(dominantPaintColorState('00043')).toBe(0);
    // Nested split: child 0 splits into two leaves of state 2.
    // stream: [split1→2 children][split3→4 children: 8,8,4,0]... keep it simple:
    // root 1-side split (2 children): child A = state 2, child B = state 3 (0C).
    // nibbles: 1, 8, C, 0 → string "0C81" ; tie (½ each) → first max wins.
    expect([2, 3]).toContain(dominantPaintColorState('0C81'));
  });

  it('is lenient with malformed input', () => {
    expect(dominantPaintColorState('')).toBe(0);
    expect(dominantPaintColorState('zz')).toBe(0);
    expect(dominantPaintColorState('3')).toBe(0); // truncated split
    expect(dominantPaintColorState('8')).toBe(2);
    expect(dominantPaintColorState('1c')).toBe(4); // lower-case hex
  });
});

describe('parse3MF — plain 3MF', () => {
  it('bakes build/unit transforms, recentres XY, and keeps winding under mirroring', async () => {
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Two &amp; tetra</metadata>
  <resources>
    <object id="1" type="model">${tetraMesh()}</object>
    <object id="9" type="support">${tetraMesh()}</object>
  </resources>
  <build>
    <item objectid="1" transform="1 0 0 0 1 0 0 0 1 100 100 0"/>
    <item objectid="1" transform="-1 0 0 0 1 0 0 0 1 120 100 0"/>
    <item objectid="9"/>
  </build>
</model>`;
    const r = await parse3MF(pkg({ '3D/3dmodel.model': model }));
    expect(r.title).toBe('Two & tetra');
    expect(r.flavor).toBe('generic');
    expect(r.colorSource).toBe('none');
    expect(r.mesh.numTri).toBe(8);
    expect(r.skippedParts).toBe(1);
    expect(r.triColor.every(c => c === -1)).toBe(true);
    // cm → mm: each tetra is 100 mm on a side; volume 100³/6 each, both positive.
    expect(signedVolume(r.mesh)).toBeCloseTo(2 * 1e6 / 6, 0);
    // XY recentred: copies span x ∈ [1000-100, 1200]·mm-ish → centre at 0.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity;
    for (let i = 0; i < r.mesh.numVert; i++) {
      minX = Math.min(minX, r.mesh.vertProperties[i * 3]);
      maxX = Math.max(maxX, r.mesh.vertProperties[i * 3]);
      minZ = Math.min(minZ, r.mesh.vertProperties[i * 3 + 2]);
    }
    expect(minX + maxX).toBeCloseTo(0, 3);
    expect(minZ).toBeCloseTo(0, 5);
  });

  it('resolves basematerials and m:colorgroup per object and per triangle', async () => {
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
  <resources>
    <basematerials id="5"><base name="Red PLA" displaycolor="#FF0000FF"/><base name="Blue" displaycolor="#0000ff"/></basematerials>
    <m:colorgroup id="6"><m:color color="#00FF00"/></m:colorgroup>
    <object id="1" type="model" pid="5" pindex="0">${tetraMesh(['', 'pid="5" p1="1"', 'pid="6" p1="0"', ''])}</object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;
    const r = await parse3MF(pkg({ '3D/3dmodel.model': model }));
    expect(r.colorSource).toBe('materials');
    expect(r.palette).toEqual([
      { hex: '#ff0000', name: 'Red PLA' },
      { hex: '#0000ff', name: 'Blue' },
      { hex: '#00ff00', name: 'Color 3' },
    ]);
    expect(Array.from(r.triColor)).toEqual([0, 1, 2, 0]);
  });

  it('round-trips Partwright’s own coloured 3MF export', async () => {
    const mesh: MeshData = {
      vertProperties: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
      triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
      numVert: 4, numTri: 4, numProp: 3,
      triColors: new Uint8Array([255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]),
    };
    const bytes = new Uint8Array(await build3MF(mesh).blob.arrayBuffer());
    const r = await parse3MF(bytes);
    expect(r.mesh.numTri).toBe(4);
    const hexes = Array.from(r.triColor).map(i => r.palette[i].hex);
    expect(hexes).toEqual(['#ff0000', '#ff0000', '#0000ff', '#0000ff']);
  });
});

describe('parse3MF — slicer projects', () => {
  it('reads a Bambu project: p:path components, part extruders, paint_color, filament palette', async () => {
    const root = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
  <metadata name="Application">BambuStudio-02.00.01.50</metadata>
  <resources>
    <object id="3" type="model"><components>
      <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
      <component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 20 0 0"/>
      <component p:path="/3D/Objects/object_1.model" objectid="4" transform="1 0 0 0 1 0 0 0 1 40 0 0"/>
    </components></object>
  </resources>
  <build><item objectid="3" transform="2 0 0 0 2 0 0 0 2 128 128 0"/></build>
</model>`;
    const objects = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <object id="1" type="model">${tetraMesh(['paint_color="8"', '', 'paint_color="08443"', ''])}</object>
    <object id="2" type="model">${tetraMesh()}</object>
    <object id="4" type="model">${tetraMesh()}</object>
  </resources>
</model>`;
    const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="3">
    <metadata key="name" value="Widget"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part"><metadata key="name" value="body"/></part>
    <part id="2" subtype="normal_part"><metadata key="extruder" value="3"/></part>
    <part id="4" subtype="modifier_part"><metadata key="extruder" value="2"/></part>
  </object>
  <plate><metadata key="plater_id" value="1"/></plate>
</config>`;
    const project = JSON.stringify({
      filament_colour: ['#FFFFFF', '#FF0000', '#00FF00'],
      filament_settings_id: ['Bambu PLA Basic @BBL A1', 'Generic PLA', 'Generic PETG'],
      filament_type: ['PLA', 'PLA', 'PETG'],
    });
    const r = await parse3MF(pkg({
      '3D/3dmodel.model': root,
      '3D/Objects/object_1.model': objects,
      'Metadata/model_settings.config': settings,
      'Metadata/project_settings.config': project,
    }));
    expect(r.flavor).toBe('bambu');
    expect(r.application).toBe('BambuStudio-02.00.01.50');
    expect(r.colorSource).toBe('filaments');
    expect(r.palette.map(p => p.hex)).toEqual(['#ffffff', '#ff0000', '#00ff00']);
    expect(r.palette[0].name).toBe('F1 Bambu PLA Basic');
    expect(r.objects).toEqual([{ name: 'Widget', triangleCount: 8 }]);
    expect(r.skippedParts).toBe(1); // the modifier part
    expect(r.splitPaintedTriangles).toBe(1);
    // part 1: [paint 2, inherit obj 1, split→majority 1, inherit 1]; part 2: extruder 3.
    expect(Array.from(r.triColor)).toEqual([1, 0, 0, 0, 2, 2, 2, 2]);
    // Build scale ×2 → each tetra volume 20³/6.
    expect(signedVolume(r.mesh)).toBeCloseTo(2 * 8000 / 6, 1);
  });

  it('reads a PrusaSlicer project: volume ranges, mmu_segmentation, extruder colours', async () => {
    const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
  <resources><object id="1" type="model">${tetraMesh(['', 'slic3rpe:mmu_segmentation="8"', '', ''])}</object></resources>
  <build><item objectid="1"/></build>
</model>`;
    const cfg = `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="1" instances_count="1">
  <metadata type="object" key="name" value="Gear"/>
  <metadata type="object" key="extruder" value="1"/>
  <volume firstid="0" lastid="1"><metadata type="volume" key="extruder" value="0"/></volume>
  <volume firstid="2" lastid="3"><metadata type="volume" key="extruder" value="2"/><metadata type="volume" key="volume_type" value="ModelPart"/></volume>
 </object>
</config>`;
    const print = '; generated by PrusaSlicer\n; extruder_colour = "";#0000FF\n; filament_colour = #FF8000;#808080\n; filament_type = PLA;PETG\n';
    const r = await parse3MF(pkg({
      '3D/3dmodel.model': model,
      'Metadata/Slic3r_PE_model.config': cfg,
      'Metadata/Slic3r_PE.config': print,
    }));
    expect(r.flavor).toBe('prusa');
    expect(r.palette.map(p => p.hex)).toEqual(['#ff8000', '#0000ff']);
    expect(Array.from(r.triColor)).toEqual([0, 1, 1, 1]);
  });

  it('reads a Partwright Bambu project export back with its filament slots', async () => {
    const mesh: MeshData = {
      vertProperties: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 10]),
      triVerts: new Uint32Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 0, 3, 2]),
      numVert: 4, numTri: 4, numProp: 3,
      triColors: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 255]),
    };
    const bytes = new Uint8Array(await build3MFProject([{ name: 'tetra', mesh }], { bambu: true }).blob.arrayBuffer());
    const r = await parse3MF(bytes);
    expect(r.flavor).toBe('bambu');
    expect(r.mesh.numTri).toBe(4);
    const hexes = Array.from(r.triColor).map(i => r.palette[i].hex);
    expect(hexes.filter(h => h === '#ff0000')).toHaveLength(3);
    expect(hexes.filter(h => h === '#0000ff')).toHaveLength(1);
  });
});

describe('3MF helpers', () => {
  it('weldMesh merges coincident vertices without reordering triangles', () => {
    const m: MeshData = {
      vertProperties: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1e-7, 0, 0, 1, 1, 0]),
      triVerts: new Uint32Array([0, 1, 2, 3, 4, 2]),
      numVert: 5, numTri: 2, numProp: 3,
    };
    const w = weldMesh(m, 1e-5);
    expect(w.numVert).toBe(4);
    expect(Array.from(w.triVerts)).toEqual([0, 1, 2, 0, 3, 2]);
  });

  it('normalizes hex colours', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor('FF000080')).toBe('#ff0000');
    expect(normalizeHexColor('nope')).toBeNull();
  });

  it('classifies .3mf files and content types', () => {
    expect(classifyImportSource('Model.3MF')).toBe('3MF');
    expect(classifyRemoteResource('download', 'model/3mf')).toBe('3MF');
    expect(ensureExtensionForSource('download', '3MF')).toBe('download.3mf');
  });
});
