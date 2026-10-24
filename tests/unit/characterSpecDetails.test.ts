// CharacterSpec #1059 detail fields: the additive v2 fields (head sink,
// per-hand cup + handScale, bead eyes, brow weight, shag/captured knobs, collar
// + cuff trim, prints, socks, toy shoes, knee-length shorts). Older v1 AND v2
// specs must regenerate byte-identical code below the header; every new field
// is emitted only off its default; validation reports paths; the new enums stay
// in sync with the figure library; and a full-feature spec's generated code
// runs through the real figure namespace (no meshing) without a single option
// the library rejects.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { specToCode } from '../../src/figure/characterCodegen';
import {
  DEFAULT_SPEC, EYE_STYLES, HAIR_PRESETS, SHOE_STYLES, PRINT_FONTS, PANTS_LENGTHS,
  applyStyle, cloneSpec, decodeSpecComment, normalizeSpec, specJsonSchema, validateSpec,
  type CharacterSpec,
} from '../../src/figure/characterSpec';
import { createSdfNamespace, type SdfNamespace } from '../../src/geometry/sdf';
import { __figureTestables__ } from '../../src/geometry/sdfFigure';
import { preloadTextFonts } from '../../src/geometry/textGlyphs';
import v1Fixture from './fixtures/characterV1Code.json';
import v2Fixture from './fixtures/characterV2Code.json';

const body = (code: string) => code.split('\n').slice(1).join('\n');
const spec = (patch: (s: CharacterSpec) => void): CharacterSpec => { const s = cloneSpec(DEFAULT_SPEC); patch(s); return s; };

describe('older specs regenerate byte-identical code (below the header)', () => {
  it('every captured v1 spec', () => {
    for (const c of v1Fixture as Array<{ name: string; spec: unknown; code: string }>) {
      expect(body(specToCode(decodeSpecComment(c.code)!)), c.name).toBe(body(c.code));
      expect(body(specToCode(normalizeSpec(c.spec, 1))), c.name).toBe(body(c.code));
    }
  });

  it('every captured pre-#1059 v2 spec (header path + spec-object path)', () => {
    expect(v2Fixture.length).toBeGreaterThan(10);
    for (const c of v2Fixture as Array<{ name: string; spec: unknown; code: string }>) {
      const fromHeader = decodeSpecComment(c.code);
      expect(fromHeader, c.name).not.toBeNull();
      expect(body(specToCode(fromHeader!)), c.name).toBe(body(c.code));
      expect(body(specToCode(normalizeSpec(c.spec))), c.name).toBe(body(c.code));
      expect(validateSpec(fromHeader), c.name).toEqual([]);
    }
  });

  it('an old v2 header migrates with the reproducing defaults', () => {
    const m = decodeSpecComment((v2Fixture[0] as { code: string }).code)!;
    expect(m.body.headSink).toBe(0);
    expect(m.pose.hold).toMatchObject({ cupL: null, cupR: null, handScale: 1 });
    expect(m.face).toMatchObject({ eyeStyle: 'iris', browThickness: 1, browWidth: 1 });
    expect(m.clothing.top).toMatchObject({ trim: { collar: false, cuffs: false }, print: [] });
    expect(m.clothing.socks.on).toBe(false);
    expect(m.clothing.feet).toMatchObject({ style: 'fitted', size: 1, cleats: 0 });
    expect(m.colors.sole).toBeNull();
  });
});

