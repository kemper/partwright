import { describe, it, expect } from 'vitest';
import { isChunkLoadError, chunkRecoveryAction, CHUNK_RELOAD_GUARD_KEY } from '../../src/chunkReload';

describe('isChunkLoadError', () => {
  it('matches the Chrome dynamic-import failure', () => {
    expect(
      isChunkLoadError(
        new Error(
          'Failed to fetch dynamically imported module: https://main.partwright.pages.dev/assets/main-DZLxNqfy.js',
        ),
      ),
    ).toBe(true);
  });

  it('matches the MIME-type module-script rejection (SPA fallback served HTML)', () => {
    expect(
      isChunkLoadError(
        new Error(
          "Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of \"text/html\".",
        ),
      ),
    ).toBe(true);
  });

  it('matches the Firefox and Safari wordings', () => {
    expect(isChunkLoadError(new Error('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('accepts plain strings and error-like objects', () => {
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(true);
    expect(isChunkLoadError({ message: 'wrong MIME type' })).toBe(true);
  });

  it('does not match unrelated runtime errors', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('chunkRecoveryAction', () => {
  const chunkErr = new Error('Failed to fetch dynamically imported module: /assets/main-X.js');
  const runtimeErr = new Error('Cannot read properties of undefined');

  it('reloads once on the first chunk-load failure', () => {
    expect(chunkRecoveryAction(chunkErr, false)).toBe('reload');
  });

  it('stops reloading after a reload was already attempted this session', () => {
    expect(chunkRecoveryAction(chunkErr, true)).toBe('notify');
  });

  it('never auto-reloads on a non-chunk runtime error', () => {
    expect(chunkRecoveryAction(runtimeErr, false)).toBe('notify');
    expect(chunkRecoveryAction(runtimeErr, true)).toBe('notify');
  });
});

describe('CHUNK_RELOAD_GUARD_KEY', () => {
  it('is a stable sessionStorage key', () => {
    expect(CHUNK_RELOAD_GUARD_KEY).toBe('pw:chunkReloadAttempted');
  });
});
