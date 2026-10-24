// getDiagnosticLog read path (src/diagnostics/logQuery.ts): filtering,
// capping, and — most importantly — secret redaction, since log text can echo
// request URLs, auth headers, or pasted API keys.

import { describe, it, expect } from 'vitest';
import { redactSecrets, queryDiagnosticLog, REDACTED, registerKnownSecret, forgetKnownSecret, LOG_SOURCES, LOG_LEVELS } from '../../src/diagnostics/logQuery';
import type { LogEntry } from '../../src/diagnostics/errorLog';

// Fake credentials, assembled at runtime so the CI secret scanner (gitleaks)
// never sees a key-shaped literal in the source.
const FAKE = {
  anthropic: ['sk', 'ant', 'api03', 'abcdefghijklmnopqrstuvwxyz'].join('-'),
  openai: ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz012345'].join('-'),
  google: 'AIza' + 'SyA1234567890abcdefghijklmnopqrstu',
  github: 'ghp' + '_abcdefghijklmnopqrstuvwxyz0123',
  slack: ['xoxb', '1234567890', 'abcdefghij'].join('-'),
  aws: 'AKIA' + 'ABCDEFGHIJKLMNOP',
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'].join('.'),
};

describe('redactSecrets', () => {
  it('redacts credential query parameters but keeps the rest of the URL', () => {
    const s = redactSecrets(`POST https://generativelanguage.googleapis.com/v1beta/models/x:streamGenerateContent?alt=sse&key=${FAKE.google} failed`);
    expect(s).toContain('alt=sse');
    expect(s).toContain(`key=${REDACTED}`);
    expect(s).not.toContain('AIzaSy');
    expect(redactSecrets('https://x.test/a?access_token=abc.def&page=2')).toBe(`https://x.test/a?access_token=${REDACTED}&page=2`);
  });

  it('redacts Authorization / x-api-key headers', () => {
    expect(redactSecrets('Authorization: Bearer abcdefghijklmnop')).not.toMatch(/abcdefghijklmnop/);
    expect(redactSecrets('authorization=Basic dXNlcjpwYXNz')).not.toMatch(/dXNlcjpwYXNz/);
    expect(redactSecrets('x-api-key: my-secret-value, other: 1')).toBe(`x-api-key: ${REDACTED}, other: 1`);
  });

  it('redacts JSON credential fields', () => {
    const s = redactSecrets('{"apiKey":"abc123secret","model":"m"}');
    expect(s).toBe(`{"apiKey":"${REDACTED}","model":"m"}`);
    expect(redactSecrets(`{'authorization': 'Bearer zzzzzzzzzz'}`)).not.toMatch(/zzzzzzzzzz/);
  });

  it('redacts well-known key formats anywhere', () => {
    for (const secret of [
      ...Object.values(FAKE),
    ]) {
      const out = redactSecrets(`error: invalid key ${secret} rejected`);
      expect(out, secret).not.toContain(secret);
      expect(out).toContain('rejected');
    }
  });

  it('redacts a credential parameter at the very start of the text', () => {
    const v = ['abc123', 'secret', 'value'].join('');
    expect(redactSecrets('key=' + v + '&alt=sse')).toBe(`key=${REDACTED}&alt=sse`);
    expect(redactSecrets('monkey=banana')).toBe('monkey=banana');
  });

  it('redacts URL userinfo', () => {
    const pass = ['hunter', '2', 'pass'].join('');
    const out = redactSecrets(`fetch https://alice:${pass}@models.example.test/a.stl failed`);
    expect(out).not.toContain(pass);
    expect(out).toContain(`https://${REDACTED}@models.example.test/a.stl`);
  });

  it('catches key formats glued to URL-encoded text', () => {
    const out = redactSecrets(`url=https%3A%2F%2Fx.test%2F%3Fkey%3D${FAKE.google}%26alt%3Dsse`);
    expect(out).not.toContain(FAKE.google);
    const out2 = redactSecrets(`q%3D${FAKE.openai}`);
    expect(out2).not.toContain(FAKE.openai);
    // ...but ordinary hyphenated words that merely contain "sk-" survive.
    const word = 'task-abcdefghijklmnopqrstuvwxyz';
    expect(redactSecrets(word)).toBe(word);
  });

  it('redacts JSON values containing escaped quotes, and stringified JSON', () => {
    const tail = ['ab', 'c\\"d', 'ef'].join('');
    const out = redactSecrets(`{"apiKey":"${tail}","model":"m"}`);
    expect(out).toBe(`{"apiKey":"${REDACTED}","model":"m"}`);
    const inner = ['zz', 'top', 'secret'].join('');
    const out2 = redactSecrets(`body: "{\\"apiKey\\":\\"${inner}\\",\\"n\\":1}"`);
    expect(out2).not.toContain(inner);
  });

  it("redacts the app's known secrets verbatim and URL-encoded, whatever their shape", () => {
    const custom = ['my', 'local', 'llama', 'key', '42!'].join('-');
    expect(redactSecrets(`custom endpoint rejected ${custom}`)).toContain(custom);
    registerKnownSecret(custom);
    expect(redactSecrets(`custom endpoint rejected ${custom}`)).toBe(`custom endpoint rejected ${REDACTED}`);
    expect(redactSecrets(`?k=${encodeURIComponent(custom)}`)).not.toContain(encodeURIComponent(custom));
    forgetKnownSecret(custom);
    expect(redactSecrets(custom)).toBe(custom);
    registerKnownSecret('short');
    expect(redactSecrets('short circuit')).toBe('short circuit');
  });

  it('redacts a saved key that contains another saved key in full', () => {
    const shorter = ['abcd', 'efgh'].join('');
    const longer = shorter + ['1234', '5678', 'XYZ'].join('');
    registerKnownSecret(shorter);
    registerKnownSecret(longer);
    expect(redactSecrets(`leak ${longer}`)).toBe(`leak ${REDACTED}`);
    forgetKnownSecret(shorter);
    forgetKnownSecret(longer);
  });

  it('redacts a bare token used as URL userinfo', () => {
    const token = ['tok', 'abcdefghijklmnop'].join('_');
    expect(redactSecrets(`GET https://${token}@llm.local/v1`)).toBe(`GET https://${REDACTED}@llm.local/v1`);
    expect(redactSecrets('mailto://bob@example.com')).toBe('mailto://bob@example.com');
  });

  it('leaves ordinary diagnostic text alone', () => {
    const plain = 'Engine: Manifold.ofMesh failed — not manifold (maxTokens=4096, tokens: n/a)';
    expect(redactSecrets(plain)).toBe(plain);
    expect(redactSecrets('')).toBe('');
  });
});

