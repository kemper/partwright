import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SPEC,
  cloneSpec,
  applyStyle,
  specLeaves,
  validateSpec,
  CUSTOM_CONTROL_IDS,
  PANEL_SECTIONS,
  type CharacterSpec,
} from '../../src/figure/characterSpec';
import {
  panelLayout,
  layoutKey,
  applyControl,
  controlValue,
  enumOptions,
  getAt,
  humanize,
  customControlPaths,
  type PanelControl,
} from '../../src/figure/characterPanelLayout';

const spec = (patch: (s: CharacterSpec) => void = () => {}): CharacterSpec => { const s = cloneSpec(DEFAULT_SPEC); patch(s); return s; };
const labels = (s: CharacterSpec) => panelLayout(s).flatMap(sec => sec.controls.map(c => c.ui.label));
const control = (s: CharacterSpec, path: string): PanelControl => {
  const c = panelLayout(s).flatMap(sec => sec.controls).find(x => x.path === path);
  if (!c) throw new Error(`${path} not shown`);
  return c;
};

// The drift guards: every SPEC_FIELDS leaf is decided for the panel, so a new
// spec field fails here until it gets `ui` metadata (shown) or `{ hidden }`.
describe('every spec field is decided for the panel', () => {
  const leaves = specLeaves();

  it('each leaf has ui metadata or a hidden reason', () => {
    const undecided = leaves.filter(l => !l.ui).map(l => l.path);
    // Fix: add `ui: { label, section, … }` to the field in SPEC_FIELDS, or `hide(field, 'why')`.
    expect(undecided).toEqual([]);
    for (const l of leaves) if (l.ui && 'hidden' in l.ui) expect(l.ui.hidden.length, l.path).toBeGreaterThan(5);
  });

  it('shown fields are renderable: a generic kind or a custom renderer', () => {
    for (const l of leaves) {
      if (!l.ui || 'hidden' in l.ui) continue;
      if (l.ui.custom) continue;
      expect(['enum', 'num', 'bool', 'color'], `${l.path} (${l.kind}) needs ui.custom`).toContain(l.kind);
      if (l.kind === 'num') expect(l.ui.slider, `${l.path} needs ui.slider`).toBeDefined();
      if (l.ui.control === 'segmented') expect(l.kind, l.path).toBe('enum');
      if (l.ui.nullShows || l.ui.reset) expect(l.nullable, `${l.path} has null handling but is not nullable`).toBe(true);
      if (l.nullable && l.kind !== 'enum') expect(l.ui.nullShows, `${l.path} is nullable: say what null shows`).toBeDefined();
    }
  });

  it('slider ranges sit inside the hard bounds validateSpec enforces', () => {
    for (const l of leaves) {
      if (!l.ui || 'hidden' in l.ui || !l.ui.slider) continue;
      const [lo, hi, step] = l.ui.slider;
      expect(lo, l.path).toBeLessThan(hi);
      expect(step, l.path).toBeGreaterThan(0);
      if (l.min !== undefined) expect(lo, l.path).toBeGreaterThanOrEqual(l.min);
      if (l.max !== undefined) expect(hi, l.path).toBeLessThanOrEqual(l.max);
    }
  });

  it('option labels and mirrors only name real values and fields', () => {
    const paths = new Set(leaves.map(l => l.path));
    for (const l of leaves) {
      if (!l.ui || 'hidden' in l.ui) continue;
      for (const v of Object.keys(l.ui.options ?? {})) expect(l.values, `${l.path} option ${v}`).toContain(v);
      for (const m of l.ui.mirror ?? []) expect(paths.has(m), `${l.path} mirrors ${m}`).toBe(true);
    }
  });

  it('every custom renderer id is used by exactly one field', () => {
    const used = customControlPaths();
    expect([...used.keys()].sort()).toEqual([...CUSTOM_CONTROL_IDS].sort());
    for (const [id, paths] of used) expect(paths, id).toHaveLength(1);
  });

  it('every field names a real section', () => {
    const ids = new Set<string>(PANEL_SECTIONS.map(s => s.id));
    for (const l of leaves) if (l.ui && !('hidden' in l.ui)) expect(ids.has(l.ui.section), l.path).toBe(true);
  });
});

