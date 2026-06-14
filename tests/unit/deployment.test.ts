import { describe, it, expect } from 'vitest';
import {
  normalizeBase,
  majorFromBase,
  joinBase,
  routeFromPath,
} from '../../src/deployment';

describe('normalizeBase', () => {
  it('guarantees a single leading + trailing slash', () => {
    expect(normalizeBase('/')).toBe('/');
    expect(normalizeBase('')).toBe('/');
    expect(normalizeBase(undefined)).toBe('/');
    expect(normalizeBase(null)).toBe('/');
    expect(normalizeBase('/v2')).toBe('/v2/');
    expect(normalizeBase('/v2/')).toBe('/v2/');
    expect(normalizeBase('v2')).toBe('/v2/');
  });
});

describe('majorFromBase', () => {
  it('parses /vN/ bases', () => {
    expect(majorFromBase('/v2/')).toBe(2);
    expect(majorFromBase('/v10/')).toBe(10);
    expect(majorFromBase('/v1')).toBe(1);
  });
  it('defaults to 1 for the unversioned root', () => {
    expect(majorFromBase('/')).toBe(1);
    expect(majorFromBase('')).toBe(1);
    expect(majorFromBase('/preview/')).toBe(1);
  });
});

describe('joinBase', () => {
  it('is the identity at the root base', () => {
    expect(joinBase('/', '/editor')).toBe('/editor');
    expect(joinBase('/', 'editor')).toBe('/editor');
    expect(joinBase('/', '/')).toBe('/');
    expect(joinBase('/', '/ai/textures.md')).toBe('/ai/textures.md');
  });
  it('mounts under a versioned base', () => {
    expect(joinBase('/v2/', '/editor')).toBe('/v2/editor');
    expect(joinBase('/v2/', 'editor')).toBe('/v2/editor');
    expect(joinBase('/v2/', '/')).toBe('/v2/');
    expect(joinBase('/v2/', '/ai.md')).toBe('/v2/ai.md');
  });
});

describe('routeFromPath', () => {
  it('is the identity at the root base', () => {
    expect(routeFromPath('/', '/editor')).toBe('/editor');
    expect(routeFromPath('/', '/')).toBe('/');
    expect(routeFromPath('/', '')).toBe('/');
  });
  it('strips a versioned base back to the app route', () => {
    expect(routeFromPath('/v2/', '/v2/editor')).toBe('/editor');
    expect(routeFromPath('/v2/', '/v2/')).toBe('/');
    expect(routeFromPath('/v2/', '/v2')).toBe('/');
    expect(routeFromPath('/v2/', '/v2/help')).toBe('/help');
  });
  it('round-trips with joinBase', () => {
    for (const base of ['/', '/v2/', '/v10/']) {
      for (const route of ['/', '/editor', '/help', '/catalog']) {
        expect(routeFromPath(base, joinBase(base, route))).toBe(route);
      }
    }
  });
  it('returns an out-of-base path unchanged (defensive)', () => {
    expect(routeFromPath('/v2/', '/v3/editor')).toBe('/v3/editor');
  });
});
