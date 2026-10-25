// Unit tests for saved Custom endpoints' pure half (src/ai/endpointProfiles.ts).

import { describe, expect, test } from 'vitest';

import {
  findEndpointForUrl,
  mergeBackup,
  newEndpoint,
  normalizeBaseUrl,
  parseBackup,
  seedEndpoint,
  serializeBackup,
  type SavedEndpoint,
} from '../../src/ai/endpointProfiles';

function ep(id: string, baseUrl: string, extra: Partial<SavedEndpoint> = {}): SavedEndpoint {
  return { ...newEndpoint('openai-compatible', id, 1), baseUrl, ...extra };
}

describe('saved endpoints', () => {
  test('URL matching ignores trailing slashes and host case', () => {
    expect(normalizeBaseUrl(' HTTP://LocalHost:8317/v1/ ')).toBe('http://localhost:8317/v1');
    const list = [ep('a', 'http://localhost:8317/v1'), ep('b', 'https://x.test/v1')];
    expect(findEndpointForUrl(list, 'http://localhost:8317/v1/')?.id).toBe('a');
    expect(findEndpointForUrl(list, 'https://nope.test/v1')).toBeNull();
    expect(findEndpointForUrl(list, '')).toBeNull();
  });

  test('ties prefer the matching key, then the newest', () => {
    const list = [ep('a', 'https://x.test/v1', { apiKey: 'k1', updatedAt: 5 }), ep('b', 'https://x.test/v1', { apiKey: 'k2', updatedAt: 9 })];
    expect(findEndpointForUrl(list, 'https://x.test/v1')?.id).toBe('b');
    expect(findEndpointForUrl(list, 'https://x.test/v1', 'k1')?.id).toBe('a');
  });

  test('a new CLIProxyAPI endpoint gets a generated key that it keeps', () => {
    const e = newEndpoint('cliproxyapi', 'id');
    expect(e.baseUrl).toBe('http://localhost:8317/v1');
    expect(e.apiKey).toMatch(/^pw-[0-9a-f]{48}$/);
  });

  test('seeding carries a working single-endpoint config over untouched', () => {
    const bridge = seedEndpoint({ baseUrl: 'http://localhost:8317/v1', apiKey: 'pw-existing', model: 'claude-opus-5-5', models: ['claude-opus-5-5'], reasoningEffort: false }, 'id');
    expect(bridge).toMatchObject({ kind: 'cliproxyapi', apiKey: 'pw-existing', model: 'claude-opus-5-5', reasoningEffort: false });
    const other = seedEndpoint({ baseUrl: 'https://vllm.corp.test/v1', apiKey: '', model: 'llama', models: [], reasoningEffort: false }, 'id');
    expect(other).toMatchObject({ kind: 'openai-compatible', name: 'vllm.corp.test', apiKey: '' });
  });

  test('backups round-trip, drop junk, and merge newest-wins', () => {
    const a = ep('a', 'https://x.test/v1', { apiKey: 'k', updatedAt: 10 });
    const parsed = parseBackup(serializeBackup([a, { id: '', baseUrl: '' } as SavedEndpoint]));
    expect(parsed).toEqual([a]);
    expect(() => parseBackup('{"format":"other"}')).toThrow(/Not a Partwright endpoints backup/);
    expect(() => parseBackup('nope')).toThrow(/Not a JSON file/);

    const older = { ...a, apiKey: 'old', updatedAt: 5 };
    const b = ep('b', 'https://y.test/v1');
    const merged = mergeBackup([a], [older, b]);
    expect(merged.changed).toBe(1);
    expect(merged.list.find(e => e.id === 'a')?.apiKey).toBe('k');
    expect(merged.list.map(e => e.id).sort()).toEqual(['a', 'b']);
  });
});
