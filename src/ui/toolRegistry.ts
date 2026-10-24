// Leaf registry of the app's "tools" — the docked panels and modes a user opens
// from the Tools / Inspect menus (Surface, Paint, Resize, Place, Quality,
// Character Creator, Convert to code, Detect parts, Measure, Annotate, …).
//
// Each panel module registers a `ToolSpec` next to its palette command. The
// spec is the ONE opener the palette, the toolbar button and the
// `partwright.openTool(id, prefill)` API all share, so an AI can open a panel
// for the user with its fields pre-set and hand control over — the user
// tweaks and clicks Apply; opening never applies anything by itself.
//
// This module imports nothing from feature modules (only the leaf viewport
// panel registry), so any module can register into it without a cycle.

import { runWithSilentPanelOpen } from './viewportPanelRegistry';

// ---------------------------------------------------------------------------
// Prefill schema — a tiny, JSON-able field description. It doubles as the
// documented shape returned by `listUiCommands()` and is what validatePrefill
// checks before an opener runs.
// ---------------------------------------------------------------------------

export type PrefillField =
  | { type: 'number'; min?: number; max?: number; integer?: boolean; description?: string }
  | { type: 'boolean'; description?: string }
  | { type: 'enum'; values: readonly string[]; description?: string }
  | { type: 'string'; maxLength?: number; description?: string }
  /** `[x, y, z]` finite numbers. */
  | { type: 'vec3'; description?: string }
  /** A number OR an `[x, y, z]` triple (e.g. a uniform vs per-axis scale). */
  | { type: 'numberOrVec3'; min?: number; description?: string }
  /** `[r, g, b]` in 0..1 or a `#rrggbb` / `#rgb` hex string — normalized to `[r, g, b]`. */
  | { type: 'color'; description?: string }
  /** A nested object. With `fields`, its keys are validated too (unknown keys
   *  rejected); without, it is free-form and the opener validates it. */
  | { type: 'object'; fields?: PrefillSchema; description?: string };

export type PrefillSchema = Record<string, PrefillField>;

export interface ToolOpenContext {
  /** A one-line reason shown in the panel ("Suggested by AI: …"). */
  note?: string;
  /** Who is opening it. Programmatic opens ('ai' / 'api') are "silent": they
   *  don't step the AI chat panel aside, so the chat stays next to the tool. */
  source?: 'ui' | 'ai' | 'api';
}

export interface ToolOpenOutcome {
  /** The prefill values that landed in the panel (normalized). */
  applied: Record<string, unknown>;
  /** Valid keys that had no effect in the current context (e.g.
   *  `preserveColor` on an unpainted model) — reported, not an error. */
  ignored: string[];
}

export type ToolOpenResult = ToolOpenOutcome | { error: string };

export interface ToolSpec {
  /** Stable id — the palette command's id (e.g. 'tool-surface'). */
  id: string;
  title: string;
  /** Category shown dimly (matches the palette hint). */
  hint?: string;
  /** Documented prefill keys. Omit for a tool that takes no prefill. */
  prefillSchema?: PrefillSchema;
  /** Context gate (e.g. "needs a model on screen"). Default: always. */
  enabled?(): boolean;
  /** Open the panel with `prefill` applied (already schema-validated and
   *  normalized). Must NOT apply the operation. Return `{error}` when a value
   *  fails the panel's own (model-dependent) ranges. */
  open(prefill: Record<string, unknown> | undefined, ctx: ToolOpenContext): ToolOpenResult | void | Promise<ToolOpenResult | void>;
  /** The open panel's current field values (what the user has tweaked). */
  getState?(): Record<string, unknown> | null;
  isOpen(): boolean;
  close?(): void;
  /** A viewport MODE that sits alongside the docked panels (Measure, Cross
   *  section) rather than a docked panel itself. getOpenTool() reports the
   *  docked panel first. */
  overlay?: boolean;
}

const tools = new Map<string, ToolSpec>();

/** Register (or replace, by id) a tool. */
export function registerTool(spec: ToolSpec): void {
  tools.set(spec.id, spec);
}

/** All registered tools, in registration order. */
export function listTools(): ToolSpec[] {
  return [...tools.values()];
}

export function getTool(id: string): ToolSpec | undefined {
  return tools.get(id);
}

