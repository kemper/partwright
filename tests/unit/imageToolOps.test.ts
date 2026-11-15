import { describe, it, expect, beforeEach } from 'vitest';
import {
  imageToolCode, imageToolOpFromCode, parseObjectLiteral, compactReliefParams, reliefOptionsForOp, reliefDefaultsForTool,
  RELIEF_OP_FUNCTIONS, type ImageToolOp,
} from '../../src/imageTools/descriptor';
import { parseReliefOpParams, parseVoxelOpParams, steppedReliefFitError } from '../../src/imageTools/params';
import { runReliefImageOp, runVoxelImageOp } from '../../src/imageTools/sandboxOps';
import { setActiveModelImages, hashImagePixels, modelImageHandle } from '../../src/geometry/modelImages';

// Image tools as code ops (#1256 Stage B): codegen ↔ parse round trip, strict
// option validation, and the Worker-side runners on a synthetic image.

/** 40×30 synthetic image: cream background, a red block, a blue block. */
function synthImage(id: string) {
  const w = 40, h = 30;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    let c = [244, 241, 234];
    if (x >= 5 && x < 18 && y >= 6 && y < 22) c = [210, 69, 43];
    if (x >= 24 && x < 36 && y >= 4 && y < 26) c = [47, 111, 208];
    data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
  }
  return { id, width: w, height: h, data, hash: hashImagePixels(w, h, data) };
}

describe('imageToolCode / imageToolOpFromCode', () => {
  it('writes a relief record as an api call and reads back an equivalent record', () => {
    const params = reliefOptionsForOp('tile', { common: { widthMm: 42, resolution: 80 }, quantized: { clusters: 6, shape: 'rounded' } }) as unknown as Record<string, unknown>;
    const op: ImageToolOp = { tool: 'tile', image: 'att1', params };
    const { code, language } = imageToolCode(op);
    expect(language).toBe('manifold-js');
    expect(code).toContain("const img = api.image('att1');");
    expect(code).toContain('return api.imageTile(img, {');
    expect(code).not.toContain('"mode"');
    expect(code).not.toContain('"output"');
    const back = imageToolOpFromCode(code)!;
    expect(back.tool).toBe('tile');
    expect(back.image).toBe('att1');
    expect(back.params).toEqual({ common: { widthMm: 42, resolution: 80 }, quantized: { clusters: 6, shape: 'rounded' } });
    expect(reliefOptionsForOp('tile', back.params)).toEqual(reliefOptionsForOp('tile', params));
  });

  it('round-trips every relief tool', () => {
    for (const tool of Object.keys(RELIEF_OP_FUNCTIONS) as Array<keyof typeof RELIEF_OP_FUNCTIONS>) {
      const params = { common: { maxHeight: 4 }, preprocess: { contrast: 0.2 } };
      const { code } = imageToolCode({ tool, image: 'x9', params });
      expect(code).toContain(`api.${RELIEF_OP_FUNCTIONS[tool]}(img`);
      const back = imageToolOpFromCode(code)!;
      expect(back.tool).toBe(tool);
      expect(reliefOptionsForOp(tool, back.params)).toEqual(reliefOptionsForOp(tool, params));
    }
  });

  it('omits the options object when everything is default', () => {
    const { code } = imageToolCode({ tool: 'lithophane', image: 'a', params: reliefDefaultsForTool('lithophane') as unknown as Record<string, unknown> });
    expect(code).toContain('return api.lithophane(img);');
    expect(imageToolOpFromCode(code)).toEqual({ tool: 'lithophane', image: 'a', params: {} });
  });

  it('compacts away sections the tool ignores', () => {
    const p = compactReliefParams('lithophane', { quantized: { clusters: 9 }, luminance: { invert: true } });
    expect(p).toEqual({ luminance: { invert: true } });
    const q = compactReliefParams('tile', { luminance: { invert: true }, crop: { left: 0, top: 0, right: 1, bottom: 1 } });
    expect(q).toEqual({});
  });

  it('writes the voxel tool for a voxel session, dropping codeStyle', () => {
    const { code, language } = imageToolCode({ tool: 'voxel', image: 'v1', params: { maxSize: 24, mode: 'heightmap', codeStyle: 'calls' } });
    expect(language).toBe('voxel');
    expect(code).toContain('return api.voxelsFromImage(img, {');
    expect(code).not.toContain('codeStyle');
    expect(imageToolOpFromCode(code)).toEqual({ tool: 'voxel', image: 'v1', params: { maxSize: 24, mode: 'heightmap' } });
  });

  it('recognises inline images, hand-written literals, and unparseable options', () => {
    expect(imageToolOpFromCode("return api.lithophane(api.image('p'), { common: { widthMm: 80, }, // wide\n luminance: { invert: true } });"))
      .toEqual({ tool: 'lithophane', image: 'p', params: { common: { widthMm: 80 }, luminance: { invert: true } } });
    expect(imageToolOpFromCode("let pic = api.image(\"q\");\nconst t = api.silhouetteTile(pic, { quantized: { shape: 'circle' } });\nreturn t;"))
      .toEqual({ tool: 'silhouette', image: 'q', params: { quantized: { shape: 'circle' } } });
    // Options built from expressions can't be read back — the record keeps the image and tool.
    expect(imageToolOpFromCode("const w = 50; return api.steppedRelief(api.image('r'), { common: { widthMm: w } });"))
      .toEqual({ tool: 'steppedRelief', image: 'r', params: {} });
    // A variable that isn't an api.image(...) isn't a record.
    expect(imageToolOpFromCode('return api.imageTile(something, {});')).toBeNull();
    // Layered print keeps its own-code record shape.
    expect(imageToolOpFromCode("return api.layeredPrint(api.image('z'), { widthMm: 90 });")).toEqual({ tool: 'layeredPrint', image: 'z', params: {} });
  });

  it('refuses ids that would break out of the string', () => {
    expect(() => imageToolCode({ tool: 'tile', image: "a'); evil('", params: {} })).toThrow(/attachment id/);
  });
});

