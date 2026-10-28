// Skinned-figure viewer: the SDF-built figure, meshed once in its rest pose,
// deformed every frame by linear-blend skinning. Each frame's bone transforms
// come from running the real `F.rig()` (≈0.06 ms) on that frame's pose and
// comparing every bone's frame to its rest frame — no re-meshing.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createFigureNamespace } from '/src/geometry/sdfFigure.ts';
import { BODY, REST_POSE, BONES, frameDelta } from './rigCommon.mjs';
import { ANIMATIONS } from './animations.mjs';

const F = createFigureNamespace({});
const rigFor = (pose) => F.rig({ ...BODY, pose });
const statusEl = document.getElementById('status');
if (new URLSearchParams(location.search).has('capture')) document.getElementById('ui').style.display = 'none';

// --- Scene -----------------------------------------------------------------
const host = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d2025);
scene.fog = new THREE.Fog(0x1d2025, 140, 320);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.5, 1000);
camera.up.set(0, 0, 1);
camera.position.set(95, -130, 60);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 29);
controls.update();

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2420, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(40, -60, 110);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 10, far: 300 });
scene.add(sun);
const rim = new THREE.DirectionalLight(0x9fc4ff, 0.9);
rim.position.set(-60, 70, 60);
scene.add(rim);

const floor = new THREE.Mesh(new THREE.CircleGeometry(80, 64), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.95 }));
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(160, 32, 0x3a404a, 0x30353d);
grid.rotation.x = Math.PI / 2;
grid.position.z = 0.02;
scene.add(grid);

// --- Load the baked figure ---------------------------------------------------
const meta = await (await fetch('./figure.json')).json();
const bin = await (await fetch('./figure.bin')).arrayBuffer();
const { nV, nT, offsets } = meta;
const pos = new Float32Array(bin, offsets.positions, nV * 3);
const nrm = new Float32Array(bin, offsets.normals, nV * 3);
const tri = new Uint32Array(bin, offsets.triVerts, nT * 3);
const col = new Uint8Array(bin, offsets.triColors, nT * 3);
const sIdx = new Uint8Array(bin, offsets.skinIndex, nV * 4);
const sW = new Float32Array(bin, offsets.skinWeight, nV * 4);

// De-index so each triangle keeps its own paint colour (crisp label edges),
// while positions/normals/weights stay shared-vertex smooth.
const n = nT * 3;
const P = new Float32Array(n * 3), N = new Float32Array(n * 3), Cc = new Float32Array(n * 3);
const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
for (let c = 0; c < n; c++) {
  const v = tri[c], t = (c / 3) | 0;
  for (let k = 0; k < 3; k++) {
    P[c * 3 + k] = pos[v * 3 + k];
    N[c * 3 + k] = nrm[v * 3 + k];
    Cc[c * 3 + k] = (col[t * 3 + k] / 255) ** 2.2;   // sRGB → linear
  }
  for (let k = 0; k < 4; k++) { SI[c * 4 + k] = sIdx[v * 4 + k]; SW[c * 4 + k] = sW[v * 4 + k]; }
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
geo.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
geo.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4));
geo.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));

// Debug colouring: each vertex tinted by its bone weights.
const boneHue = BONES.map((_, i) => new THREE.Color().setHSL((i * 0.618) % 1, 0.7, 0.55));
const weightCol = new Float32Array(n * 3);
for (let c = 0; c < n; c++) {
  for (let k = 0; k < 4; k++) {
    const h = boneHue[SI[c * 4 + k]], w = SW[c * 4 + k];
    weightCol[c * 3] += h.r * w; weightCol[c * 3 + 1] += h.g * w; weightCol[c * 3 + 2] += h.b * w;
  }
}

// --- Skeleton ---------------------------------------------------------------
// Flat bone set under one root: each bone's WORLD transform is written
// directly from the rig every frame, so no parent chain has to agree with it.
const restRig = rigFor(REST_POSE);
const restFrames = BONES.map((b) => b.pose(restRig));
const root = new THREE.Bone();
const bones = BONES.map((b, i) => {
  const bone = new THREE.Bone();
  bone.name = b.name;
  bone.position.fromArray(restFrames[i].pivot);
  root.add(bone);
  return bone;
});
const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0 }));
mesh.castShadow = true;
mesh.receiveShadow = true;
mesh.add(root);
mesh.updateMatrixWorld(true);
mesh.bind(new THREE.Skeleton(bones));
scene.add(mesh);