/** The first registered tool whose panel is open, or null. */
export function getOpenTool(): ToolSpec | null {
  const open = (t: ToolSpec) => { try { return t.isOpen(); } catch { return false; } /* half-initialised = closed */ };
  const all = [...tools.values()];
  // The docked panel (at most one is open — the viewport panel registry
  // enforces it) wins over an overlay mode that happens to be on too.
  return all.find(t => !t.overlay && open(t)) ?? all.find(t => t.overlay && open(t)) ?? null;
}

/** Whether a programmatic open should leave the AI panel where it is. Only on
 *  the desktop layout, where the chat sits BESIDE the tool; on the stacked
 *  phone layout the chat is full-screen, so the tool must step it aside or it
 *  would open hidden behind the chat. */
function keepAiPanelBeside(): boolean {
  try {
    return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      || window.matchMedia('(min-width: 768px)').matches;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Validation (pure — unit-tested)
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number' && Number.isFinite(n));
}

/** `#rgb` / `#rrggbb` / `[r,g,b]` (0..1) → `[r,g,b]`, or null if invalid. */
export function parsePrefillColor(v: unknown): [number, number, number] | null {
  if (isVec3(v)) return v.every(n => n >= 0 && n <= 1) ? [v[0], v[1], v[2]] : null;
  if (typeof v !== 'string') return null;
  let h = v.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

function describeAllowed(schema: PrefillSchema): string {
  const keys = Object.keys(schema);
  return keys.length ? keys.join(', ') : '(none)';
}

function checkField(field: PrefillField, v: unknown, path: string, errors: string[]): unknown {
  switch (field.type) {
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) { errors.push(`${path} must be a finite number`); return undefined; }
      if (field.integer && !Number.isInteger(v)) { errors.push(`${path} must be an integer`); return undefined; }
      if (field.min !== undefined && v < field.min) { errors.push(`${path} must be >= ${field.min} (got ${v})`); return undefined; }
      if (field.max !== undefined && v > field.max) { errors.push(`${path} must be <= ${field.max} (got ${v})`); return undefined; }
      return v;
    }
    case 'boolean':
      if (typeof v !== 'boolean') { errors.push(`${path} must be a boolean`); return undefined; }
      return v;
    case 'enum':
      if (typeof v !== 'string' || !field.values.includes(v)) {
        errors.push(`${path} must be one of ${field.values.map(s => JSON.stringify(s)).join(', ')}`);
        return undefined;
      }
      return v;
    case 'string':
      if (typeof v !== 'string') { errors.push(`${path} must be a string`); return undefined; }
      if (field.maxLength !== undefined && v.length > field.maxLength) { errors.push(`${path} must be at most ${field.maxLength} characters`); return undefined; }
      return v;
    case 'vec3':
      if (!isVec3(v)) { errors.push(`${path} must be [x, y, z] (three finite numbers)`); return undefined; }
      return [v[0], v[1], v[2]];
    case 'numberOrVec3': {
      const nums = typeof v === 'number' ? [v] : isVec3(v) ? v : null;
      if (!nums || !nums.every(n => Number.isFinite(n))) { errors.push(`${path} must be a number or [x, y, z]`); return undefined; }
      if (field.min !== undefined && nums.some(n => n < field.min!)) { errors.push(`${path} values must be >= ${field.min}`); return undefined; }
      return typeof v === 'number' ? v : [nums[0], nums[1], nums[2]];
    }
    case 'color': {
      const c = parsePrefillColor(v);
      if (!c) { errors.push(`${path} must be [r, g, b] in 0..1 or a "#rrggbb" hex string`); return undefined; }
      return c;
    }
    case 'object': {
      if (!isPlainObject(v)) { errors.push(`${path} must be an object`); return undefined; }
      if (!field.fields) return v;
      return checkObject(field.fields, v, path, errors);
    }
  }
}

function checkObject(schema: PrefillSchema, obj: Record<string, unknown>, path: string, errors: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const field = schema[k];
    const p = path ? `${path}.${k}` : k;
    if (!field) { errors.push(`unknown key "${p}" (allowed: ${describeAllowed(schema)})`); continue; }
    if (v === undefined) continue;
    const ok = checkField(field, v, p, errors);
    if (ok !== undefined) out[k] = ok;
  }
  return out;
}

/** Validate a prefill object against a schema. Unknown keys (at any nested
 *  level that declares `fields`) are rejected, like every other API. Returns
 *  the normalized value (colors → `[r,g,b]`) or an error listing every bad key. */
