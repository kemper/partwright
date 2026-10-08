// Vertex weld + connected-component split on a triangle-soup mesh.
//
// A "component" here means a set of triangles whose vertices reach each
// other by walking triangle edges. Two physically separate solids in the
// same STL land in different components; two solids that share even one
// vertex after welding get merged, which is what you want for an STL that
// stored a single solid as two touching halves.

export function weldVertices(mesh, tol = 1e-5) {
  const { triangles } = mesh;
  const inv = 1 / tol;
  const vertexIds = new Int32Array(triangles.length / 3);
  const positions = []; // flat xyz of unique verts
  const map = new Map();
  for (let i = 0, j = 0; i < triangles.length; i += 3, j++) {
    const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2];
    const key =
      Math.round(x * inv) + ',' + Math.round(y * inv) + ',' + Math.round(z * inv);
    let id = map.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      positions.push(x, y, z);
      map.set(key, id);
    }
    vertexIds[j] = id;
  }
  return {
    vertices: Float32Array.from(positions),
    triangles: vertexIds, // 3 vertex ids per triangle
  };
}

function makeDSU(n) {
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  return { find, union };
}

// Group triangles into connected components by shared welded vertices.
// Returns an array of components; each is `{ triangles: Float32Array }` in
// the ORIGINAL float-vertex encoding so it can be handed straight to
// writeBinaryStl. Sorted by triangle count descending.
export function connectedComponents(mesh, opts = {}) {
  const tol = opts.tol ?? 1e-5;
  const welded = weldVertices(mesh, tol);
  const vertCount = welded.vertices.length / 3;
  const triCount = welded.triangles.length / 3;
  const dsu = makeDSU(vertCount);
  for (let t = 0; t < triCount; t++) {
    const a = welded.triangles[t * 3];
    const b = welded.triangles[t * 3 + 1];
    const c = welded.triangles[t * 3 + 2];
    dsu.union(a, b);
    dsu.union(b, c);
  }
  const buckets = new Map();
  const src = mesh.triangles;
  for (let t = 0; t < triCount; t++) {
    const root = dsu.find(welded.triangles[t * 3]);
    let bucket = buckets.get(root);
    if (!bucket) {
      bucket = [];
      buckets.set(root, bucket);
    }
    const off = t * 9;
    for (let k = 0; k < 9; k++) bucket.push(src[off + k]);
  }
  const components = [];
  for (const arr of buckets.values()) {
    components.push({ triangles: Float32Array.from(arr) });
  }
  components.sort((a, b) => b.triangles.length - a.triangles.length);
  return components;
}