// Skeleton overlay: lines between the rig's joints.
const SKEL = [['hips', 'spine'], ['spine', 'chest'], ['chest', 'neck'], ['neck', 'head'], ['head', 'crown'],
  ...['L', 'R'].flatMap((s) => [['neck', `upperArm${s}`], [`upperArm${s}`, `lowerArm${s}`], [`lowerArm${s}`, `wrist${s}`], [`wrist${s}`, `hand${s}`],
    ['hips', `upperLeg${s}`], [`upperLeg${s}`, `lowerLeg${s}`], [`lowerLeg${s}`, `foot${s}`]])];
const skelGeo = new THREE.BufferGeometry();
skelGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SKEL.length * 6), 3));
const skelLines = new THREE.LineSegments(skelGeo, new THREE.LineBasicMaterial({ color: 0xffd34d, depthTest: false }));
skelLines.renderOrder = 10;
skelLines.visible = false;
scene.add(skelLines);

const m3 = new THREE.Matrix3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
const restFloor = restRig.floorZ;
let currentPose = REST_POSE;
floor.position.z = restFloor;
grid.position.z = restFloor + 0.02;

function applyPose(pose) {
  currentPose = pose;
  const rig = rigFor(pose);
  // Keep the lowest sole on the floor, like F.place/ground does for printing.
  const lift = restFloor - rig.floorZ;
  BONES.forEach((b, i) => {
    const f = b.pose(rig);
    m3.fromArray(frameDelta(restFrames[i].axes, f.axes));
    m4.setFromMatrix3(m3);
    q.setFromRotationMatrix(m4);
    bones[i].quaternion.copy(q);
    bones[i].position.set(f.pivot[0], f.pivot[1], f.pivot[2] + lift);
  });
  const a = skelGeo.attributes.position.array;
  SKEL.forEach(([u, v], i) => {
    a.set([rig.joints[u][0], rig.joints[u][1], rig.joints[u][2] + lift], i * 6);
    a.set([rig.joints[v][0], rig.joints[v][1], rig.joints[v][2] + lift], i * 6 + 3);
  });
  skelGeo.attributes.position.needsUpdate = true;
}

// --- UI ---------------------------------------------------------------------
let anim = 'walk', playing = true, phase = 0, last = performance.now();
const animsEl = document.getElementById('anims');
for (const name of Object.keys(ANIMATIONS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => { anim = name; [...animsEl.children].forEach((c) => c.classList.toggle('on', c === b)); };
  if (name === anim) b.classList.add('on');
  animsEl.appendChild(b);
}
const playBtn = document.getElementById('play');
const scrub = document.getElementById('scrub');
playBtn.onclick = () => { playing = !playing; playBtn.textContent = playing ? 'Pause' : 'Play'; };
scrub.oninput = () => { playing = false; playBtn.textContent = 'Play'; phase = +scrub.value; };
document.getElementById('bones').onchange = (e) => { skelLines.visible = e.target.checked; };
document.getElementById('weights').onchange = (e) => {
  geo.attributes.color.array.set(e.target.checked ? weightCol : Cc);
  geo.attributes.color.needsUpdate = true;
};
const poseEl = document.getElementById('pose');
document.getElementById('snap').onclick = () => {
  playing = false; playBtn.textContent = 'Play';
  poseEl.style.display = 'block';
  poseEl.value = `// node prototypes/skinned-figure/print-pose.mjs '<this JSON>'\n${JSON.stringify(currentPose)}`;
};
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Hooks for scripted capture.
window.proto = {
  setAnim(name, t) { anim = name; phase = t; playing = false; applyPose(ANIMATIONS[anim].pose(phase)); renderer.render(scene, camera); },
  play(name) { anim = name; playing = true; },
  pose: () => currentPose,
  camera, controls,
  ready: true,
};

statusEl.textContent = `${nT.toLocaleString()} triangles · ${BONES.length} bones · meshed once, skinned per frame`;
let frames = 0, fpsT = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = (now - last) / 1000; last = now;
  if (playing) phase = (phase + dt / ANIMATIONS[anim].seconds) % 1;
  scrub.value = String(phase);
  applyPose(ANIMATIONS[anim].pose(phase));
  controls.update();
  renderer.render(scene, camera);
  frames++;
  if (now - fpsT > 1000) {
    statusEl.textContent = `${nT.toLocaleString()} triangles · ${BONES.length} bones · ${Math.round(frames * 1000 / (now - fpsT))} fps · meshed once, skinned per frame`;
    frames = 0; fpsT = now;
  }
});
