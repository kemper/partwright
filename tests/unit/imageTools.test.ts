import { describe, it, expect } from 'vitest';
import {
  IMAGE_TOOLS, formatImageToolHeader, parseImageToolHeader, withImageToolHeader, imageToolOpFromCode,
  reliefDefaultsForTool, reliefOptionsForOp, toolForReliefOptions, isImageToolId,
} from '../../src/imageTools/descriptor';

describe('image tool records', () => {
  it('round-trips a record through the code header', () => {
    const op = { tool: 'tile' as const, image: 'att1', params: { quantized: { clusters: 6 } } };
    const code = formatImageToolHeader(op) + 'return api.Manifold.cube([1, 1, 1]);\n';
    expect(parseImageToolHeader(code)).toEqual(op);
    expect(imageToolOpFromCode(code)).toEqual(op);
  });

  it('replaces an existing header instead of stacking', () => {
    const first = withImageToolHeader('return 1;\n', { tool: 'tile', image: 'a', params: {} });
    const second = withImageToolHeader(first, { tool: 'silhouette', image: 'a', params: { x: 1 } });
    expect(second.match(/@image-tool/g)).toHaveLength(1);
    expect(parseImageToolHeader(second)?.tool).toBe('silhouette');
    expect(second.endsWith('return 1;\n')).toBe(true);
  });

  it('ignores malformed or foreign headers', () => {
    expect(parseImageToolHeader('// @image-tool {not json}\nreturn 1;')).toBeNull();
    expect(parseImageToolHeader('// @image-tool {"tool":"nope","image":"a"}\n')).toBeNull();
    expect(parseImageToolHeader('return 1;')).toBeNull();
  });

  it('recognises a layered print from its api.layeredPrint call', () => {
    const code = "const print = api.layeredPrint(api.image('img9'), { widthMm: 100 });\nreturn print;";
    expect(imageToolOpFromCode(code)).toEqual({ tool: 'layeredPrint', image: 'img9', params: {} });
  });

  it('maps relief tools to and from ReliefOptions', () => {
    for (const t of ['tile', 'silhouette', 'steppedRelief', 'lithophane'] as const) {
      expect(toolForReliefOptions(reliefDefaultsForTool(t))).toBe(t);
    }
    const o = reliefOptionsForOp('tile', { quantized: { clusters: 9 }, common: { widthMm: 42 } });
    expect(o.quantized.clusters).toBe(9);
    expect(o.quantized.output).toBe('flat');      // defaults kept for unset fields
    expect(o.common.widthMm).toBe(42);
    expect(o.common.layerHeight).toBe(0.08);
    expect(() => reliefDefaultsForTool('voxel')).toThrow();
  });

  it('lists six tools with valid ids', () => {
    expect(IMAGE_TOOLS.map((t) => t.id)).toEqual(['tile', 'silhouette', 'steppedRelief', 'lithophane', 'layeredPrint', 'voxel']);
    expect(IMAGE_TOOLS.every((t) => isImageToolId(t.id))).toBe(true);
    expect(isImageToolId('lithophanes')).toBe(false);
  });
});