describe('#1059 codegen', () => {
  it('rig: headSink, per-hand cups and handScale only when set', () => {
    const plain = body(specToCode(DEFAULT_SPEC));
    expect(plain).not.toContain('headSink');
    const code = specToCode(spec(s => {
      s.body.headSink = 0.42;
      s.pose.hold = { ...s.pose.hold, kind: 'ball', radius: 10.5, cupR: 'under', handScale: 1.3 };
    }));
    expect(code).toContain('  headSink: 0.42,');
    expect(code).toContain("hold: { sphere: { radius: 10.5 }, cup: 'sides', cupR: 'under', handScale: 1.3 },");
  });

  it('bead eyes: on the real face, sized by eyeSize, glint painted; no iris/pupil/lids', () => {
    const code = specToCode(spec(s => { s.face.eyeStyle = 'bead'; s.face.eyeSize = 1.8; s.colors.eyeHighlight = '#fefefe'; }));
    expect(code).toContain("F.face.eyes(rig, { style: 'bead', on: face, radius: rig.r.head * 0.288 })");
    expect(code).toContain("api.paint.label('eyeHighlight', '#fefefe');");
    for (const l of ['iris', 'pupil', 'lids']) expect(code).not.toContain(`api.paint.label('${l}'`);
    const flat = specToCode(spec(s => { s.face.eyeStyle = 'bead'; s.face.highlight = 0; s.face.eyeAspect = 1.2; }));
    expect(flat).toContain('aspect: 1.2, highlight: false });');
    expect(flat).not.toContain("'eyeHighlight'");
  });

  it('bold brows: thickness / width only off-default, with on: face kept for stylized heads', () => {
    expect(specToCode(spec(s => { s.face.browThickness = 3; s.face.browWidth = 1.5; s.body.proportions = 'funko'; })))
      .toContain("F.face.brows(rig, { shape: 'natural', thickness: 3, width: 1.5, on: face })");
  });

  it('shag + captured knobs', () => {
    const shag = specToCode(spec(s => { s.hair = { ...s.hair, style: 'shag', notched: false, crownSize: 1.4, backWidth: 0.5, tipWidth: 0.6, spikiness: 2 }; }));
    expect(shag).toContain("F.hair(rig, { style: 'shag', length: 'mid', notched: false, crownSize: 1.4, backWidth: 0.5, tipWidth: 0.6, on: head })");
    const cap = specToCode(spec(s => { s.hair = { ...s.hair, style: 'captured', spikiness: 1.8, smooth: 0.3, mirror: true, tilt: 5, windowScale: 1.1, capturedFringe: 0.6, crownSize: 2 }; }));
    expect(cap).toContain("F.hair(rig, { style: 'captured', length: 'mid', spikiness: 1.8, smooth: 0.3, mirror: true, tilt: 5, windowScale: 1.1, fringe: 0.6, on: head })");
    expect(specToCode(spec(s => { s.hair.style = 'captured'; }))).toContain("F.hair(rig, { style: 'captured', length: 'mid', on: head })");
    // The lock styles' `fringe` (kept across a style switch) never reaches captured —
    // it was ignored there before captured had its own knob (back-compat).
    expect(specToCode(spec(s => { s.hair = { ...s.hair, style: 'captured', fringe: 0.5 }; }))).toContain("F.hair(rig, { style: 'captured', length: 'mid', on: head })");
  });

  it('collar + cuff trim splits the parted top into top + trim', () => {
    const code = specToCode(spec(s => { s.clothing.top.trim = { collar: true, cuffs: true }; s.colors.trim = '#123456'; }));
    expect(code).toContain("const topG = F.garment.top(rig, { sleeve: 'short' });");
    expect(code).toContain("F.trim(topG.all, sdf.union(F.trimZone(rig, { ring: 'neck'");
    expect(code).toContain("topG.sleeves.intersect(F.trimZone(rig, { bone: 'upperArm'");
    expect(code).toContain("const top = topTrim.rest.label('top'), trim = topTrim.band.label('trim');");
    expect(code).toContain("api.paint.label('trim', '#123456');");
    // Long sleeves cuff at the wrist; no sleeves = collar only (cuffs ignored).
    expect(specToCode(spec(s => { s.clothing.top.sleeve = 'long'; s.clothing.top.trim.cuffs = true; }))).toContain("bone: 'lowerArm'");
    const sleeveless = specToCode(spec(s => { s.clothing.top.sleeve = 'none'; s.clothing.top.trim.cuffs = true; }));
    expect(sleeveless).not.toContain('topG');
    expect(sleeveless).not.toContain("'trim'");
  });

  it('prints emboss onto the top, front or back, each with its own colour', () => {
    const code = specToCode(spec(s => {
      s.clothing.top.print = [
        { text: 'N', where: 'chest', size: 0.55, x: 0.55, z: 0.24, color: '#1f5fc8', font: 'bold' },
        { text: "1'0", where: 'back', size: 0.95, x: 0, z: 0, color: '#111111', font: 'italic' },
      ];
    }));
    expect(code).toContain("const print1 = F.emboss('N', topG.all, { at: [rig.joints.chest[0] + rig.r.chestX * 0.55, rig.joints.chest[1] - rig.r.chestY * 1.6, rig.joints.chest[2] + rig.r.chestX * 0.24], size: rig.r.chestX * 0.55, label: 'print1' });");
    expect(code).toContain("F.emboss('1\\'0', topG.all, { at: [rig.joints.chest[0] + rig.r.chestX * 0, rig.joints.chest[1] + rig.r.chestY * 1.6,");
    expect(code).toContain("font: 'italic', label: 'print2' });");
    expect(code).toContain("api.paint.label('print1', '#1f5fc8');");
    expect(code).toContain("api.paint.label('print2', '#111111');");
    expect(code).toMatch(/sdf\.union\([^)]*\bprint1, print2\b/);
    // No top, no print.
    expect(specToCode(spec(s => { s.clothing.top.on = false; s.clothing.top.print = [{ ...s.clothing.top.print[0] ?? { text: 'A', where: 'chest', size: 1, x: 0, z: 0, color: '#000000', font: 'bold' } }]; }))).not.toContain('emboss');
  });

  it('partial print items fill from the defaults', () => {
    const s = normalizeSpec({ clothing: { top: { print: [{ text: '10', where: 'back' }] } } });
    expect(s.clothing.top.print[0]).toMatchObject({ text: '10', where: 'back', size: 0.6, x: 0, color: '#1a1a1a', font: 'bold' });
    expect(validateSpec(s)).toEqual([]);
  });

  it('socks: plain, one band, hoops', () => {
    const band = specToCode(spec(s => { s.clothing.socks.on = true; }));
    expect(band).toContain("F.legs(rig).round(rig.r.lowerLeg * 0.28).intersect(F.trimZone(rig, { bone: 'lowerLeg', from: -0.1, to: 1.1,");
    expect(band).toContain("F.trim(shins, F.trimZone(rig, { bone: 'lowerLeg', from: -0.1, to: 0.24, radius: rig.r.lowerLeg * 2.8 }))");
    expect(band).toContain("api.paint.label('socks', '#f4f4f4');");
    expect(band).toContain("api.paint.label('sockStripe', '#1f5fc8');");
    const hoops = specToCode(spec(s => { s.clothing.socks = { on: true, height: 0.8, stripes: 3, stripeSpan: 0.8 }; }));
    expect(hoops).toContain('to: 1, radius: rig.r.lowerLeg * 2.8, stripes: 3 }');
    const plain = body(specToCode(spec(s => { s.clothing.socks = { ...s.clothing.socks, on: true, stripes: 0 }; })));
    expect(plain).toContain("const socks = shins.label('socks');");
    expect(plain).not.toContain('sockStripe');
  });

  it('toy shoes (height, cleats, size) and a sole colour', () => {
    const code = specToCode(spec(s => { s.clothing.feet = { ...s.clothing.feet, style: 'toy', size: 1.3, height: 1.2, cleats: 6 }; s.colors.sole = '#222222'; }));
    expect(code).toContain("F.clothing.shoes(rig, { label: 'feet', style: 'toy', size: 1.3, height: 1.2, cleats: 6 })");
    expect(code).toContain("api.paint.label('sole', '#222222');");
    // style/height/cleats are shoes-only — boots keep just size.
    expect(specToCode(spec(s => { s.clothing.feet = { ...s.clothing.feet, kind: 'boots', style: 'toy', size: 1.2, cleats: 6 }; })))
      .toContain("F.clothing.boots(rig, { label: 'feet', size: 1.2 })");
    expect(specToCode(spec(s => { s.clothing.feet = { ...s.clothing.feet, style: 'toy', cleats: 1 }; }))).toContain('cleats: 2');
  });

  it('socks stop at the ankle when there is no footwear', () => {
    const bare = body(specToCode(spec(s => { s.clothing.socks.on = true; s.clothing.feet.on = false; })));
    expect(bare).toContain("bone: 'lowerLeg', from: -0.1, to: 1, radius: rig.r.lowerLeg * 2.6");
    expect(bare).not.toContain('to: 1.1');
  });

  it('knee-length shorts', () => {
    expect(specToCode(spec(s => { s.clothing.pants.length = 'shorts'; }))).toContain("F.clothing.pants(rig, { leg: 'slim', rise: 'mid', length: 'shorts' })");
    expect(specToCode(spec(s => { s.clothing.pants.length = 'shorts'; s.clothing.pants.hem = 0.7; }))).toContain("length: 'shorts', hem: 0.7 }");
    expect(specToCode(spec(s => { s.clothing.pants.hem = 0.7; }))).not.toContain('hem:');
  });

  it('mitten hands and head-shape knobs (jaw / chin / cheek) only off-default', () => {
    const plain = body(specToCode(DEFAULT_SPEC));
    expect(plain).toContain("F.head(rig, { faceShape: 'oval' })");
    expect(plain).not.toContain('fingers');
    const code = specToCode(spec(s => { s.body.mittens = true; s.face.jaw = 1.4; s.face.cheek = 1.1; }));
    expect(code).toContain("F.head(rig, { faceShape: 'oval', jaw: 1.4, cheek: 1.1 })");
    expect(code).toContain("F.hands(rig, { grip: 'relaxed', fingers: false })");
  });

  it("applyStyle('funko') gives bead eyes and a sunk head; leaving it undoes both", () => {
    const s = cloneSpec(DEFAULT_SPEC);
    applyStyle(s, 'funko');
    expect(s.face.eyeStyle).toBe('bead');
    expect(s.body.headSink).toBeGreaterThan(0);
    applyStyle(s, 'chibi');
    expect(s.face.eyeStyle).toBe('iris');
    expect(s.body.headSink).toBe(0);
  });
});

