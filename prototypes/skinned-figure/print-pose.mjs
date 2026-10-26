// Rebuild one animation frame as a PRINTABLE figure: the same Character
// Creator spec as the skinned preview, with the frame's rig pose, a base, and
// F.place — meshed by the real SDF engine, so it is watertight and one piece.
//
// Usage:
//   node prototypes/skinned-figure/print-pose.mjs walk 0.25 [--out dir]
//   node prototypes/skinned-figure/print-pose.mjs '{"armL":{...},...}' [--out dir]
// Writes <name>.js (paste into the editor) and <name>.stl, and prints stats.
import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BODY } from './rigCommon.mjs';
import { ANIMATIONS } from './animations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args.splice(outIdx, 2)[1] : join(HERE, 'out');
let pose, name;
if (args[0]?.trim().startsWith('{')) { pose = JSON.parse(args[0]); name = 'pose'; }
else {
  const anim = ANIMATIONS[args[0]];
  if (!anim) throw new Error(`unknown animation '${args[0]}' — one of ${Object.keys(ANIMATIONS).join(', ')}`);
  const t = Number(args[1] ?? 0);
  pose = anim.pose(t); name = `${args[0]}-${t}`;
}

const server = await createServer({ root: join(HERE, '../..'), configFile: false, server: { middlewareMode: true, watch: null }, appType: 'custom', logLevel: 'silent', optimizeDeps: { noDiscovery: true } });
const S = await server.ssrLoadModule('/src/figure/characterSpec.ts');
const C = await server.ssrLoadModule('/src/figure/characterCodegen.ts');
const Pv = await server.ssrLoadModule('/src/tools/previewModel.ts');

const spec = S.cloneSpec(S.DEFAULT_SPEC);
Object.assign(spec.body, BODY);
const j = (p) => ({ raiseSide: 0, raiseFwd: 0, bend: 0, twist: 0, ...p });
spec.pose = {
  ...spec.pose, preset: 'custom',
  armL: j(pose.armL), armR: j(pose.armR), legL: j(pose.legL), legR: j(pose.legR),
  spine: { lean: 0, turn: 0, side: 0, ...pose.spine },
  head: { yaw: 0, pitch: 0, roll: 0, ...pose.head },
};
spec.base = true; spec.place = true;
const code = C.specToCode(spec);

const t0 = performance.now();
const res = await Pv.previewModel(code, { maxComponents: 1 });
if (!res.ok) { console.error(res.error); process.exit(1); }
const st = res.stats;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `${name}.js`), code);

// Binary STL straight from the preview mesh.
const { positions: p, triVerts: tv } = res.render;
const nT = tv.length / 3;
const stl = Buffer.alloc(84 + nT * 50);
stl.writeUInt32LE(nT, 80);
for (let t = 0; t < nT; t++) {
  const o = 84 + t * 50 + 12;
  for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) stl.writeFloatLE(p[tv[t * 3 + k] * 3 + c], o + (k * 3 + c) * 4);
}
writeFileSync(join(outDir, `${name}.stl`), stl);

console.log(JSON.stringify({
  frame: name, seconds: +((performance.now() - t0) / 1000).toFixed(1),
  isManifold: st.isManifold, componentCount: st.componentCount, triangles: st.triangleCount,
  bbox: st.bbox?.size?.map((v) => +v.toFixed(1)), warnings: st.warnings,
  wrote: [join(outDir, `${name}.js`), join(outDir, `${name}.stl`)],
}, null, 1));
await server.close();