describe('parseObjectLiteral', () => {
  it('accepts JS object-literal syntax with literal values', () => {
    expect(parseObjectLiteral("{ a: 1, 'b': 'x\"y', c: [1, -2.5e-1, true, null], d: { e: false, }, /* c */ }"))
      .toEqual({ a: 1, b: 'x"y', c: [1, -0.25, true, null], d: { e: false } });
  });
  it('rejects anything non-literal', () => {
    expect(parseObjectLiteral('{ a: b }')).toBeUndefined();
    expect(parseObjectLiteral('{ a: f(1) }')).toBeUndefined();
    expect(parseObjectLiteral('{ a: `t` }')).toBeUndefined();
  });
});

describe('image op params', () => {
  it('merges relief params over the tool defaults', () => {
    const o = parseReliefOpParams('silhouette', { quantized: { clusters: 3 } });
    expect(o.mode).toBe('quantized');
    expect(o.quantized.output).toBe('silhouette');
    expect(o.quantized.clusters).toBe(3);
    expect(o.common.widthMm).toBe(100);
    expect(parseReliefOpParams('lithophane', undefined).mode).toBe('luminance');
  });

  it('accepts a full stored record (the header form)', () => {
    const full = reliefOptionsForOp('steppedRelief', { common: { maxHeight: 3 } });
    expect(() => parseReliefOpParams('steppedRelief', JSON.parse(JSON.stringify(full)))).not.toThrow();
    const lith = reliefOptionsForOp('lithophane', {});
    expect(() => parseReliefOpParams('lithophane', JSON.parse(JSON.stringify(lith)))).not.toThrow();
  });

  it('throws on unknown keys, bad types and out-of-range values', () => {
    expect(() => parseReliefOpParams('tile', { colours: 4 })).toThrow(/api\.imageTile: unknown option "colours"/);
    expect(() => parseReliefOpParams('tile', { quantized: { clusterz: 4 } })).toThrow(/unknown option "quantized\.clusterz"/);
    expect(() => parseReliefOpParams('tile', { quantized: { clusters: 40 } })).toThrow(/clusters must be an integer in 2\.\.12/);
    expect(() => parseReliefOpParams('tile', { common: { widthMm: '50' } })).toThrow(/widthMm must be a number/);
    expect(() => parseReliefOpParams('tile', { quantized: { shape: 'star' } })).toThrow(/shape must be one of/);
    expect(() => parseReliefOpParams('tile', { quantized: { holes: [{ cxMm: 0, cyMm: 0 }] } })).toThrow(/diameterMm is required/);
    expect(() => parseReliefOpParams('tile', { crop: { left: 0.5, top: 0, right: 0.4, bottom: 1 } })).toThrow(/left < right/);
    expect(() => parseReliefOpParams('tile', [1])).toThrow(/options must be an object/);
  });

  it('refuses a mode or output that contradicts the function', () => {
    expect(() => parseReliefOpParams('tile', { mode: 'luminance' })).toThrow(/api\.lithophane/);
    expect(() => parseReliefOpParams('lithophane', { mode: 'quantized' })).toThrow(/api\.imageTile/);
    expect(() => parseReliefOpParams('tile', { quantized: { output: 'relief' } })).toThrow(/api\.steppedRelief/);
    expect(() => parseReliefOpParams('tile', { quantized: { output: 'flat' } })).not.toThrow();
  });

  it('applies the single-nozzle layer-fit rule to stepped reliefs', () => {
    expect(() => parseReliefOpParams('steppedRelief', { common: { maxHeight: 0.2, layerHeight: 0.08 }, quantized: { clusters: 6 } })).toThrow(/maxHeight ≥ 0\.40/);
    expect(() => parseReliefOpParams('steppedRelief', { common: { maxHeight: 0.2 }, quantized: { clusters: 6, paintingMode: 'multi-color' } })).not.toThrow();
    expect(steppedReliefFitError(reliefDefaultsForTool('tile'))).toBeNull();
  });

  it('validates voxel options', () => {
    expect(parseVoxelOpParams({ maxSize: 32, mode: 'heightmap', palette: null })).toEqual({ maxSize: 32, mode: 'heightmap', palette: null });
    expect(() => parseVoxelOpParams({ maxsize: 32 })).toThrow(/api\.voxelsFromImage: unknown option "maxsize"/);
    expect(() => parseVoxelOpParams({ maxSize: 999 })).toThrow(/maxSize must be an integer in 1\.\.256/);
    expect(() => parseVoxelOpParams({ flatColor: '#fff' })).toThrow(/flatColor must be \[r, g, b\]/);
  });
});