describe('#1059 validation + schema', () => {
  it('reports bad detail fields with paths', () => {
    const bad = normalizeSpec({
      body: { headSink: 3 },
      pose: { hold: { cupL: 'over', handScale: 9 } },
      face: { eyeStyle: 'solid', browThickness: 0 },
      hair: { crownSize: 9, preset: 'goku', mirror: 'yes' },
      clothing: {
        top: { trim: { collar: 1 }, print: [{ text: '', where: 'sleeve' }, 'N'] },
        pants: { length: 'capri' },
        socks: { stripes: 20 },
        feet: { style: 'clog' },
      },
      colors: { sole: 'red' },
    });
    const errs = validateSpec(bad).join('\n');
    for (const p of ['body.headSink', 'pose.hold.cupL', 'pose.hold.handScale', 'face.eyeStyle', 'face.browThickness',
      'hair.crownSize', 'hair.preset', 'hair.mirror', 'clothing.top.trim.collar', 'clothing.top.print[0].text',
      'clothing.top.print[0].where', 'clothing.top.print[1] must be an object', 'clothing.pants.length',
      'clothing.socks.stripes', 'clothing.feet.style', 'colors.sole']) expect(errs, p).toContain(p);
    expect(validateSpec(normalizeSpec({ pose: { hold: { cupL: null } }, colors: { sole: null } }))).toEqual([]);
  });

  it('print text must be printable and not blank (validation, not build time)', () => {
    const errs = (text: string) => validateSpec(normalizeSpec({ clothing: { top: { print: [{ text }] } } })).join('\n');
    for (const ok of ['N', '10', "O'Neil", 'A&B #7', 'éè', '★']) expect(errs(ok), ok).toBe('');
    for (const bad of ['   ', '', 'a\nb', 'a\u2028b', 'a\u2029b', 'tab\t', 'zw\u200bj']) expect(errs(bad), JSON.stringify(bad)).toContain('clothing.top.print[0].text');
    expect(validateSpec(normalizeSpec({ pose: { preset: 'x'.repeat(33) } })).join('')).toContain('pose.preset must have at most 32');
  });

  it('the JSON schema carries the print list and the new enums (Gemini-safe keywords only)', () => {
    const s = specJsonSchema() as { properties: { clothing: { properties: { top: { properties: { print: { type: string; maxItems: number; items: { properties: Record<string, { enum?: string[] }> } } } } } } } };
    const print = s.properties.clothing.properties.top.properties.print;
    expect(print.type).toBe('array');
    expect(print.maxItems).toBe(6);
    expect(print.items.properties.where.enum).toEqual(['chest', 'back']);
    const json = JSON.stringify(specJsonSchema());
    for (const k of ['additionalProperties', 'exclusiveMinimum', 'exclusiveMaximum', '$schema']) expect(json).not.toContain(k);
  });
});

