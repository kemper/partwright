import { describe, it, expect } from 'vitest';
import { buildSitemapXml, SITEMAP_ROUTES, SITEMAP_FALLBACK_URL } from '../../src/seo/sitemap';

describe('buildSitemapXml', () => {
  it('emits an absolute <loc> for every route', () => {
    const xml = buildSitemapXml('https://www.partwrightstudio.com');
    for (const route of SITEMAP_ROUTES) {
      expect(xml).toContain(`<loc>https://www.partwrightstudio.com${route.path}</loc>`);
    }
    // No relative <loc> ever (spec requires fully-qualified URLs).
    expect(xml).not.toMatch(/<loc>\/[^<]*<\/loc>/);
  });

  it('includes the /legal route', () => {
    const xml = buildSitemapXml('https://example.com');
    expect(xml).toContain('<loc>https://example.com/legal</loc>');
  });

  it('strips a trailing slash from siteUrl so paths never double-slash', () => {
    const xml = buildSitemapXml('https://example.com/');
    expect(xml).toContain('<loc>https://example.com/editor</loc>');
    expect(xml).not.toContain('https://example.com//editor');
    // Root stays a single trailing slash.
    expect(xml).toContain('<loc>https://example.com/</loc>');
    expect(xml).not.toContain('https://example.com//<');
  });

  it('falls back to the production URL when siteUrl is empty', () => {
    const xml = buildSitemapXml('');
    expect(xml).toContain(`<loc>${SITEMAP_FALLBACK_URL}/editor</loc>`);
    // Still absolute, never relative.
    expect(xml).not.toMatch(/<loc>\/[^<]*<\/loc>/);
  });

  it('renders valid sitemap envelope with changefreq + priority', () => {
    const xml = buildSitemapXml('https://example.com', [
      { path: '/', changefreq: 'weekly', priority: 1.0 },
    ]);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain('<changefreq>weekly</changefreq>');
    expect(xml).toContain('<priority>1.0</priority>');
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
  });
});
