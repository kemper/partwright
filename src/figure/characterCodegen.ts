// Turn a CharacterSpec into self-contained `api.sdf.figure` model code.
//
// The output follows the canonical figure recipe (see public/ai/figure.md):
// build a rig, build parts off it, weld the body, label regions, declare paint
// in code with `api.paint.label`, then hard-union and `.build()`. Eyes, lips and
// brows are unioned at the TOP level so each is a separately paintable label;
// the carved mouth is left off the assemble in favour of a paintable lip ridge.
//
// The generated code carries the spec as a `// @character v2 {json}` header so
// the panel round-trips it exactly, while the body stays ordinary, hand-editable
// figure code. Every v2 option is emitted only when it departs from the value
// that reproduces v1 output, so a migrated v1 spec generates byte-identical
// code below the header line (tests/unit/fixtures/characterV1Code.json). The
// same holds for the additive #1059 detail fields (trim, print, socks, toy
// shoes, shorts, bead eyes, …) against older v2 specs
// (tests/unit/fixtures/characterV2Code.json).
// Pure text generation (no DOM/engine) so it unit-tests in the vitest tier,
// like surfaceCodegen.ts.

import {
  type CharacterSpec,
  type Joint,
  LOCK_HAIR_STYLES,
  encodeSpecComment,
} from './characterSpec';

/** Format a scalar for source output (numbers trimmed to 6 sig-figs). */
function fmt(v: number | boolean | string): string {
  if (typeof v === 'number') return String(Number(v.toPrecision(6)));
  if (typeof v === 'boolean') return String(v);
  // Single-quoted literal, fully escaped — backslash/quote plus any control
  // char (newlines included) that a hand-edited @character header could smuggle
  // into a string value, so the generated code always parses.
  const s = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\u0000-\u001f\u2028\u2029]/g, c => {
    if (c === '\n') return '\\n';
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    if (c === '\u2028' || c === '\u2029') return '\\u' + c.charCodeAt(0).toString(16);
    return '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0');
  });
  return `'${s}'`;
}

/** Render a record as a one-line object literal, skipping undefined values.
 *  Returns '' (not '{}') when every value was skipped, so callers can drop the
 *  options argument entirely for a clean default call. */
function obj(rec: Record<string, number | boolean | string | undefined>): string {
  const entries = Object.entries(rec).filter(([, v]) => v !== undefined) as [string, number | boolean | string][];
  if (entries.length === 0) return '';
  return `{ ${entries.map(([k, v]) => `${k}: ${fmt(v)}`).join(', ')} }`;
}

/** Emit a pose joint as an options object, keeping only non-zero fields. Returns
 *  null when the joint is fully neutral so the whole key can be omitted. */
function jointLiteral(joint: Joint): string | null {
  const rec: Record<string, number | undefined> = {
    raiseSide: joint.raiseSide || undefined,
    raiseFwd: joint.raiseFwd || undefined,
    bend: joint.bend || undefined,
    twist: joint.twist || undefined,
  };
  const body = obj(rec);
  return body === '' ? null : body;
}

/** Build the `pose: { … }` fragment, omitting neutral joints and an all-neutral
 *  pose entirely. Returns '' when nothing to emit. */
function poseFragment(spec: CharacterSpec): string {
  const p = spec.pose;
  const parts: string[] = [];
  const add = (name: string, lit: string | null) => { if (lit) parts.push(`    ${name}: ${lit},`); };
  // A two-hand hold solves both arms (the rig rejects armL/armR alongside it).
  const holding = p.hold.kind === 'ball';
  if (!holding) {
    add('armL', jointLiteral(p.armL));
    add('armR', jointLiteral(p.armR));
  }
  add('legL', jointLiteral(p.legL));
  add('legR', jointLiteral(p.legR));
  const spine = obj({ lean: p.spine.lean || undefined, turn: p.spine.turn || undefined, side: p.spine.side || undefined });
  if (spine) parts.push(`    spine: ${spine},`);
  const head = obj({ yaw: p.head.yaw || undefined, pitch: p.head.pitch || undefined, roll: p.head.roll || undefined });
  if (head) parts.push(`    head: ${head},`);
  if (holding) {
    const extra = obj({
      cupL: p.hold.cupL ?? undefined,
      cupR: p.hold.cupR ?? undefined,
      handScale: p.hold.handScale !== 1 ? p.hold.handScale : undefined,
    });
    parts.push(`    hold: { sphere: { radius: ${fmt(p.hold.radius)} }, cup: ${fmt(p.hold.cup)}${extra ? `, ${extra.slice(2, -2)}` : ''} },`);
  }
  if (parts.length === 0) return '';
  return `\n  pose: {\n${parts.join('\n')}\n  },`;
}

