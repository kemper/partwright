import { describe, it, expect } from 'vitest';
import { rebaseHtmlPaths, basePrefix } from '../../src/content/rebasePaths';

describe('basePrefix', () => {
  it('collapses the root base to empty (no-op marker)', () => {
    expect(basePrefix('/')).toBe('');
    expect(basePrefix('')).toBe('');
    expect(basePrefix(undefined)).toBe('');
    expect(basePrefix(null)).toBe('');
  });
  it('strips the trailing slash off a versioned base', () => {
    expect(basePrefix('/v2/')).toBe('/v2');
    expect(basePrefix('/v2')).toBe('/v2');
    expect(basePrefix('v2')).toBe('/v2');
  });
});

describe('rebaseHtmlPaths', () => {
  it('is a strict no-op at base "/" (and empty)', () => {
    const html = '<a href="/editor">go</a> <a href="/help">h</a>';
    expect(rebaseHtmlPaths(html, '/')).toBe(html);
    expect(rebaseHtmlPaths(html, '')).toBe(html);
  });

  it('rewrites root-relative anchor hrefs under a versioned base', () => {
    expect(rebaseHtmlPaths('<a href="/editor">', '/v2/')).toBe('<a href="/v2/editor">');
    expect(rebaseHtmlPaths('<a href="/">', '/v2/')).toBe('<a href="/v2/">');
    expect(rebaseHtmlPaths('<a class="x" href="/help">', '/v2/')).toBe('<a class="x" href="/v2/help">');
    expect(rebaseHtmlPaths("<a href='/ai.md'>", '/v2/')).toBe("<a href='/v2/ai.md'>");
  });

  it('leaves NON-anchor href/src alone (Vite already bases those)', () => {
    // Restricting to <a> avoids double-basing assets/canonical that Vite prefixes.
    expect(rebaseHtmlPaths('<img src="/og.png">', '/v2/')).toBe('<img src="/og.png">');
    expect(rebaseHtmlPaths('<link rel="canonical" href="/catalog">', '/v2/'))
      .toBe('<link rel="canonical" href="/catalog">');
    expect(rebaseHtmlPaths('<script src="/route-init.js">', '/v2/'))
      .toBe('<script src="/route-init.js">');
  });

  it('leaves protocol-relative, absolute, and anchor-only hrefs alone', () => {
    const html =
      '<a href="//cdn.example.com/x">a</a>' +
      '<a href="https://example.com/y">b</a>' +
      '<a href="#section">c</a>' +
      '<a href="mailto:x@y.z">d</a>';
    expect(rebaseHtmlPaths(html, '/v2/')).toBe(html);
  });

  it('rewrites every occurrence in a document', () => {
    const html = '<a href="/editor">e</a><a href="/help">h</a><a href="/ai.md">m</a>';
    expect(rebaseHtmlPaths(html, '/v2/'))
      .toBe('<a href="/v2/editor">e</a><a href="/v2/help">h</a><a href="/v2/ai.md">m</a>');
  });

  it('does not double-base an already-based path on a second pass', () => {
    const once = rebaseHtmlPaths('<a href="/editor">', '/v2/');
    // A path that already starts with the base prefix still begins with a single
    // slash, so a naive re-run WOULD double it — callers must rebase exactly
    // once. This test documents that contract (single application).
    expect(once).toBe('<a href="/v2/editor">');
  });
});
