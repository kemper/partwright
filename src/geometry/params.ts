// Customizer parameter layer — pure logic.
//
// A model can declare a small schema of tweakable parameters at the top of its
// code via `api.params({...})`. The app reads the *captured* schema to render a
// slider/toggle/dropdown panel (the "Customizer"), and feeds the user's tweaks
// back in as *overrides* on the next run. The author writes ordinary code that
// reads the resolved values:
//
//   const p = api.params({
//     width:   { type: 'number',  default: 30, min: 10, max: 120, step: 1, unit: 'mm' },
//     rows:    { type: 'int',     default: 2,  min: 1,  max: 6 },
//     rounded: { type: 'boolean', default: true },
//     style:   { type: 'select',  default: 'flat', options: ['flat', 'beveled', 'round'] },
//     label:   { type: 'text',    default: 'PARTS', maxLength: 12 },
//     accent:  { type: 'color',   default: '#3b82f6' },
//   });
//   // p.width, p.rows, p.rounded, p.style, p.label, p.accent
//
// This module is intentionally dependency-free (no DOM, no WASM) so it can be
// unit-tested in the fast vitest tier and reused by both the sandbox (capture +
// resolve) and the UI (render the captured schema).

export type ParamType = 'number' | 'int' | 'boolean' | 'select' | 'text' | 'color';

export interface ParamOption {
  value: string;
  label: string;
}

/** Resolved parameter value handed back to model code and persisted per version. */
export type ParamValue = number | boolean | string;
export type ParamValues = Record<string, ParamValue>;

/** Normalized, UI-ready, JSON-serializable spec — one per declared key, in
 *  declaration order. This is what crosses the worker boundary and what the
 *  Customizer panel renders. */
export interface ParamSpec {
  key: string;
  type: ParamType;
  default: ParamValue;
  label: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: ParamOption[];
  maxLength?: number;
}

const PARAM_TYPES: ReadonlySet<string> = new Set<ParamType>(['number', 'int', 'boolean', 'select', 'text', 'color']);

// Allowed spec keys per type — anything else is an author typo we want to flag
// (matches the house "unknown keys rejected" validation style).
const COMMON_KEYS = ['type', 'default', 'label', 'help'];
const ALLOWED_KEYS: Record<ParamType, string[]> = {
  number:  [...COMMON_KEYS, 'min', 'max', 'step', 'unit'],
  int:     [...COMMON_KEYS, 'min', 'max', 'step', 'unit'],
  boolean: [...COMMON_KEYS],
  select:  [...COMMON_KEYS, 'options'],
  text:    [...COMMON_KEYS, 'maxLength'],
  color:   [...COMMON_KEYS],
};

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;

function fail(msg: string): never {
  throw new Error(`api.params: ${msg}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Expand `#abc` → `#aabbcc`; pass through valid `#rrggbb`; return null otherwise. */
export function normalizeHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (HEX6.test(s)) return s.toLowerCase();
  if (HEX3.test(s)) {
    return ('#' + s.slice(1).split('').map(c => c + c).join('')).toLowerCase();
  }
  return null;
}

function normalizeOptions(raw: unknown, key: string): ParamOption[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    fail(`"${key}": select requires a non-empty "options" array`);
  }
  const out: ParamOption[] = [];
  const seen = new Set<string>();
  for (const opt of raw) {
    let value: string;
    let label: string;
    if (typeof opt === 'string') {
      value = opt;
      label = opt;
    } else if (isPlainObject(opt) && typeof opt.value === 'string') {
      value = opt.value;
      label = typeof opt.label === 'string' && opt.label.length > 0 ? opt.label : opt.value;
    } else {
      fail(`"${key}": each option must be a string or { value: string, label?: string }`);
    }
    if (seen.has(value)) fail(`"${key}": duplicate option value "${value}"`);
    seen.add(value);
    out.push({ value, label });
  }
  return out;
}

