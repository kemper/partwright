import { describe, it, expect } from 'vitest';
import { parseAmfObjects } from '../../src/geometry/engines/amfParser';

// Minimal AMF fixtures matching the shape OpenSCAD's --export-format=amf emits.
// Each <object> has one <mesh> with <vertices> and <volume>/<triangle>.

const singleObjectTetra = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
 <object id="0">
  <mesh>
   <vertices>
    <vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>1</x><y>0</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>0</x><y>1</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>0</x><y>0</y><z>1</z></coordinates></vertex>
   </vertices>
   <volume>
    <triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle>
    <triangle><v1>0</v1><v2>1</v2><v3>3</v3></triangle>
    <triangle><v1>0</v1><v2>2</v2><v3>3</v3></triangle>
    <triangle><v1>1</v1><v2>2</v2><v3>3</v3></triangle>
   </volume>
  </mesh>
 </object>
</amf>`;

const twoObjects = `<?xml version="1.0" encoding="UTF-8"?>
<amf unit="millimeter">
 <object id="0">
  <mesh>
   <vertices>
    <vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>1</x><y>0</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>0</x><y>1</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>0</x><y>0</y><z>1</z></coordinates></vertex>
   </vertices>
   <volume>
    <triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle>
    <triangle><v1>0</v1><v2>1</v2><v3>3</v3></triangle>
   </volume>
  </mesh>
 </object>
 <object id="1">
  <mesh>
   <vertices>
    <vertex><coordinates><x>10</x><y>10</y><z>10</z></coordinates></vertex>
    <vertex><coordinates><x>11</x><y>10</y><z>10</z></coordinates></vertex>
    <vertex><coordinates><x>10</x><y>11</y><z>10</z></coordinates></vertex>
   </vertices>
   <volume>
    <triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle>
   </volume>
  </mesh>
 </object>
</amf>`;

describe('parseAmfObjects', () => {
  it('returns one MeshData per <object>', () => {
    const out = parseAmfObjects(twoObjects);
    expect(out).toHaveLength(2);
  });

  it('preserves source order', () => {
    const out = parseAmfObjects(twoObjects);
    // First object's first vertex sits at the origin; second's at (10,10,10).
    expect(out[0].vertProperties[0]).toBe(0);
    expect(out[1].vertProperties[0]).toBe(10);
  });

  it('parses vertex and triangle counts', () => {
    const out = parseAmfObjects(singleObjectTetra);
    expect(out).toHaveLength(1);
    expect(out[0].numVert).toBe(4);
    expect(out[0].numTri).toBe(4);
    expect(out[0].numProp).toBe(3);
    expect(out[0].vertProperties).toBeInstanceOf(Float32Array);
    expect(out[0].triVerts).toBeInstanceOf(Uint32Array);
  });

  it('returns empty array for AMF with no <object>', () => {
    const empty = '<?xml version="1.0" encoding="UTF-8"?><amf unit="millimeter"></amf>';
    expect(parseAmfObjects(empty)).toEqual([]);
  });

  it('skips an object that has no triangles', () => {
    const noTris = `<?xml version="1.0" encoding="UTF-8"?>
<amf>
 <object id="0">
  <mesh>
   <vertices>
    <vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
   </vertices>
   <volume></volume>
  </mesh>
 </object>
</amf>`;
    expect(parseAmfObjects(noTris)).toEqual([]);
  });

  it('drops degenerate triangles (repeated vertex indices)', () => {
    const withDegen = `<?xml version="1.0" encoding="UTF-8"?>
<amf>
 <object id="0">
  <mesh>
   <vertices>
    <vertex><coordinates><x>0</x><y>0</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>1</x><y>0</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>0</x><y>1</y><z>0</z></coordinates></vertex>
    <vertex><coordinates><x>0</x><y>0</y><z>1</z></coordinates></vertex>
   </vertices>
   <volume>
    <triangle><v1>0</v1><v2>1</v2><v3>2</v3></triangle>
    <triangle><v1>0</v1><v2>0</v2><v3>1</v3></triangle>
    <triangle><v1>1</v1><v2>2</v2><v3>3</v3></triangle>
   </volume>
  </mesh>
 </object>
</amf>`;
    const out = parseAmfObjects(withDegen);
    expect(out).toHaveLength(1);
    expect(out[0].numTri).toBe(2);
  });
});