/** Generate complete, runnable figure code for a spec. */
export function specToCode(spec: CharacterSpec): string {
  const { body, face, hair, clothing, colors } = spec;
  const holding = spec.pose.hold.kind === 'ball';
  // Stylized (scaled) heads bulge past the canon anchors — seat the brows on
  // the real built face so they don't bury (`on: face`).
  const stylized = body.proportions !== 'realistic' || (body.headScale !== null && body.headScale !== undefined);
  const L: string[] = [];

  L.push(encodeSpecComment(spec));
  L.push('// Generated by Character Creator — edit freely, or re-open Tools ▸ Character to keep tweaking.');
  L.push('const { sdf } = api;');
  L.push('const F = sdf.figure;');
  L.push('');

  // RIG — body proportions + pose. bust/belly only when set (default 0).
  const rigOpts: string[] = [
    `  height: ${fmt(body.height)},`,
    `  headsTall: ${fmt(body.headsTall)},`,
    `  build: ${fmt(body.build)},`,
    `  sex: ${fmt(body.sex)},`,
    `  age: ${fmt(body.age)},`,
    `  weight: ${fmt(body.weight)},`,
    `  muscle: ${fmt(body.muscle)},`,
  ];
  if (body.bust) rigOpts.push(`  bust: ${fmt(body.bust)},`);
  if (body.belly) rigOpts.push(`  belly: ${fmt(body.belly)},`);
  // v2 body plan — each only when set, so a realistic v1 spec is unchanged.
  if (body.proportions !== 'realistic') rigOpts.push(`  proportions: ${fmt(body.proportions)},`);
  if (body.headScale !== null && body.headScale !== undefined) {
    const hs = body.headScale;
    rigOpts.push(`  headScale: ${typeof hs === 'number' ? fmt(hs) : obj({ x: hs.x, y: hs.y, z: hs.z })},`);
  }
  const layout = obj({ eyeSpread: face.layout.eyeSpread ?? undefined, eyeHeight: face.layout.eyeHeight ?? undefined });
  if (layout) rigOpts.push(`  faceLayout: ${layout},`);
  if (body.headSink) rigOpts.push(`  headSink: ${fmt(body.headSink)},`);
  L.push(`const rig = F.rig({\n${rigOpts.join('\n')}${poseFragment(spec)}\n});`);
  L.push('');

  // HEAD + FACE — eyes/mouth left off the assemble so they become their own
  // top-level paint labels; nose/ears/brows shape come from the spec.
  const headKnobs = obj({
    jaw: face.jaw !== 1 ? face.jaw : undefined,
    chin: face.chin !== 1 ? face.chin : undefined,
    cheek: face.cheek !== 1 ? face.cheek : undefined,
  });
  L.push(`const head = F.head(rig, { faceShape: ${fmt(face.shape)}${headKnobs ? `, ${headKnobs.slice(2, -2)}` : ''} });`);
  L.push(`const face = F.face.assemble(head, rig, { eyes: false, nose: { type: ${fmt(face.nose)} }, mouth: false, ears: { type: ${fmt(face.ears)} } });`);
  L.push('');

  // SKIN — weld the body masses under one soft join.
  L.push('const skin = F.weld(rig, [');
  L.push('  F.torso(rig),');
  L.push('  F.neck(rig),');
  L.push('  F.arms(rig),');
  // Open palms when holding a ball (the hold solve assumes the open hand).
  L.push(`  F.hands(rig, { grip: ${fmt(holding ? 'open' : 'relaxed')}${body.mittens ? ', fingers: false' : ''} }),`);
  L.push('  F.legs(rig),');
  L.push('  F.feet(rig),');
  L.push('  face,');
  L.push("]).label('skin');");
  L.push('');

  // Top-level paintable face features.
  const unionMembers: string[] = ['skin'];
  // eyeSize scales the library's default eye radius (r.head · 0.16) — for bead
  // eyes too, so switching the eye style keeps the eye size.
  const bead = face.eyeStyle === 'bead';
  if (bead) {
    // Glossy vinyl-toy beads seated on the real face front, with a glint.
    const hl = face.highlight <= 0 ? false : face.highlight === 1 ? undefined : Math.max(0.2, face.highlight);
    const beadOpts = obj({ aspect: face.eyeAspect !== 1.06 ? face.eyeAspect : undefined, highlight: hl });
    L.push(`const eyes = F.face.eyes(rig, { style: 'bead', on: face, radius: rig.r.head * ${fmt(0.16 * face.eyeSize)}${beadOpts ? `, ${beadOpts.slice(2, -2)}` : ''} });`);
  } else {
    const eyeRadius = face.eyeSize !== 1 ? `radius: rig.r.head * ${fmt(0.16 * face.eyeSize)}, ` : '';
    L.push(`const eyes = F.face.eyes(rig, { ${eyeRadius}lids: ${fmt(face.lids)}, gaze: ${fmt(face.gaze)} });`);
  }
  unionMembers.push('eyes');
  if (face.mouth) {
    L.push(`const lips = F.face.mouthAccents(rig, { style: 'lips', lipShape: ${fmt(face.lipShape)}, expression: ${fmt(face.expression)} });`);
    unionMembers.push('lips');
  }
  const browKnobs = obj({
    thickness: face.browThickness !== 1 ? face.browThickness : undefined,
    width: face.browWidth !== 1 ? face.browWidth : undefined,
  });
  const browExtra = browKnobs ? `, ${browKnobs.slice(2, -2)}` : '';
  L.push(stylized
    ? `const brows = F.face.brows(rig, { shape: ${fmt(face.brows)}${browExtra}, on: face }).label('brows');`
    : `const brows = F.face.brows(rig, { shape: ${fmt(face.brows)}${browExtra} }).label('brows');`);
  unionMembers.push('brows');

  // Hair (omitted entirely when bald).
  if (hair.style !== 'bald') {
    let hairOpts = obj({ style: hair.style, length: hair.length, volume: hair.volume !== 1 ? hair.volume : undefined });
    if (LOCK_HAIR_STYLES.includes(hair.style)) {
      // Lock styles: only the knobs this style reads, only when off-default,
      // and `on: head` so the locks hug the real (scaled / cheeked) head.
      const anime = hair.style === 'anime', shag = hair.style === 'shag';
      const knobs = obj({
        lockShape: anime && hair.lockShape !== 'ribbon' ? hair.lockShape : undefined,
        chunk: (anime || shag) && hair.chunk !== 1 ? hair.chunk : undefined,
        spike: (anime || shag) && hair.spike !== 1 ? hair.spike : undefined,
        swoop: anime && hair.swoop !== 1 ? hair.swoop : undefined,
        crown: shag && hair.crown !== 'spiky' ? hair.crown : undefined,
        layers: shag && Math.round(hair.layers) !== 3 ? Math.round(hair.layers) : undefined,
        raggedness: shag && hair.raggedness !== 1 ? hair.raggedness : undefined,
        flare: shag && hair.flare !== 1 ? hair.flare : undefined,
        notched: shag && hair.notched === false ? false : undefined,
        crownSize: shag && hair.crownSize !== 1 ? hair.crownSize : undefined,
        backWidth: shag && hair.backWidth !== 1 ? hair.backWidth : undefined,
        tipWidth: shag && hair.tipWidth !== 0.4 ? hair.tipWidth : undefined,
        fringe: hair.fringe !== 1 ? hair.fringe : undefined,
        seed: hair.seed !== 1 ? hair.seed : undefined,
      });
      hairOpts = `${hairOpts.slice(0, -2)}${knobs ? `, ${knobs.slice(2, -2)}` : ''}, on: head }`;
    } else if (hair.style === 'captured') {
      // Measured on the real head. Captured reads its OWN fringe knob — the
      // lock styles' `fringe` was ignored here before, so old specs keep their code.
      const knobs = obj({
        preset: hair.preset !== 'tsubasa' ? hair.preset : undefined,
        spikiness: hair.spikiness !== 1 ? hair.spikiness : undefined,
        smooth: hair.smooth !== 0 ? hair.smooth : undefined,
        mirror: hair.mirror ? true : undefined,
        tilt: hair.tilt !== 0 ? hair.tilt : undefined,
        windowScale: hair.windowScale !== 1 ? hair.windowScale : undefined,
        fringe: hair.capturedFringe !== 1 ? hair.capturedFringe : undefined,
      });
      hairOpts = `${hairOpts.slice(0, -2)}${knobs ? `, ${knobs.slice(2, -2)}` : ''}, on: head }`;
    }
    L.push(`const hair = F.hair(rig, ${hairOpts}).label('hair');`);
    unionMembers.push('hair');
  }

  // Clothing.
  const top = clothing.top;
  const cuffs = top.trim.cuffs && top.sleeve !== 'none';
  const trimmed = top.trim.collar || cuffs;
  const prints = top.on ? top.print : [];
  if (top.on) {
    const topRec: Record<string, number | string | undefined> = { sleeve: top.sleeve };
    // A dress drops the hem to mid-thigh (figure API reads hemZ as an absolute
    // Z; derive it from the rig joints so it tracks proportions).
    const dress = top.length === 'dress';
    if (dress) L.push(`const dressHemZ = rig.joints.lowerLegL[2] + (rig.joints.hips[2] - rig.joints.lowerLegL[2]) * 0.45;`);
    const topArgs = dress ? `{ sleeve: ${fmt(top.sleeve)}, hemZ: dressHemZ }` : obj(topRec);
    if (trimmed || prints.length) {
      // The parted top: `topG.sleeves` scopes the cuffs, `topG.all` is what
      // trim splits and prints emboss onto.
      L.push(`const topG = F.garment.top(rig, ${topArgs});`);
      if (trimmed) {
        const zones: string[] = [];
        if (top.trim.collar) zones.push(`F.trimZone(rig, { ring: 'neck', width: rig.r.neck * 0.7, radius: rig.r.neck * 1.45 })`);
        if (cuffs) {
          zones.push(top.sleeve === 'long'
            ? `topG.sleeves.intersect(F.trimZone(rig, { bone: 'lowerArm', from: 0.78, to: 1.3, radius: rig.r.lowerArm * 3.3 }))`
            : `topG.sleeves.intersect(F.trimZone(rig, { bone: 'upperArm', from: 0.32, to: 1.4, radius: rig.r.upperArm * 3.3 }))`);
        }
        L.push(`const topTrim = F.trim(topG.all, ${zones.length === 1 ? zones[0] : `sdf.union(${zones.join(', ')})`});`);
        L.push(`const top = topTrim.rest.label('top'), trim = topTrim.band.label('trim');`);
        unionMembers.push('top', 'trim');
      } else {
        L.push(`const top = topG.all.label('top');`);
        unionMembers.push('top');
      }
      // Lettering, conformal to the cloth (F.emboss): sizes/offsets are in
      // chest half-widths so the print scales with the figure.
      prints.forEach((pr, i) => {
        const side = pr.where === 'back' ? '+' : '-';
        const at = `[rig.joints.chest[0] + rig.r.chestX * ${fmt(pr.x)}, rig.joints.chest[1] ${side} rig.r.chestY * 1.6, rig.joints.chest[2] + rig.r.chestX * ${fmt(pr.z)}]`;
        const font = pr.font !== 'bold' ? `, font: ${fmt(pr.font)}` : '';
        L.push(`const print${i + 1} = F.emboss(${fmt(pr.text)}, topG.all, { at: ${at}, size: rig.r.chestX * ${fmt(pr.size)}${font}, label: 'print${i + 1}' });`);
        unionMembers.push(`print${i + 1}`);
      });
    } else {
      L.push(`const top = F.clothing.top(rig, ${topArgs}).label('top');`);
      unionMembers.push('top');
    }
  }
  if (clothing.pants.on) {
    const shorts = clothing.pants.length === 'shorts';
    const pantsOpts = obj({
      leg: clothing.pants.leg, rise: clothing.pants.rise, length: clothing.pants.length,
      hem: shorts && clothing.pants.hem !== 0.9 ? clothing.pants.hem : undefined,
    });
    L.push(`const pants = F.clothing.pants(rig, ${pantsOpts}).label('pants');`);
    unionMembers.push('pants');
  }
  const socks = clothing.socks;
  const stripes = Math.round(socks.stripes);
  if (socks.on) {
    // The shin skin grown proud and clipped to the sock span (a trim zone along
    // each lower-leg bone, past the ankle into the shoe); stripes split a band
    // off the top.
    // Without footwear the sock ends at the ankle instead of running into the shoe.
    const sockTo = clothing.feet.on ? 1.1 : 1;
    const from = Math.min(1 - socks.height, sockTo - 0.05);
    L.push(`const shins = F.legs(rig).round(rig.r.lowerLeg * 0.28).intersect(F.trimZone(rig, { bone: 'lowerLeg', from: ${fmt(from)}, to: ${fmt(sockTo)}, radius: rig.r.lowerLeg * 2.6 }));`);
    if (stripes > 0) {
      const to = Math.min(sockTo, from + socks.stripeSpan);
      const n = stripes > 1 ? `, stripes: ${stripes}` : '';
      L.push(`const sock = F.trim(shins, F.trimZone(rig, { bone: 'lowerLeg', from: ${fmt(from)}, to: ${fmt(to)}, radius: rig.r.lowerLeg * 2.8${n} }));`);
      L.push(`const socks = sock.rest.label('socks'), sockStripe = sock.band.label('sockStripe');`);
      unionMembers.push('socks', 'sockStripe');
    } else {
      L.push(`const socks = shins.label('socks');`);
      unionMembers.push('socks');
    }
  }
  if (clothing.feet.on) {
    const f = clothing.feet;
    const boots = f.kind === 'boots';
    const toy = !boots && f.style === 'toy';
    const cleats = toy ? Math.round(f.cleats) : 0;
    const feetOpts = obj({
      label: 'feet',
      style: toy ? 'toy' : undefined,
      size: f.size !== 1 ? f.size : undefined,
      height: toy && f.height !== 1 ? f.height : undefined,
      cleats: cleats > 0 ? Math.max(2, cleats) : undefined,
    });
    L.push(`const feet = F.clothing.${boots ? 'boots' : 'shoes'}(rig, ${feetOpts});`);
    unionMembers.push('feet');
  }
  if (holding) {
    L.push(`const ball = F.heldSphere(rig).label('ball');`);
    unionMembers.push('ball');
  }
  if (spec.base) {
    L.push(`const base = F.base(rig).label('base');`);
    unionMembers.push('base');
  }
  L.push('');

  // PAINT — declared in code so colours persist with the saved version and
  // round-trip through the panel. Only emit labels that exist in this build.
  const paint: Array<[string, string]> = [
    ['skin', colors.skin],
    ['eyes', colors.eyes],
    ['iris', colors.iris],
    ['pupil', colors.pupil],
    ['lips', colors.lips],
    ['brows', colors.brows],
  ];
  if (!face.mouth) paint.splice(paint.findIndex(([l]) => l === 'lips'), 1);
  if (bead) {
    // A bead has no iris / pupil / lids — just the bead and its glint.
    for (const l of ['iris', 'pupil']) paint.splice(paint.findIndex(([x]) => x === l), 1);
    if (face.highlight > 0) paint.splice(2, 0, ['eyeHighlight', colors.eyeHighlight]);
  } else if (face.lids !== 'none') {
    // `F.face.eyes` only emits a skin-coloured eyelid region ('lids') when lids
    // aren't 'none'; paint it skin so it doesn't render as a grey patch.
    paint.splice(1, 0, ['lids', colors.skin]);
  }
  if (hair.style !== 'bald') paint.push(['hair', colors.hair]);
  if (top.on) paint.push(['top', colors.top]);
  if (top.on && trimmed) paint.push(['trim', colors.trim]);
  prints.forEach((pr, i) => paint.push([`print${i + 1}`, pr.color]));
  if (clothing.pants.on) paint.push(['pants', colors.pants]);
  if (socks.on) {
    paint.push(['socks', colors.socks]);
    if (stripes > 0) paint.push(['sockStripe', colors.sockStripe]);
  }
  if (clothing.feet.on) { paint.push(['feet', colors.feet]); paint.push(['sole', colors.sole ?? colors.feet]); }
  if (spec.base) paint.push(['base', colors.base]);
  for (const [label, color] of paint) L.push(`api.paint.label(${fmt(label)}, ${fmt(color)});`);
  // The ball: truncated-icosahedron soccer panels fitted to the 'ball' label.
  if (holding) L.push(`api.paint.pattern({ pattern: 'soccer', withinPart: 'ball', colors: [${fmt(colors.ball)}, ${fmt(spec.pose.hold.color)}] });`);
  L.push('');

  // BUILD — finer face + hand grids via detail regions. v2 specs finish with
  // F.place (bottom at z = 0, facing +X); migrated v1 specs keep the builder frame.
  // A placed (v2) figure scales its mesh edge with height (0.55 at the default
  // 60) so the triangle count stays in budget at any size; v1 keeps the fixed 0.55.
  const edge = spec.place ? fmt(0.55 * body.height / 60) : '0.55';
  const build = `  .build({ edgeLength: ${edge}, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });`;
  if (spec.place) {
    L.push(`const model = sdf.union(${unionMembers.join(', ')})`);
    L.push(build);
    L.push(`return F.place(model, rig, { face: '+X' });`);
  } else {
    L.push(`return sdf.union(${unionMembers.join(', ')})`);
    L.push(build);
  }

  return L.join('\n') + '\n';
}
