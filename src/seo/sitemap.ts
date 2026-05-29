// Pure sitemap.xml builder, shared by the build-time Vite plugin
// (vite.config.ts) and its unit test. Kept dependency-free so it can be
// imported from the Vite config (which runs in Node at build time) without
// dragging in any browser-only code.

export interface SitemapRoute {
  /** Root-relative path, e.g. '/editor'. */
  path: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

/** Fallback used when no SITE_URL / CF_PAGES_URL is set (local builds). The
 *  sitemap spec requires absolute <loc> values, so we never emit relative
 *  paths — the production URL is a safe default. */
export const SITEMAP_FALLBACK_URL = 'https://www.partwrightstudio.com';

/** The canonical route list the sitemap advertises. Kept in sync with the
 *  app's ROUTE_META plus the static doc files served from public/. */
export const SITEMAP_ROUTES: SitemapRoute[] = [
  { path: '/', changefreq: 'weekly', priority: 1.0 },
  { path: '/editor', changefreq: 'weekly', priority: 0.9 },
  { path: '/catalog', changefreq: 'weekly', priority: 0.8 },
  { path: '/help', changefreq: 'monthly', priority: 0.7 },
  { path: '/legal', changefreq: 'yearly', priority: 0.3 },
  { path: '/ai.md', changefreq: 'weekly', priority: 0.7 },
  { path: '/llms.txt', changefreq: 'weekly', priority: 0.5 },
];

/** Build the sitemap.xml text for the given site origin + routes. `siteUrl`
 *  may be empty — the fallback origin is substituted so every <loc> is a
 *  fully-qualified absolute URL. Any trailing slash on `siteUrl` is stripped
 *  so joining with the leading-slash path never double-slashes. */
export function buildSitemapXml(siteUrl: string, routes: SitemapRoute[] = SITEMAP_ROUTES): string {
  const origin = (siteUrl || SITEMAP_FALLBACK_URL).replace(/\/$/, '');
  const entries = routes
    .map((r) => {
      // Root path '/' keeps its trailing slash; others are appended as-is.
      const loc = `${origin}${r.path}`;
      const parts = [`    <loc>${loc}</loc>`];
      if (r.changefreq) parts.push(`    <changefreq>${r.changefreq}</changefreq>`);
      if (typeof r.priority === 'number') parts.push(`    <priority>${r.priority.toFixed(1)}</priority>`);
      return `  <url>\n${parts.join('\n')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}
