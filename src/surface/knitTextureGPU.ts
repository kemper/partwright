/**
 * WebGPU compute shader path for knit-stitch displacement.
 *
 * Replaces the per-vertex JS loop in knitTextureUVAsync with a GPU dispatch,
 * giving a ~20-50× speedup on dense meshes. Returns null if WebGPU is
 * unavailable (Firefox, old GPU drivers, headless CI) so the caller falls back
 * to the JS path transparently — no user-visible difference, just speed.
 *
 * The device and compiled pipeline are cached for the Worker's lifetime so
 * repeated modifier applications pay the GPU init cost only once.
 */

export interface KnitGPUParams {
  amplitude: number;
  stitchW: number;
  stitchH: number;
  rowOffset: number;
  yarnRadius: number;
  cosA: number;
  sinA: number;
  variation: number;
  seed: number;
}

// ---- Device / pipeline cache -------------------------------------------------

/** Single promise for device acquisition; null = WebGPU not available. */
let devicePromise: Promise<GPUDevice | null> | null = null;

function acquireDevice(): Promise<GPUDevice | null> {
  if (devicePromise) return devicePromise;
  devicePromise = (async () => {
    if (!navigator.gpu) return null;
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice({ label: 'partwright-surface' });
    // Reset cache on device loss so the next call re-acquires.
    device.lost.then(() => { devicePromise = null; });
    return device;
  })().catch(() => null);
  return devicePromise;
}

const pipelineCache = new WeakMap<GPUDevice, Promise<GPUComputePipeline>>();

function getPipeline(device: GPUDevice): Promise<GPUComputePipeline> {
  if (!pipelineCache.has(device)) {
    pipelineCache.set(device, device.createComputePipelineAsync({
      label: 'knit-displace',
      layout: 'auto',
      compute: {
        module: device.createShaderModule({ label: 'knit-displace', code: KNIT_WGSL }),
        entryPoint: 'main',
      },
    }));
  }
  return pipelineCache.get(device)!;
}

// ---- Buffer helpers ----------------------------------------------------------

function makeStorageBuf(device: GPUDevice, data: Float32Array, extraUsage = 0): GPUBuffer {
  const buf = device.createBuffer({
    size: Math.max(data.byteLength, 4),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | extraUsage,
  });
  device.queue.writeBuffer(buf, 0, data);
  return buf;
}

/**
 * Uniform buffer for shader params — 48 bytes, layout must match the WGSL
 * `Params` struct exactly (4-byte fields, no implicit padding gaps).
 *
 *  offset  0  numVert    u32
 *  offset  4  amplitude  f32
 *  offset  8  stitchW    f32
 *  offset 12  stitchH    f32
 *  offset 16  rowOffset  f32
 *  offset 20  yarnRadius f32
 *  offset 24  cosA       f32
 *  offset 28  sinA       f32
 *  offset 32  variation  f32
 *  offset 36  seed       u32
 *  offset 40  layerBias  f32   (= amplitude × 0.2)
 *  offset 44  _pad       f32
 */
function makeParamsBuf(device: GPUDevice, numVert: number, p: KnitGPUParams): GPUBuffer {
  const ab  = new ArrayBuffer(48);
  const u32 = new Uint32Array(ab);
  const f32 = new Float32Array(ab);
  u32[0]  = numVert;
  f32[1]  = p.amplitude;
  f32[2]  = p.stitchW;
  f32[3]  = p.stitchH;
  f32[4]  = p.rowOffset;
  f32[5]  = p.yarnRadius;
  f32[6]  = p.cosA;
  f32[7]  = p.sinA;
  f32[8]  = p.variation;
  u32[9]  = p.seed >>> 0;
  f32[10] = p.amplitude * 0.2;   // layerBias
  // f32[11] = 0                  // _pad (zero-initialised by ArrayBuffer)
  const buf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(buf, 0, ab);
  return buf;
}

// ---- Public entry point ------------------------------------------------------

/**
 * Displace mesh positions using a WebGPU compute shader.
 * Returns the displaced positions array on success, or null to signal fallback.
 */
