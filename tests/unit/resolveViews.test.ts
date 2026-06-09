import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs CLI helper, no type decls
import { resolveViews, NAMED_VIEWS, DEFAULT_VIEWS } from '../../scripts/cli/views.mjs';

describe('resolveViews', () => {
  it('returns {views:null} when neither flag is set (caller uses defaults)', () => {
    expect(resolveViews(undefined, undefined)).toEqual({ views: null });
    expect(resolveViews('', '')).toEqual({ views: null });
  });

  it('parses a custom --view "az,el" into one tile', () => {
    expect(resolveViews('130,35', undefined)).toEqual({ views: [{ name: '130,35', az: 130, el: 35 }] });
  });

  it('accepts negative angles and whitespace', () => {
    expect(resolveViews(' -50 , 28 ', undefined)).toEqual({ views: [{ name: '-50,28', az: -50, el: 28 }] });
  });

  it('--view wins over --views when both are passed', () => {
    const r = resolveViews('10,20', 'front,iso');
    expect(r.views).toEqual([{ name: '10,20', az: 10, el: 20 }]);
  });

  it('rejects a --view that is not exactly two numbers', () => {
    expect(resolveViews('a,b', undefined).error).toMatch(/two numbers/);
    expect(resolveViews('1,2,3', undefined).error).toMatch(/two numbers/);
    expect(resolveViews('5', undefined).error).toMatch(/two numbers/);
  });

  it('resolves named --views in order', () => {
    const r = resolveViews(undefined, 'front,iso,back');
    expect(r.views).toEqual([
      { name: 'front', ...NAMED_VIEWS.front },
      { name: 'iso', ...NAMED_VIEWS.iso },
      { name: 'back', ...NAMED_VIEWS.back },
    ]);
  });

  it('rejects an unknown named view and lists valid names', () => {
    const r = resolveViews(undefined, 'front,nonsense');
    expect(r.error).toMatch(/unknown view "nonsense"/);
    expect(r.error).toContain('iso');
  });

  it('DEFAULT_VIEWS is the historical front/right/top/iso grid', () => {
    expect(DEFAULT_VIEWS.map((v: { name: string }) => v.name)).toEqual(['front', 'right', 'top', 'iso']);
  });
});