// ---- header / body injection hardening ---------------------------------------

describe('generated code is injection-safe for hostile string fields', () => {
  const HOSTILE = [
    '\u2028globalThis.__pwned = 1; //',
    '\u2029globalThis.__pwned = 2; //',
    "'); globalThis.__pwned = 3; ('",
    '\\\'); globalThis.__pwned = 4; //',
    '*/ globalThis.__pwned = 5; /*',
    '\nglobalThis.__pwned = 6; //',
    '\r\nglobalThis.__pwned = 7; //',
    '"}\u2028globalThis.__pwned = 8; //',
  ];

  /** A do-nothing api: every property is a callable that returns the same proxy. */
  const stubApi = (): unknown => {
    const fn: unknown = new Proxy(function () { /* stub */ }, {
      get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : fn),
      apply: () => fn,
    });
    return fn;
  };

  it('neither the header nor the body lets a string field run as code, and the spec round-trips', () => {
    for (const h of HOSTILE) {
      // Straight to the codegen (bypassing validateSpec), as a hand-edited header could.
      const s = spec(x => {
        x.pose.preset = h;
        x.clothing.top.print = [{ text: h, where: 'chest', size: 0.6, x: 0, z: 0, color: '#111111', font: 'bold' }];
      });
      const code = specToCode(s);
      expect(code.split('\n')[0], JSON.stringify(h)).not.toMatch(/[\u2028\u2029]/);
      delete (globalThis as { __pwned?: unknown }).__pwned;
      expect(() => new Function('api', code)(stubApi()), JSON.stringify(h)).not.toThrow();
      expect((globalThis as { __pwned?: unknown }).__pwned, JSON.stringify(h)).toBeUndefined();
      expect(decodeSpecComment(code), JSON.stringify(h)).toEqual(normalizeSpec(s));
      // …and validation rejects the lettering outright.
      if (/[\u2028\u2029\n\r]/.test(h)) expect(validateSpec(s).join('\n')).toContain('clothing.top.print[0].text');
    }
  });
});

