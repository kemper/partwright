// Vite plugin that turns the five content HTML shells (catalog/help/legal/
// whats-new/ideas) into fully pre-rendered static pages: it injects the build-time
// content (nav + page body + footer) into each shell's `<!--PW-CONTENT-->`
// placeholder. The result is real HTML with real content for crawlers, with
// no app JavaScript on the page.
//
// It also rewrites the clean routes (/catalog → /catalog.html, etc.) in the
// dev and preview servers so every environment matches the production
// behavior wired up by public/_redirects on Cloudflare Pages.

import type { Plugin, Connect } from 'vite';
import { resolve } from 'node:path';
import { renderContentBody, prepareCatalogThumbnails, CONTENT_PAGES, type ContentPage } from './render';
import { contentHeaderHtml } from '../chrome';

const PLACEHOLDER = '<!--PW-CONTENT-->';
// The landing page (index.html) shares the exact same header via this marker,
// so the top nav is single-sourced across every non-editor surface.
const NAV_PLACEHOLDER = '<!--PW-NAV-->';

/** Clean route → content-page id, for the dev/preview URL rewrite. */
const ROUTE_TO_PAGE: Record<string, ContentPage> = Object.fromEntries(
  (Object.keys(CONTENT_PAGES) as ContentPage[]).map((p) => [CONTENT_PAGES[p].path, p]),
);

/** Identify which content page an HTML file corresponds to (by file name),
 *  or null for index.html / anything else. */
function pageForHtml(idOrPath: string): ContentPage | null {
  for (const page of Object.keys(CONTENT_PAGES) as ContentPage[]) {
    if (idOrPath.endsWith('/' + CONTENT_PAGES[page].htmlFile) || idOrPath === CONTENT_PAGES[page].htmlFile) {
      return page;
    }
  }
  return null;
}

function rewriteMiddleware(): Connect.NextHandleFunction {
  return ((req: { url?: string }, _res: unknown, next: () => void) => {
    const reqUrl = req.url;
    if (reqUrl) {
      // Strip query/hash for the match; keep them on the rewritten URL.
      const qIdx = reqUrl.search(/[?#]/);
      const path = qIdx === -1 ? reqUrl : reqUrl.slice(0, qIdx);
      const rest = qIdx === -1 ? '' : reqUrl.slice(qIdx);
      const page = ROUTE_TO_PAGE[path];
      if (page) req.url = '/' + CONTENT_PAGES[page].htmlFile + rest;
    }
    next();
  }) as Connect.NextHandleFunction;
}

export function prerenderContentPages(): Plugin {
  return {
    name: 'partwright-prerender-content-pages',
    // Emit each catalog entry's thumbnail as a content-hashed PNG under
    // public/catalog/thumbs/ before anything renders, so the tiles (built in
    // transformIndexHtml) can point <img src> straight at the hashed file. Runs
    // for both the dev server and the production build.
    buildStart() {
      prepareCatalogThumbnails(resolve(process.cwd(), 'public'));
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        // The landing page injects just the shared header (it has its own body).
        if (html.includes(NAV_PLACEHOLDER)) {
          html = html.replace(NAV_PLACEHOLDER, () => contentHeaderHtml('/'));
        }
        const page = pageForHtml(ctx.path) ?? pageForHtml(ctx.filename);
        if (page) html = html.replace(PLACEHOLDER, () => renderContentBody(page));
        return html;
      },
    },
    configureServer(server) {
      server.middlewares.use(rewriteMiddleware());
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewriteMiddleware());
    },
  };
}
