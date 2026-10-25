// getAppConfig / setAppConfig validation (src/config/appConfigBounds.ts):
// the API must accept exactly what the Advanced Settings modal accepts. The
// drift guard re-parses the modal's JSX so a new/changed <Field> that isn't
// mirrored in APP_CONFIG_FIELD_BOUNDS fails here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_CONFIG_FIELD_BOUNDS,
  AI_WRITABLE_CONFIG_KEYS,
  validateAppConfigValue,
  withConfigValue,
  describeAppConfig,
  type ConfigFieldBounds,
} from '../../src/config/appConfigBounds';
import { APP_CONFIG_DEFAULTS } from '../../src/config/appConfig';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODAL = resolve(__dirname, '../../src/ui/advancedSettingsModal.tsx');

function parseModalFields(): Map<string, ConfigFieldBounds> {
  const src = readFileSync(MODAL, 'utf8');
  const out = new Map<string, ConfigFieldBounds>();
  for (const m of src.matchAll(/<(Field|ToggleField)\b([\s\S]*?)\/>/g)) {
    const [, kind, body] = m;
    const v = /value=\{c\.(\w+)\.(\w+)\}/.exec(body);
    if (!v) continue;
    const id = `${v[1]}.${v[2]}`;
    if (kind === 'ToggleField') { out.set(id, { boolean: true }); continue; }
    const num = (re: RegExp) => { const r = re.exec(body); return r ? Number(r[1].replace(/_/g, '')) : NaN; };
    out.set(id, {
      min: num(/\bmin=\{([^}]*)\}/),
      max: num(/\bmax=\{([^}]*)\}/),
      ...(/\binteger\b/.test(body) ? { integer: true } : {}),
    });
  }
  return out;
}

function tableEntries(): Map<string, ConfigFieldBounds> {
  const out = new Map<string, ConfigFieldBounds>();
  for (const [s, rows] of Object.entries(APP_CONFIG_FIELD_BOUNDS)) {
    for (const [k, b] of Object.entries(rows as Record<string, ConfigFieldBounds>)) out.set(`${s}.${k}`, b);
  }
  return out;
}

describe('APP_CONFIG_FIELD_BOUNDS mirrors the Advanced Settings modal', () => {
  const modal = parseModalFields();
  const table = tableEntries();

  it('parses a sane number of modal fields', () => {
    expect(modal.size).toBeGreaterThan(100);
  });

  it('has exactly the modal\'s fields with the same bounds', () => {
    const drift: string[] = [];
    for (const [id, b] of modal) {
      const t = table.get(id);
      if (!t) { drift.push(`${id}: in the modal, missing from APP_CONFIG_FIELD_BOUNDS`); continue; }
      if (JSON.stringify(t) !== JSON.stringify(b)) drift.push(`${id}: modal ${JSON.stringify(b)} vs table ${JSON.stringify(t)}`);
    }
    for (const id of table.keys()) if (!modal.has(id)) drift.push(`${id}: in APP_CONFIG_FIELD_BOUNDS, not in the modal`);
    expect(drift, drift.join('\n')).toHaveLength(0);
  });

  it('every bounded key exists in the defaults with the matching type', () => {
    for (const [id, b] of table) {
      const [s, k] = id.split('.');
      const d = (APP_CONFIG_DEFAULTS as unknown as Record<string, Record<string, unknown>>)[s][k];
      expect(typeof d, id).toBe('boolean' in b ? 'boolean' : 'number');
    }
  });

  it('the AI allow-list is a subset of settable keys and excludes the ai section', () => {
    for (const id of AI_WRITABLE_CONFIG_KEYS) {
      expect(table.has(id), id).toBe(true);
      expect(id.startsWith('ai.'), id).toBe(false);
    }
  });
});

describe('validateAppConfigValue', () => {
  it('accepts an in-range value', () => {
    expect(validateAppConfigValue('ui', 'defaultQuality', 64)).toEqual({ ok: true, section: 'ui', key: 'defaultQuality', value: 64 });
  });

  it('rejects out-of-range, non-integer, wrong-type and coerced values', () => {
    expect(validateAppConfigValue('ui', 'defaultQuality', 2).ok).toBe(false);
    expect(validateAppConfigValue('ui', 'defaultQuality', 5000).ok).toBe(false);
    expect(validateAppConfigValue('ui', 'defaultQuality', 32.5).ok).toBe(false);
    expect(validateAppConfigValue('ui', 'defaultQuality', '64').ok).toBe(false);
    expect(validateAppConfigValue('ui', 'defaultQuality', Number.NaN).ok).toBe(false);
    expect(validateAppConfigValue('ui', 'editorHintsEnabled', 1).ok).toBe(false);
    expect(validateAppConfigValue('ui', 'editorHintsEnabled', false).ok).toBe(true);
  });

  it('accepts non-integer values for float fields', () => {
    expect(validateAppConfigValue('renderer', 'sdfPreviewScale', 3.5).ok).toBe(true);
  });

  it('rejects unknown sections, unknown keys and internal (modal-less) keys', () => {
    const badSection = validateAppConfigValue('nope', 'x', 1);
    expect(badSection.ok).toBe(false);
    const unknown = validateAppConfigValue('ui', 'doesNotExist', 1);
    expect(unknown.ok === false && unknown.error).toMatch(/unknown setting/);
    const internal = validateAppConfigValue('renderer', 'sdfCompileChunkNodes', 100);
    expect(internal.ok === false && internal.error).toMatch(/internal setting/);
    expect(validateAppConfigValue('ui', 'toString', 1).ok).toBe(false);
  });
});

describe('withConfigValue / describeAppConfig', () => {
  it('returns a copy without mutating the source', () => {
    const next = withConfigValue(APP_CONFIG_DEFAULTS, 'ui', 'defaultQuality', 32);
    expect(next.ui.defaultQuality).toBe(32);
    expect(APP_CONFIG_DEFAULTS.ui.defaultQuality).not.toBe(32);
    expect(next.renderer).not.toBe(APP_CONFIG_DEFAULTS.renderer);
  });

  it('describes value/default/bounds and flags modified keys', () => {
    const d = describeAppConfig(withConfigValue(APP_CONFIG_DEFAULTS, 'ui', 'defaultQuality', 32));
    expect(d.ui.defaultQuality).toMatchObject({ value: 32, default: APP_CONFIG_DEFAULTS.ui.defaultQuality, min: 3, max: 4096, integer: true, modified: true });
    expect(d.ui.editorHintsEnabled).toEqual({ value: APP_CONFIG_DEFAULTS.ui.editorHintsEnabled, default: APP_CONFIG_DEFAULTS.ui.editorHintsEnabled });
    expect(d.renderer.sdfCompileChunkNodes).toBeUndefined();
  });
});