/** Validate + normalize the author's raw schema object into an ordered array.
 *  Throws a clear `api.params: …` Error on a malformed *schema* (an author bug
 *  worth surfacing); lenient handling of bad *values* lives in
 *  {@link resolveParamValues}. */
export function normalizeParamSchema(raw: unknown): ParamSpec[] {
  if (!isPlainObject(raw)) {
    fail('expected an object mapping parameter names to specs, e.g. { width: { type: "number", default: 10 } }');
  }
  const specs: ParamSpec[] = [];
  for (const key of Object.keys(raw)) {
    const spec = raw[key];
    if (!isPlainObject(spec)) fail(`"${key}": spec must be an object, e.g. { type: "number", default: 10 }`);
    const type = spec.type;
    if (typeof type !== 'string' || !PARAM_TYPES.has(type)) {
      fail(`"${key}": "type" must be one of ${[...PARAM_TYPES].join(', ')}`);
    }
    const t = type as ParamType;

    // Reject unknown spec keys (catches typos like "mn" for "min").
    const allowed = ALLOWED_KEYS[t];
    for (const k of Object.keys(spec)) {
      if (!allowed.includes(k)) fail(`"${key}": unknown field "${k}" for type "${t}" (allowed: ${allowed.join(', ')})`);
    }

    if (!('default' in spec)) fail(`"${key}": missing "default"`);
    const label = typeof spec.label === 'string' && spec.label.length > 0 ? spec.label : key;
    const help = typeof spec.help === 'string' && spec.help.length > 0 ? spec.help : undefined;
    const base = { key, type: t, label, ...(help ? { help } : {}) };

    if (t === 'number' || t === 'int') {
      const def = spec.default;
      if (typeof def !== 'number' || !Number.isFinite(def)) fail(`"${key}": default must be a finite number`);
      const min = spec.min !== undefined ? numField(spec.min, key, 'min') : undefined;
      const max = spec.max !== undefined ? numField(spec.max, key, 'max') : undefined;
      const step = spec.step !== undefined ? numField(spec.step, key, 'step') : undefined;
      if (min !== undefined && max !== undefined && min > max) fail(`"${key}": min (${min}) must be ≤ max (${max})`);
      if (step !== undefined && step <= 0) fail(`"${key}": step must be > 0`);
      // Clamp/round the default into a coherent value rather than throwing — a
      // slightly-off default shouldn't break the whole model.
      let d = clamp(def, min, max);
      if (t === 'int') d = Math.round(d);
      specs.push({ ...base, default: d, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(step !== undefined ? { step } : {}), ...(typeof spec.unit === 'string' ? { unit: spec.unit } : {}) });
    } else if (t === 'boolean') {
      if (typeof spec.default !== 'boolean') fail(`"${key}": default must be true or false`);
      specs.push({ ...base, default: spec.default });
    } else if (t === 'select') {
      const options = normalizeOptions(spec.options, key);
      const def = spec.default;
      if (typeof def !== 'string' || !options.some(o => o.value === def)) {
        fail(`"${key}": default "${String(def)}" must be one of the option values: ${options.map(o => o.value).join(', ')}`);
      }
      specs.push({ ...base, default: def, options });
    } else if (t === 'text') {
      if (typeof spec.default !== 'string') fail(`"${key}": default must be a string`);
      const maxLength = spec.maxLength !== undefined ? numField(spec.maxLength, key, 'maxLength') : undefined;
      if (maxLength !== undefined && (maxLength <= 0 || !Number.isInteger(maxLength))) fail(`"${key}": maxLength must be a positive integer`);
      const d = maxLength !== undefined ? spec.default.slice(0, maxLength) : spec.default;
      specs.push({ ...base, default: d, ...(maxLength !== undefined ? { maxLength } : {}) });
    } else {
      // color
      const hex = normalizeHexColor(spec.default);
      if (!hex) fail(`"${key}": default must be a hex color like "#3b82f6"`);
      specs.push({ ...base, default: hex });
    }
  }
  return specs;
}

function numField(v: unknown, key: string, field: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`"${key}": "${field}" must be a finite number`);
  return v;
}