describe('image op runners', () => {
  beforeEach(() => setActiveModelImages([synthImage('s1')]));

  it('builds a tile whose colour clusters are contiguous labelled runs, largest first', () => {
    const img = modelImageHandle('s1');
    const run = runReliefImageOp('tile', img, { common: { widthMm: 40, resolution: 40 }, quantized: { clusters: 3 } });
    expect(run.watertight).toBe(true);
    const named = run.runs.filter((r) => r.name);
    expect(named.map((r) => r.name)).toEqual(['colour-1', 'colour-2', 'colour-3']);
    const sizes = named.map((r) => r.endTri - r.startTri);
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes);
    // Runs tile the triangle range without gaps.
    expect(run.runs[0].startTri).toBe(0);
    for (let i = 1; i < run.runs.length; i++) expect(run.runs[i].startTri).toBe(run.runs[i - 1].endTri);
    expect(run.runs[run.runs.length - 1].endTri).toBe(run.triVerts.length / 3);
    // The background (cream) is the largest region.
    const c1 = named[0].color!;
    expect(c1[0]).toBeGreaterThan(0.9);
    // Memoized on image + options.
    expect(runReliefImageOp('tile', img, { common: { widthMm: 40, resolution: 40 }, quantized: { clusters: 3 } })).toBe(run);
  });

  it('gives a lithophane no colour parts', () => {
    const run = runReliefImageOp('lithophane', modelImageHandle('s1'), { common: { resolution: 30 } });
    expect(run.runs).toHaveLength(1);
    expect(run.runs[0].name).toBeNull();
  });

  it('rejects a non-image argument and unknown ids', () => {
    expect(() => runReliefImageOp('tile', 's1', {})).toThrow(/first argument must be an image/);
    expect(() => modelImageHandle('nope')).toThrow(/headless preview/);
  });

  it('makes a fresh voxel grid per call', () => {
    const img = modelImageHandle('s1');
    const a = runVoxelImageOp(img, { maxSize: 20 });
    const b = runVoxelImageOp(img, { maxSize: 20 });
    expect(a).not.toBe(b);
    expect(a.size).toBeGreaterThan(0);
    expect(b.size).toBe(a.size);
    a.set(100, 0, 0, 0xff0000);
    expect(b.size).toBe(a.size - 1);
  });
});

describe('image tool call parsing (literal edge cases)', () => {
  it('drops a trailing comma followed by comments, and stays fast on comment-heavy input', async () => {
    const { imageToolOpFromCode } = await import('../../src/imageTools/descriptor');
    const code = "return api.imageTile(api.image('a1'), { quantized: { clusters: 5, /* c */ }, // tail\n });";
    expect(imageToolOpFromCode(code)?.params).toEqual({ quantized: { clusters: 5 } });
    const heavy = "return api.imageTile(api.image('a1'), { x: 1, " + '/**/'.repeat(5000) + ' });';
    const t0 = Date.now();
    imageToolOpFromCode(heavy);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