// ---- the new enums match the figure library --------------------------------

const stubManifold = new Proxy({}, { get: () => () => undefined }) as unknown as Parameters<typeof createSdfNamespace>[0];
const sdf: SdfNamespace = createSdfNamespace(stubManifold, (s) => s);
const F = sdf.figure;
const T = __figureTestables__;
const rig = T.buildRig({ height: 60 });

function libraryEnum(fn: () => unknown): string[] {
  try { fn(); } catch (err) {
    const m = /must be one of: (.*?)\. Got/.exec(String((err as Error).message));
    if (m) return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]);
    throw err;
  }
  throw new Error('expected the library to reject the bogus value');
}
const BOGUS = '__nope__';

describe('#1059 enums match the figure library', () => {
  const same = (a: readonly string[], lib: string[]) => expect([...a].sort()).toEqual([...lib].sort());
  it('shoe styles, captured presets, emboss fonts, pants lengths, eye styles', () => {
    same(SHOE_STYLES, libraryEnum(() => F.clothing.shoes(rig, { style: BOGUS })));
    same(HAIR_PRESETS, libraryEnum(() => T.buildHair(sdf as never, rig, { style: 'captured', preset: BOGUS })));
    same(PRINT_FONTS, libraryEnum(() => F.emboss('A', sdf.sphere(10), { at: [0, -10, 0], size: 4, font: BOGUS })));
    same(PANTS_LENGTHS, libraryEnum(() => F.clothing.pants(rig, { length: BOGUS })));
    const eyeStyles = libraryEnum(() => F.face.eyes(rig, { style: BOGUS }));
    for (const s of EYE_STYLES) expect(eyeStyles).toContain(s);
  });
});