export function validatePrefill(
  schema: PrefillSchema | undefined,
  prefill: unknown,
  label = 'prefill',
): { value: Record<string, unknown> } | { error: string } {
  if (prefill === undefined || prefill === null) return { value: {} };
  if (!isPlainObject(prefill)) return { error: `${label} must be an object` };
  if (!schema) {
    const keys = Object.keys(prefill);
    return keys.length ? { error: `${label}: this tool takes no prefill (got ${keys.join(', ')})` } : { value: {} };
  }
  const errors: string[] = [];
  const value = checkObject(schema, prefill, '', errors);
  if (errors.length) return { error: `${label}: ${errors.join('; ')}` };
  return { value };
}

/** Clamp-free range check against a live control's bounds (used by openers
 *  whose ranges depend on the model). Pushes an error and returns false when
 *  out of range. */
export function checkRange(path: string, v: number, min: number, max: number, errors: string[]): boolean {
  if (!Number.isFinite(v)) { errors.push(`${path} must be a finite number`); return false; }
  if (v < min || v > max) {
    const fmt = (n: number) => (Number.isFinite(n) ? String(Number(n.toPrecision(6))) : n > 0 ? '∞' : '-∞');
    errors.push(`${path} must be in [${fmt(min)}, ${fmt(max)}] for this model (got ${v})`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

/** Open a registered tool by id: validate the prefill against its schema, then
 *  run its opener. On the desktop layout, programmatic sources ('ai' / 'api')
 *  open silently (the AI panel stays beside the tool); on a phone the tool
 *  steps the full-screen chat aside like a user open. Returns `{ ok, applied, ignored }` or `{ error }`. */
export async function openTool(
  id: string,
  prefill?: unknown,
  ctx: ToolOpenContext = {},
): Promise<{ ok: true; id: string; applied: Record<string, unknown>; ignored: string[] } | { error: string }> {
  const spec = tools.get(id);
  if (!spec) return { error: `openTool: unknown tool "${id}". Known tools: ${[...tools.keys()].join(', ')}` };
  try {
    if (spec.enabled && !spec.enabled()) return { error: `openTool: "${id}" isn't available right now (it needs the editor with a model on screen, or the right session language).` };
  } catch { /* treat a throwing gate as enabled */ }
  const checked = validatePrefill(spec.prefillSchema, prefill, `openTool("${id}").prefill`);
  if ('error' in checked) return checked;
  const hasPrefill = Object.keys(checked.value).length > 0;
  const source = ctx.source ?? 'ui';
  const run = () => spec.open(hasPrefill ? checked.value : undefined, { ...ctx, source });
  try {
    const r = await (source !== 'ui' && keepAiPanelBeside() ? runWithSilentPanelOpen(run) : run());
    if (r && 'error' in r) return { error: `openTool("${id}"): ${r.error}` };
    return { ok: true, id, applied: r ? r.applied : checked.value, ignored: r ? r.ignored : [] };
  } catch (e) {
    return { error: `openTool("${id}"): ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ---------------------------------------------------------------------------
// Shared "Suggested by AI: …" context line
// ---------------------------------------------------------------------------

/** Build the note banner a panel shows when opened with `ctx.note` — the same
 *  look as the Part Detection panel's context line. */
export function createToolNote(note: string, source?: ToolOpenContext['source']): HTMLElement {
  const banner = document.createElement('div');
  banner.className = 'shrink-0 rounded border border-violet-500/40 bg-violet-500/10 px-2.5 py-2 text-[12px] text-zinc-200 leading-snug';
  banner.dataset.toolNote = '';
  const lead = document.createElement('span');
  lead.className = 'font-medium text-violet-200';
  // Programmatic opens (the in-app AI or an external agent on the console API)
  // are AI suggestions; a plain 'ui' open with a note is just a suggestion.
  lead.textContent = source === 'ui' ? 'Suggested: ' : 'Suggested by AI: ';
  banner.append(lead, document.createTextNode(note));
  return banner;
}

/** Put (or clear, with a null note) the note banner as the first child of a
 *  persistent panel's content. Used by panels that toggle visibility rather
 *  than rebuild (Paint, Annotate, Quality). */
export function setToolNote(host: HTMLElement | null, note: string | null | undefined, source?: ToolOpenContext['source']): void {
  if (!host) return;
  host.querySelector(':scope > [data-tool-note]')?.remove();
  if (!note) return;
  const banner = createToolNote(note, source);
  banner.classList.add('mb-2');
  host.prepend(banner);
}
