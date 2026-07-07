import { describe, it, expect } from 'vitest';
import { backupFilename, sessionIdFromBackupFilename } from '../../src/sync/syncTypes';

describe('backupFilename', () => {
  it('combines slug and session id into a stable, readable name', () => {
    expect(backupFilename('my_widget', 'a1b2c3')).toBe('my_widget__a1b2c3.partwright.json');
  });

  it('falls back to "session" for an empty slug', () => {
    expect(backupFilename('', 'xyz')).toBe('session__xyz.partwright.json');
  });

  it('round-trips: the session id is recoverable from the filename', () => {
    const id = 'sess-123';
    const name = backupFilename('cool-part', id);
    expect(sessionIdFromBackupFilename(name)).toBe(id);
  });
});

describe('sessionIdFromBackupFilename', () => {
  it('extracts the id after the __ separator', () => {
    expect(sessionIdFromBackupFilename('gizmo__deadbeef.partwright.json')).toBe('deadbeef');
  });

  it('returns null for names that do not match the backup pattern', () => {
    expect(sessionIdFromBackupFilename('gizmo.partwright.json')).toBeNull();
    expect(sessionIdFromBackupFilename('random.json')).toBeNull();
    expect(sessionIdFromBackupFilename('no-extension')).toBeNull();
  });

  it('is not confused by underscores inside the slug portion', () => {
    // Only the final `__<id>` before the extension is the session id.
    const name = backupFilename('a_b_c_widget', 'ID9');
    expect(sessionIdFromBackupFilename(name)).toBe('ID9');
  });
});