describe("F.clothing.pants({ length: 'shorts' })", () => {
  const lerp = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
  const j = rig.joints as Record<string, number[]>;
  it('keeps the thigh above the hem and drops the leg below it, along the bone', () => {
    const full = F.clothing.pants(rig, {}) as { evaluate(x: number, y: number, z: number): number };
    const shorts = F.clothing.pants(rig, { length: 'shorts' }) as typeof full;
    const at = (n: typeof full, p: number[]) => n.evaluate(p[0], p[1], p[2]);
    const thigh = lerp(j.upperLegL, j.lowerLegL, 0.5), shin = lerp(j.lowerLegL, j.footL, 0.5);
    expect(at(full, thigh)).toBeLessThan(0);
    expect(at(shorts, thigh)).toBeLessThan(0);
    expect(at(full, shin)).toBeLessThan(0);
    expect(at(shorts, shin)).toBeGreaterThan(0);
    // A higher hem cuts more of the thigh.
    expect(at(F.clothing.pants(rig, { length: 'shorts', hem: 0.3 }) as typeof full, thigh)).toBeGreaterThan(0);
  });
  it('hem is shorts-only', () => {
    expect(() => F.clothing.pants(rig, { hem: 0.5 })).toThrow(/only applies to length 'shorts'/);
  });
});

// ---- generated code runs through the real figure namespace ------------------

/** Run generated figure code up to (not including) the mesh build: every
 *  F.* call validates its options exactly as in the browser. */
function constructModel(code: string): { evaluate(x: number, y: number, z: number): number } {
  const src = code.replace(/\n\s*\.build\([\s\S]*$/, ';\nreturn model;\n');
  const paints: unknown[] = [];
  const api = { sdf, paint: { label: (...a: unknown[]) => paints.push(a), pattern: (...a: unknown[]) => paints.push(a) } };
  return new Function('api', src)(api);
}

describe('#1059 full-feature spec constructs in the figure library', () => {
  // F.emboss lays text out in Liberation Sans — load it from disk (the engine
  // preloads it in the browser when the code mentions `emboss(`).
  beforeAll(async () => {
    vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(`public/openscad-libs/fonts/${String(url).split('/').pop()}`)));
    try { await preloadTextFonts(); } finally { vi.unstubAllGlobals(); }
  });

  it('Tsubasa-like spec: shorts, socks, toy cleats, trim, prints, bead eyes, shag + sink + mitten hold', () => {
    const s = normalizeSpec({
      body: { height: 100, proportions: 'funko', headsTall: 3, build: 'slim', sex: 'male', headScale: { x: 2.3, y: 1.8, z: 2.1 }, headSink: 0.42 },
      pose: { legL: { raiseSide: 8, twist: 26 }, legR: { raiseSide: 8, twist: 26 }, hold: { kind: 'ball', radius: 10.5, cupR: 'under', handScale: 1.3 } },
      face: { eyeStyle: 'bead', eyeSize: 1.65, lids: 'none', mouth: false, brows: 'arched', browThickness: 3, browWidth: 1.5 },
      hair: { style: 'shag', seed: 11, spike: 0.55, flare: 0.8, backWidth: 0.5 },
      clothing: {
        top: { trim: { collar: true, cuffs: true }, print: [{ text: 'N', x: 0.55, z: 0.24, size: 0.55 }, { text: '10', where: 'back', size: 0.95 }] },
        pants: { length: 'shorts', hem: 0.94 },
        socks: { on: true },
        feet: { style: 'toy', size: 1.3, cleats: 6 },
      },
    });
    expect(validateSpec(s)).toEqual([]);
    const model = constructModel(specToCode(s));
    expect(typeof model.evaluate).toBe('function');
    // Captured hair + long-sleeve cuffs + plain socks construct too.
    const s2 = cloneSpec(s);
    s2.hair.style = 'captured'; s2.hair.volume = 1.2;
    s2.clothing.top.sleeve = 'long';
    s2.clothing.socks.stripes = 0;
    expect(typeof constructModel(specToCode(s2)).evaluate).toBe('function');
  });
});