function clamp(v: number, min?: number, max?: number): number {
  if (min !== undefined && v < min) return min;
  if (max !== undefined && v > max) return max;
  return v;
}

/** Coerce one override value against its spec, or return undefined if the value
 *  can't be made valid (caller falls back to the default). Lenient by design:
 *  overrides come from persisted UI state / tool calls, not author code, so a
 *  stale or out-of-range value should degrade to the default, never throw. */
export function coerceParamValue(spec: ParamSpec, value: unknown): ParamValue | undefined {
  switch (spec.type) {
    case 'number':
    case 'int': {
      const n = typeof value === 'number' ? value : (typeof value === 'string' ? Number(value) : NaN);
      if (!Number.isFinite(n)) return undefined;
      let c = clamp(n, spec.min, spec.max);
      if (spec.type === 'int') c = Math.round(c);
      return c;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'select':
      return typeof value === 'string' && spec.options?.some(o => o.value === value) ? value : undefined;
    case 'text':
      if (typeof value !== 'string') return undefined;
      return spec.maxLength !== undefined ? value.slice(0, spec.maxLength) : value;
    case 'color':
      return normalizeHexColor(value) ?? undefined;
  }
}

/** Resolve the values handed to model code: each parameter takes a valid
 *  override if present, otherwise its default. */
export function resolveParamValues(schema: ParamSpec[], overrides?: Record<string, unknown>): ParamValues {
  const out: ParamValues = {};
  for (const spec of schema) {
    const override = overrides ? overrides[spec.key] : undefined;
    const coerced = override !== undefined ? coerceParamValue(spec, override) : undefined;
    out[spec.key] = coerced !== undefined ? coerced : spec.default;
  }
  return out;
}

// Property gets that must pass through the guard untouched so serialization,
// thenable checks, and spread/inspection of the values object keep working.
const PARAM_PASSTHROUGH = new Set(['toJSON', 'then', 'constructor']);

/** Wrap the resolved values handed to *model code* so reading an undeclared key
 *  throws a clear error instead of silently returning `undefined` (which then
 *  propagates into geometry as `NaN`). A consumer-side typo (`p.widht`) is one
 *  of the easiest customizer footguns; this turns it into an actionable error.
 *  Symbol access, `JSON.stringify`, spread, and destructuring of *declared*
 *  keys all behave normally — only an unknown string-property get throws. */
export function protectParamValues(values: ParamValues): ParamValues {
  return new Proxy(values, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && !(prop in target) && !PARAM_PASSTHROUGH.has(prop)) {
        const keys = Object.keys(target);
        throw new Error(`api.params: no parameter "${prop}". Declared: ${keys.length ? keys.join(', ') : '(none)'}. Check for a typo where you read the value.`);
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/** Merge schemas captured across multiple `api.params(...)` calls in one run.
 *  De-dupes by key (last definition wins) while preserving first-seen order, so
 *  the common single-call case is identity and split declarations still work. */
export function mergeParamSchemas(schemas: ParamSpec[][]): ParamSpec[] {
  const order: string[] = [];
  const byKey = new Map<string, ParamSpec>();
  for (const schema of schemas) {
    for (const spec of schema) {
      if (!byKey.has(spec.key)) order.push(spec.key);
      byKey.set(spec.key, spec);
    }
  }
  return order.map(k => byKey.get(k)!);
}

/** Keep only override entries whose key exists in the schema (drops stale keys
 *  from persisted state) and coerce them. Used when persisting a clean override
 *  set alongside a version. */
export function pruneParamValues(schema: ParamSpec[], overrides?: Record<string, unknown>): ParamValues {
  const out: ParamValues = {};
  if (!overrides) return out;
  for (const spec of schema) {
    if (!(spec.key in overrides)) continue;
    const coerced = coerceParamValue(spec, overrides[spec.key]);
    if (coerced !== undefined && coerced !== spec.default) out[spec.key] = coerced;
  }
  return out;
}