describe('queryDiagnosticLog', () => {
  const mk = (i: number, level: LogEntry['level'], source: LogEntry['source'], message: string, detail?: string): LogEntry =>
    ({ id: `e${i}`, timestamp: Date.UTC(2026, 0, 1, 0, 0, i), level, source, message, ...(detail ? { detail } : {}) });
  // Newest first, as the store keeps them.
  const entries: LogEntry[] = [
    mk(5, 'error', 'ai', 'Provider 401 for https://api.test/v1?key=SECRETKEY123'),
    mk(4, 'info', 'export', 'Exported model.stl'),
    mk(3, 'warn', 'engine', 'Mesh not manifold', 'at foo (Authorization: Bearer tok_abcdefgh123)'),
    mk(2, 'error', 'engine', 'Code must return a Manifold'),
    mk(1, 'info', 'app', 'Saved v3'),
  ];

  it('filters by level and source (single or list) and caps newest-first', () => {
    expect(queryDiagnosticLog(entries, { level: 'error', limit: 10 }).entries.map(e => e.id)).toEqual(['e5', 'e2']);
    expect(queryDiagnosticLog(entries, { source: ['engine'], limit: 10 }).entries.map(e => e.id)).toEqual(['e3', 'e2']);
    expect(queryDiagnosticLog(entries, { level: ['error', 'warn'], source: 'engine', limit: 1 })).toMatchObject({ matched: 2, total: 5 });
    expect(queryDiagnosticLog(entries, { limit: 2 }).entries.map(e => e.id)).toEqual(['e5', 'e4']);
  });

  it('redacts message and detail, and emits ISO times', () => {
    const r = queryDiagnosticLog(entries, { limit: 5 });
    expect(r.entries[0].message).not.toContain('SECRETKEY123');
    expect(r.entries[2].detail).not.toContain('tok_abcdefgh123');
    expect(r.entries[0].time).toBe('2026-01-01T00:00:05.000Z');
    expect('detail' in r.entries[1]).toBe(false);
  });
});

describe('log level/source lists', () => {
  it('cover the ErrorLevel / ErrorSource unions', () => {
    expect([...LOG_LEVELS]).toEqual(['error', 'warn', 'info']);
    expect(LOG_SOURCES).toContain('uncaught');
    expect(LOG_SOURCES).toHaveLength(12);
  });
});
