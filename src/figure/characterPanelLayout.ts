// The Character Creator panel's layout, derived from SPEC_FIELDS. Each spec
// field's `ui` metadata (characterSpec.ts) says which section it shows in, how
// (slider range, option labels, segmented buttons) and when; this module turns
// that into the ordered, visibility-filtered sections the panel renders, plus
// the get/set helpers its generic controls use. Pure data — no DOM — so it
// unit-tests in the vitest tier (tests/unit/characterPanelLayout.test.ts).

import {
  type CharacterSpec,
  type CustomControlId,
  type FieldUi,
  type PanelSectionId,
  type SpecLeaf,
  PANEL_SECTIONS,
  specLeaves,
} from './characterSpec';

/** One control the panel shows: a spec field plus its panel metadata. */
export interface PanelControl {
  path: string;
  kind: SpecLeaf['kind'];
  ui: FieldUi;
  /** enum: the allowed values, in list order. */
  values?: readonly string[];
  nullable?: boolean;
  /** num: the hard bounds a typed value is clamped to. */
  hardMin: number;
  hardMax: number;
  /** Set on the last visible member of a `ui.reset` group: render the group's
   *  "back to null" button after this control. */
  resetAfter?: { label: string; paths: string[] };
}

export interface PanelSection {
  id: PanelSectionId;
  title: string;
  collapsible: boolean;
  controls: PanelControl[];
}

interface Entry { leaf: SpecLeaf; ui: FieldUi; index: number }

let shownCache: Entry[] | null = null;
/** Every field the panel can show (not `{ hidden }`), with its tree index. */
function shownFields(): Entry[] {
  if (!shownCache) {
    shownCache = specLeaves()
      .map((leaf, index) => ({ leaf, ui: leaf.ui, index }))
      .filter((x): x is Entry => !!x.ui && !('hidden' in x.ui));
  }
  return shownCache;
}

/** Read a dotted path out of a spec. */
export function getAt(spec: CharacterSpec, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], spec);
}

/** Write a dotted path in a (normalized) spec. */
export function setAt(spec: CharacterSpec, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const parent = keys.reduce<Record<string, unknown>>((o, k) => o[k] as Record<string, unknown>, spec as unknown as Record<string, unknown>);
  parent[last] = value;
}

/** Set a control's field, its mirrors, then run its `onSet` effect. */
export function applyControl(spec: CharacterSpec, control: PanelControl, value: unknown): void {
  setAt(spec, control.path, value);
  for (const m of control.ui.mirror ?? []) setAt(spec, m, value);
  control.ui.onSet?.(spec, value);
}

/** The value a control displays: a null field shows its effective value. */
export function controlValue(spec: CharacterSpec, control: PanelControl): unknown {
  const v = getAt(spec, control.path);
  if (v === null && control.ui.nullShows) return control.ui.nullShows(spec);
  return v;
}

/** 'bigSmile' → 'Big smile', 'boxBraids' → 'Box braids'. */
export function humanize(value: string): string {
  const words = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** An enum control's `[value, label]` options; a nullable enum's null option
 *  is the empty string. */
export function enumOptions(control: PanelControl): [string, string][] {
  const opts: [string, string][] = (control.values ?? []).map(v => [v, control.ui.options?.[v] ?? humanize(v)]);
  if (control.nullable) opts.unshift(['', control.ui.nullLabel ?? 'Default']);
  return opts;
}

/** The panel's sections for `spec`, in display order, each holding its
 *  visible controls (sort: `ui.order`, then tree order). Empty sections drop. */
export function panelLayout(spec: CharacterSpec): PanelSection[] {
  const out: PanelSection[] = [];
  for (const sec of PANEL_SECTIONS) {
    const entries = shownFields()
      .filter(x => x.ui.section === sec.id && (!x.ui.when || x.ui.when(spec)))
      .sort((a, b) => (a.ui.order ?? 0) - (b.ui.order ?? 0) || a.index - b.index);
    if (entries.length === 0) continue;
    const controls = entries.map(({ leaf, ui }): PanelControl => {
      const slider = ui.slider;
      return {
        path: leaf.path, kind: leaf.kind, ui,
        values: leaf.values, nullable: leaf.nullable,
        hardMin: ui.hard?.min ?? leaf.min ?? slider?.[0] ?? -Infinity,
        hardMax: ui.hard?.max ?? leaf.max ?? slider?.[1] ?? Infinity,
      };
    });
    // One reset button per group, after its last visible member. It resets
    // every member (shown or not), so a group stays whole if one gets a `when`.
    const groups = new Map<string, PanelControl[]>();
    for (const ctl of controls) if (ctl.ui.reset) groups.set(ctl.ui.reset, [...(groups.get(ctl.ui.reset) ?? []), ctl]);
    for (const [label, visible] of groups) {
      const paths = shownFields().filter(x => x.ui.reset === label).map(x => x.leaf.path);
      visible[visible.length - 1].resetAfter = { label, paths };
    }
    const countPath = 'countPath' in sec ? sec.countPath : undefined;
    const count = countPath ? (getAt(spec, countPath) as unknown[] | undefined)?.length ?? 0 : 0;
    out.push({
      id: sec.id,
      title: count ? `${sec.title} (${count})` : sec.title,
      collapsible: 'collapsible' in sec && sec.collapsible === true,
      controls,
    });
  }
  return out;
}

/** A key that changes whenever an edit should re-render the panel: a control
 *  appears or disappears, a section title changes, a reset button flips
 *  between enabled and disabled, a null field's displayed value moves (the
 *  Sole swatch follows the footwear colour), or a segmented value changes (its
 *  pressed button is drawn at render time). Plain value edits keep it. */
export function layoutKey(spec: CharacterSpec): string {
  return panelLayout(spec).map(s => `${s.title}:${s.controls.map(c => {
    let k = c.path;
    if (c.ui.control === 'segmented') k += `=${String(getAt(spec, c.path))}`;
    if (c.ui.nullShows && getAt(spec, c.path) === null) k += `~${String(controlValue(spec, c))}`;
    if (c.resetAfter) k += c.resetAfter.paths.every(p => getAt(spec, p) === null) ? '!default' : '!set';
    return k;
  }).join(',')}`).join('|');
}

/** Fields the panel draws with a custom renderer, by renderer id. */
export function customControlPaths(): Map<CustomControlId, string[]> {
  const m = new Map<CustomControlId, string[]>();
  for (const { leaf, ui } of shownFields()) if (ui.custom) m.set(ui.custom, [...(m.get(ui.custom) ?? []), leaf.path]);
  return m;
}