export async function knitDisplaceGPU(
  positions: Float32Array,
  normals:   Float32Array,
  uvs:       Float32Array,
  numVert:   number,
  params:    KnitGPUParams,
): Promise<Float32Array | null> {
  let device: GPUDevice | null;
  try { device = await acquireDevice(); } catch { return null; }
  if (!device) return null;

  try {
    const pipeline = await getPipeline(device);

    const posBuf  = makeStorageBuf(device, positions);
    const normBuf = makeStorageBuf(device, normals);
    const uvBuf   = makeStorageBuf(device, uvs);
    const outBuf  = device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    const pBuf    = makeParamsBuf(device, numVert, params);
    const readBuf = device.createBuffer({
      size: positions.byteLength,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const bg = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: posBuf  } },
        { binding: 1, resource: { buffer: normBuf } },
        { binding: 2, resource: { buffer: uvBuf   } },
        { binding: 3, resource: { buffer: outBuf  } },
        { binding: 4, resource: { buffer: pBuf    } },
      ],
    });

    const enc  = device.createCommandEncoder({ label: 'knit-displace' });
    const pass = enc.beginComputePass({ label: 'knit-displace' });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bg);
    pass.dispatchWorkgroups(Math.ceil(numVert / 64));
    pass.end();
    enc.copyBufferToBuffer(outBuf, 0, readBuf, 0, positions.byteLength);
    device.queue.submit([enc.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(readBuf.getMappedRange().slice(0));
    readBuf.unmap();

    posBuf.destroy(); normBuf.destroy(); uvBuf.destroy();
    outBuf.destroy(); pBuf.destroy(); readBuf.destroy();

    return result;
  } catch (err) {
    console.warn('[knitGPU] compute failed, falling back to JS:', err);
    devicePromise = null;   // force re-init next call
    return null;
  }
}

// ---- WGSL compute shader -----------------------------------------------------

const KNIT_WGSL = /* wgsl */`
struct Params {
  numVert   : u32,
  amplitude : f32,
  stitchW   : f32,
  stitchH   : f32,
  rowOffset : f32,
  yarnRadius: f32,
  cosA      : f32,
  sinA      : f32,
  variation : f32,
  seed      : u32,
  layerBias : f32,
  _pad      : f32,
}

@group(0) @binding(0) var<storage, read>       inPos  : array<f32>;
@group(0) @binding(1) var<storage, read>       inNorm : array<f32>;
@group(0) @binding(2) var<storage, read>       inUV   : array<f32>;
@group(0) @binding(3) var<storage, read_write> outPos : array<f32>;
@group(0) @binding(4) var<uniform>             params : Params;

fn hash2(ix: i32, iz: i32, seed: u32) -> f32 {
  var h = u32(ix) * 374761393u + u32(iz) * 668265263u + seed * 1013904223u;
  h ^= h >> 13u;
  h  = h * 1274126177u;
  h ^= h >> 16u;
  return f32(h) / 4294967296.0;
}

fn distToSeg(px: f32, py: f32, ax: f32, ay: f32, bx: f32, by: f32) -> f32 {
  let dx = bx - ax;
  let dy = by - ay;
  let len2 = dx*dx + dy*dy;
  if len2 < 0.000000000001 {
    return length(vec2f(px - ax, py - ay));
  }
  let t = clamp(((px-ax)*dx + (py-ay)*dy) / len2, 0.0, 1.0);
  return length(vec2f(px - ax - t*dx, py - ay - t*dy));
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let v = gid.x;
  if v >= params.numVert { return; }

  let px = inPos[v*3u];       let py = inPos[v*3u+1u];  let pz = inPos[v*3u+2u];
  let nx = inNorm[v*3u];      let ny = inNorm[v*3u+1u]; let nz = inNorm[v*3u+2u];
  let rawU = inUV[v*2u];      let rawV = inUV[v*2u+1u];

  let gu = params.cosA * rawU + params.sinA * rawV;
  let gv = -params.sinA * rawU + params.cosA * rawV;

  let rowInt = i32(floor(gv / params.stitchH));
  var d = 0.0;

  for (var dr = -1; dr <= 1; dr++) {
    let ri    = rowInt + dr;
    let even  = ((ri % 2 + 2) % 2) == 0;
    let shift = select(params.rowOffset, 0.0, even);

    let vTip   = f32(ri)     * params.stitchH;
    let vExit  = f32(ri + 1) * params.stitchH;
    let colInt = i32(floor(gu / params.stitchW - shift));

    for (var dc = -1; dc <= 1; dc++) {
      let ci   = colInt + dc;
      let uTip = (f32(ci) + 0.5 + shift) * params.stitchW;
      let uL   = (f32(ci)       + shift) * params.stitchW;
      let uR   = (f32(ci) + 1.0 + shift) * params.stitchW;

      let sv   = 1.0 + params.variation * (hash2(ci, ri, params.seed) * 2.0 - 1.0);
      let dist = min(distToSeg(gu, gv, uTip, vTip, uL, vExit),
                     distToSeg(gu, gv, uTip, vTip, uR, vExit));
      let r    = dist / params.yarnRadius;

      if r < 1.0 {
        let lb      = select(-params.layerBias, 0.0, even);
        let contrib = params.amplitude * sv * sqrt(1.0 - r*r) + lb;
        if contrib > d { d = contrib; }
      }
    }
  }

  outPos[v*3u]      = px + nx*d;
  outPos[v*3u + 1u] = py + ny*d;
  outPos[v*3u + 2u] = pz + nz*d;
}
`;