describe('panelLayout', () => {
  it('lays out the default spec in section order with the familiar controls', () => {
    const secs = panelLayout(spec());
    expect(secs.map(s => s.id)).toEqual(['style', 'body', 'pose', 'face', 'details', 'hair', 'clothing', 'kit', 'print', 'colors']);
    expect(secs.filter(s => s.collapsible).map(s => s.id)).toEqual(['details', 'kit', 'print']);
    const all = labels(spec());
    for (const l of ['Proportions', 'Head size', 'Height', 'Heads tall', 'Arms out', 'Holding', 'Eye spacing', 'Show mouth', 'Eye style',
      'Brow weight', 'Head sink', 'Style', 'Volume', 'Top', 'Leg cut', 'Stand / base', 'Collar trim', 'Socks', 'Shoe style', 'Print', 'Skin', 'Sole']) {
      expect(all, l).toContain(l);
    }
    // Conditional controls start hidden.
    for (const l of ['Ball size', 'Lock shape', 'Swoop', 'Raggedness', 'Spikiness', 'Glint', 'Shorts hem', 'Sock height', 'Cleats']) expect(all, l).not.toContain(l);
  });

  it('never shows two controls with the same label in one section', () => {
    const variants = [spec(), spec(s => { s.hair.style = 'anime'; }), spec(s => { s.hair.style = 'shag'; }), spec(s => { s.hair.style = 'captured'; }),
      spec(s => { s.pose.hold.kind = 'ball'; s.clothing.socks.on = true; s.clothing.feet.style = 'toy'; s.face.eyeStyle = 'bead'; s.clothing.pants.length = 'shorts'; })];
    for (const v of variants) for (const sec of panelLayout(v)) {
      const ls = sec.controls.map(c => c.ui.label);
      expect(new Set(ls).size, `${sec.id}: ${ls.join(', ')}`).toBe(ls.length);
    }
  });

  it('follows the `when` rules', () => {
    expect(labels(spec(s => { s.hair.style = 'anime'; }))).toEqual(expect.arrayContaining(['Lock shape', 'Lock width', 'Spike', 'Swoop', 'Fringe', 'Seed']));
    const shag = labels(spec(s => { s.hair.style = 'shag'; }));
    expect(shag).toEqual(expect.arrayContaining(['Crown', 'Layers', 'Raggedness', 'Flare', 'Spike', 'Fringe', 'Notched fringe']));
    expect(shag).not.toContain('Lock shape');
    expect(shag).not.toContain('Swoop');
    const ball = labels(spec(s => { s.pose.hold.kind = 'ball'; }));
    expect(ball).toEqual(expect.arrayContaining(['Ball size', 'Hands', 'Left hand', 'Right hand', 'Hand size', 'Ball', 'Ball panels']));
    expect(ball).not.toContain('Arms out');
    expect(labels(spec(s => { s.clothing.feet.kind = 'boots'; }))).not.toContain('Shoe style');
  });

  it('sorts by ui.order, then tree order (head sink after the face details; ball before its panels)', () => {
    const details = panelLayout(spec()).find(s => s.id === 'details')!.controls.map(c => c.ui.label);
    expect(details.slice(-2)).toEqual(['Head sink', 'Mitten hands']);
    const pose = panelLayout(spec(s => { s.pose.hold.kind = 'ball'; })).find(s => s.id === 'pose')!.controls.map(c => c.ui.label);
    expect(pose.slice(-2)).toEqual(['Ball', 'Ball panels']);
  });

  it('counts the print list in its section title', () => {
    expect(panelLayout(spec()).find(s => s.id === 'print')!.title).toBe('Print');
    const two = spec(s => { s.clothing.top.print = [{ ...s.clothing.top.print[0], text: 'A', where: 'chest', size: 0.6, x: 0, z: 0, color: '#111111', font: 'bold' }, { text: '9', where: 'back', size: 1, x: 0, z: 0, color: '#111111', font: 'bold' }]; });
    expect(panelLayout(two).find(s => s.id === 'print')!.title).toBe('Print (2)');
  });

  it('puts one reset button after the last member of a group', () => {
    const face = panelLayout(spec()).find(s => s.id === 'face')!.controls;
    const withReset = face.filter(c => c.resetAfter);
    expect(withReset.map(c => c.path)).toEqual(['face.layout.eyeHeight']);
    expect(withReset[0].resetAfter).toEqual({ label: 'Reset eye layout', paths: ['face.layout.eyeSpread', 'face.layout.eyeHeight'] });
  });

  it('changes layoutKey only when the visible controls change', () => {
    const s = spec();
    const k = layoutKey(s);
    s.body.height = 70;
    expect(layoutKey(s)).toBe(k);
    s.hair.style = 'anime';
    expect(layoutKey(s)).not.toBe(k);
  });
});

describe('controls read and write the spec', () => {
  it('mirrors a paired joint and keeps the spec valid', () => {
    const s = spec();
    applyControl(s, control(s, 'pose.armL.raiseSide'), 42);
    expect(s.pose.armL.raiseSide).toBe(42);
    expect(s.pose.armR.raiseSide).toBe(42);
    expect(validateSpec(s)).toEqual([]);
  });

  it('runs onSet (a fresh ball is sized to the figure)', () => {
    const s = spec(t => { t.body.height = 80; });
    applyControl(s, control(s, 'pose.hold.kind'), 'ball');
    expect(s.pose.hold.radius).toBe(8);
  });

  it('shows a null field as its effective value', () => {
    const s = spec();
    expect(controlValue(s, control(s, 'colors.sole'))).toBe(s.colors.feet);
    applyStyle(s, 'funko');
    expect(controlValue(s, control(s, 'face.layout.eyeHeight'))).toBe(-0.35);
    expect(getAt(s, 'face.layout.eyeHeight')).toBeNull();
  });

  it('labels options, with an empty value for a nullable enum', () => {
    const s = spec(t => { t.pose.hold.kind = 'ball'; });
    expect(enumOptions(control(s, 'pose.hold.cupL'))).toEqual([['', 'Same as both'], ['sides', 'On the side'], ['under', 'Cradled under']]);
    expect(enumOptions(control(s, 'face.expression'))[0]).toEqual(['bigSmile', 'Big smile']);
    expect(humanize('boxBraids')).toBe('Box braids');
  });
});
