import type { MeshData } from '../types';

/**
 * Minimal AMF reader for OpenSCAD's `--export-format=amf --enable=lazy-union`
 * output. We don't aim to be a general AMF library — only what OpenSCAD emits:
 *
 *   <amf>
 *     <object id="0">
 *       <mesh>
 *         <vertices>
 *           <vertex><coordinates><x>..</x><y>..</y><z>..</z></coordinates></vertex>
 *           ...
 *         </vertices>
 *         <volume>
 *           <triangle><v1>..</v1><v2>..</v2><v3>..</v3></triangle>
 *           ...
 *         </volume>
 *       </mesh>
 *     </object>
 *     <object id="1">...</object>
 *   </amf>
 *
 * Returns one MeshData per `<object>` in document order. lazy-union emits
 * exactly one object per top-level geometry statement in the SCAD source.
 */
export function parseAmfObjects(text: string): MeshData[] {
  const out: MeshData[] = [];
  const objects = splitObjects(text);
  for (const objText of objects) {
    const mesh = parseSingleObject(objText);
    if (mesh && mesh.numTri > 0) out.push(mesh);
  }
  return out;
}

/** Split the AMF document into per-`<object>` substrings, in document order. */
function splitObjects(text: string): string[] {
  const out: string[] = [];
  const re = /<object\b[^>]*>([\s\S]*?)<\/object>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

const VERT_RE = /<vertex>\s*<coordinates>\s*<x>([^<]+)<\/x>\s*<y>([^<]+)<\/y>\s*<z>([^<]+)<\/z>/g;
const TRI_RE = /<triangle>\s*<v1>([^<]+)<\/v1>\s*<v2>([^<]+)<\/v2>\s*<v3>([^<]+)<\/v3>/g;

function parseSingleObject(objText: string): MeshData | null {
  const positions: number[] = [];
  VERT_RE.lastIndex = 0;
  let m;
  while ((m = VERT_RE.exec(objText)) !== null) {
    positions.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  const tris: number[] = [];
  TRI_RE.lastIndex = 0;
  while ((m = TRI_RE.exec(objText)) !== null) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const c = parseInt(m[3], 10);
    if (a === b || b === c || a === c) continue; // skip degenerate
    tris.push(a, b, c);
  }
  if (positions.length === 0 || tris.length === 0) return null;
  return {
    vertProperties: new Float32Array(positions),
    triVerts: new Uint32Array(tris),
    numVert: positions.length / 3,
    numTri: tris.length / 3,
    numProp: 3,
  };
}
