import { describe, it, expect } from 'vitest';
import {
  SLASH_COMMANDS,
  parseSlashCommand,
  resolveSlashCommand,
  matchSlashCommands,
  slashMenuPrefix,
} from '../../src/ai/slashCommands';

describe('resolveSlashCommand', () => {
  it('resolves canonical names case-insensitively', () => {
    expect(resolveSlashCommand('compact')).toBe('compact');
    expect(resolveSlashCommand('CLEAR')).toBe('clear');
    expect(resolveSlashCommand('Help')).toBe('help');
  });

  it('resolves aliases to their canonical name', () => {
    expect(resolveSlashCommand('settings')).toBe('models');
    expect(resolveSlashCommand('model')).toBe('models');
    expect(resolveSlashCommand('commands')).toBe('help');
  });

  it('returns null for unknown tokens', () => {
    expect(resolveSlashCommand('flush')).toBeNull();
    expect(resolveSlashCommand('')).toBeNull();
  });
});

describe('parseSlashCommand', () => {
  it('parses a bare command with surrounding whitespace', () => {
    expect(parseSlashCommand('/clear')).toEqual({ name: 'clear', token: 'clear' });
    expect(parseSlashCommand('  /compact  ')).toEqual({ name: 'compact', token: 'compact' });
    expect(parseSlashCommand('/CLEAR')).toEqual({ name: 'clear', token: 'clear' });
  });

  it('resolves an alias to its canonical name while keeping the typed token', () => {
    expect(parseSlashCommand('/settings')).toEqual({ name: 'models', token: 'settings' });
  });

  it('returns a result with name=null for an unknown bare command', () => {
    // Unknown commands still parse so the panel can warn instead of sending
    // "/flush" to the model.
    expect(parseSlashCommand('/flush')).toEqual({ name: null, token: 'flush' });
  });

  it('does NOT treat ordinary messages as commands', () => {
    expect(parseSlashCommand('clear the chat please')).toBeNull(); // no leading slash
    expect(parseSlashCommand('/clear the chat')).toBeNull();        // command + args → message
    expect(parseSlashCommand('/usr/bin/env node')).toBeNull();      // a path, not a command
    expect(parseSlashCommand('/')).toBeNull();                      // lone slash
    expect(parseSlashCommand('//')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('please /clear')).toBeNull();          // slash not leading
  });
});

describe('matchSlashCommands', () => {
  it('returns every command for an empty prefix', () => {
    expect(matchSlashCommands('')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('filters by canonical-name prefix', () => {
    // 'c' also matches /help via its 'commands' alias.
    expect(matchSlashCommands('c').map(c => c.name)).toEqual(['compact', 'clear', 'help']);
    expect(matchSlashCommands('cl').map(c => c.name)).toEqual(['clear']);
    expect(matchSlashCommands('comp').map(c => c.name)).toEqual(['compact']);
  });

  it('matches on alias prefixes too', () => {
    // "set" only starts the alias "settings", which maps to /models.
    expect(matchSlashCommands('set').map(c => c.name)).toEqual(['models']);
  });

  it('returns nothing for a prefix that matches no command', () => {
    expect(matchSlashCommands('zzz')).toEqual([]);
  });
});

describe('slashMenuPrefix', () => {
  it('returns the partial token while the command is still being typed', () => {
    expect(slashMenuPrefix('/')).toBe('');
    expect(slashMenuPrefix('/cl')).toBe('cl');
    expect(slashMenuPrefix('/CLEAR')).toBe('clear');
  });

  it('returns null once the menu should close', () => {
    expect(slashMenuPrefix('/clear ')).toBeNull(); // trailing space → token complete
    expect(slashMenuPrefix('/clear the chat')).toBeNull();
    expect(slashMenuPrefix('hello')).toBeNull(); // not a slash token
    expect(slashMenuPrefix(' /clear')).toBeNull(); // leading space → not a leading token
    expect(slashMenuPrefix('')).toBeNull();
  });
});
