// Unit tests for the CLIProxyAPI helpers (src/ai/cliProxy.ts) — including
// running the generated awk scripts against sample bridge configs, since the
// whole point of the "add key" command is that it appends instead of
// replacing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  APPEND_KEY_AWK,
  LIST_KEYS_AWK,
  addKeyCommand,
  bridgeErrorHint,
  classifyBridgeError,
  diagnoseBridgeModels,
  generateApiKey,
  isCommandSafeKey,
  listKeysCommand,
  loginCommand,
  pickDefaultModel,
} from '../../src/ai/cliProxy';

const TEMPLATE = `port: 8317
# API keys for authentication
api-keys:
  - "your-api-key-1"
  - "your-api-key-2"

# Enable debug logging
debug: false
`;

function awk(program: string, input: string, key?: string): string {
  const args = key ? ['-v', `k=${key}`, program] : [program];
  return execFileSync('awk', args, { input, encoding: 'utf8' });
}

describe('append-key awk', () => {
  test('replaces the template placeholders with the key on first run', () => {
    expect(awk(APPEND_KEY_AWK, TEMPLATE, 'pw-a')).toBe(`port: 8317
# API keys for authentication
api-keys:
  - "pw-a"

# Enable debug logging
debug: false
`);
  });

  test('appends a second key and keeps the first (another browser stays connected)', () => {
    const once = awk(APPEND_KEY_AWK, TEMPLATE, 'pw-a');
    const twice = awk(APPEND_KEY_AWK, once, 'pw-b');
    expect(twice).toContain('  - "pw-a"\n  - "pw-b"\n');
    expect(awk(LIST_KEYS_AWK, twice).trim().split('\n')).toEqual(['pw-a', 'pw-b']);
  });

  test('matches unindented lists, fills `[]`, and adds a missing section', () => {
    expect(awk(APPEND_KEY_AWK, 'api-keys:\n- "old"\nx: 1\n', 'k')).toBe('api-keys:\n- "old"\n- "k"\nx: 1\n');
    expect(awk(APPEND_KEY_AWK, 'api-keys: []\nx: 1\n', 'k')).toBe('api-keys:\n  - "k"\nx: 1\n');
    expect(awk(APPEND_KEY_AWK, 'port: 1\n', 'k')).toBe('port: 1\napi-keys:\n  - "k"\n');
  });

  test('the full command is idempotent and leaves other keys alone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cliproxy-'));
    const cfg = join(dir, 'config.yaml');
    writeFileSync(cfg, TEMPLATE);
    const run = (key: string) => execFileSync('sh', ['-c', addKeyCommand(key, 'other', cfg)!], { encoding: 'utf8' });
    expect(run('pw-a')).toContain('Added the key');
    expect(run('pw-b')).toContain('Added the key');
    expect(run('pw-a')).toContain('Key already in');
    const listed = execFileSync('sh', ['-c', listKeysCommand('other', cfg)!], { encoding: 'utf8' });
    expect(listed.trim().split('\n')).toEqual(['pw-a', 'pw-b']);
    expect(readFileSync(cfg, 'utf8')).not.toContain('your-api-key');
  });
});

describe('commands', () => {
  test('macOS uses the Homebrew config and restarts the service', () => {
    const cmd = addKeyCommand('pw-abc', 'mac')!;
    expect(cmd).toContain('CFG="$(brew --prefix)/etc/cliproxyapi.conf"');
    expect(cmd).toContain("KEY='pw-abc'");
    expect(cmd).toMatch(/brew services restart cliproxyapi$/);
  });

  test('Windows and unsafe keys fall back to manual instructions', () => {
    expect(addKeyCommand('pw-abc', 'windows')).toBeNull();
    expect(addKeyCommand("it's", 'mac')).toBeNull();
    expect(isCommandSafeKey(generateApiKey())).toBe(true);
    expect(isCommandSafeKey('sk-proj_ABC.def/+=')).toBe(true);
    expect(isCommandSafeKey('a b')).toBe(false);
  });

  test('a typed config path is single-quoted', () => {
    expect(listKeysCommand('other', "/srv/it's/config.yaml")).toContain(`'/srv/it'\\''s/config.yaml'`);
  });

  test('login flag follows the model family', () => {
    expect(loginCommand('claude-opus-5-5', 'mac')).toBe('cliproxyapi --claude-login');
    expect(loginCommand('gpt-5.5-codex', 'windows')).toBe('cli-proxy-api --codex-login');
    expect(loginCommand('gemini-3-pro', 'other')).toBe('cli-proxy-api --login');
    expect(loginCommand('', 'mac')).toBe('cliproxyapi --claude-login');
  });
});

describe('auth-loss detection', () => {
  test('classifies bridge-key vs subscription-auth', () => {
    expect(classifyBridgeError('OpenAI 401: {"error":"Invalid API key"}')).toBe('bridge-key');
    expect(classifyBridgeError('OpenAI 500: {"error":{"message":"auth_not_found: no auth available"}}')).toBe('subscription-auth');
    expect(classifyBridgeError('OpenAI 502: unknown provider for model claude-opus-5-5')).toBe('subscription-auth');
    expect(classifyBridgeError('OpenAI 401: {"type":"error","error":{"type":"authentication_error","message":"OAuth token has expired."}}')).toBe('subscription-auth');
    expect(classifyBridgeError('OpenAI 400: context length exceeded')).toBeNull();
  });

  test('hints are confident for a bridge, hedged elsewhere', () => {
    const local = bridgeErrorHint('auth_unavailable', 'http://localhost:8317/v1', 'claude-sonnet-5-5', 'mac')!;
    expect(local).toMatch(/^This looks like your CLIProxyAPI bridge lost its Claude/);
    expect(local).toContain('cliproxyapi --claude-login');
    const remote = bridgeErrorHint('OAuth token has expired', 'https://gw.example.com/v1', 'gpt-5.5', 'other')!;
    expect(remote).toMatch(/^If this endpoint is a CLIProxyAPI bridge/);
    expect(remote).toContain('--codex-login');
    // Another server's bad-key error already says what to fix.
    expect(bridgeErrorHint('401: Invalid API key', 'https://api.example.com/v1', 'm')).toBeNull();
    expect(bridgeErrorHint('401: Invalid API key', 'http://127.0.0.1:8317/v1', 'm')).toContain('step 2');
  });

  test('an empty or family-less model list means a missing login', () => {
    expect(diagnoseBridgeModels([], '', 'mac')?.command).toBe('cliproxyapi --claude-login');
    expect(diagnoseBridgeModels(['gpt-5.5'], 'claude-opus-5-5', 'mac')?.text).toContain('no Claude models');
    expect(diagnoseBridgeModels(['claude-opus-5-5'], 'claude-opus-5-5', 'mac')).toBeNull();
    expect(diagnoseBridgeModels(['gpt-5.5'], '', 'mac')).toBeNull();
  });

  test('default model prefers the newest Opus', () => {
    expect(pickDefaultModel(['claude-haiku-5-5', 'claude-opus-5-1', 'claude-opus-5-5', 'gpt-5.5'])).toBe('claude-opus-5-5');
    expect(pickDefaultModel(['gpt-5.5', 'claude-sonnet-5-5'])).toBe('claude-sonnet-5-5');
    expect(pickDefaultModel(['only'])).toBe('only');
    expect(pickDefaultModel([])).toBe('');
  });
});
