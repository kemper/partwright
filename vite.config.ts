import { defineConfig, type Plugin, type Connect } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSitemapXml } from './src/seo/sitemap';
import { prerenderContentPages } from './src/content/build/prerenderPlugin';
import { rebaseHtmlPaths, basePrefix } from './src/content/rebasePaths';

// Set charset=utf-8 on .md and .txt files served from public/ during dev.
// Prevents em-dashes and other UTF-8 chars from rendering as mojibake.
function markdownCharset(): Plugin {
  return {
    name: 'markdown-charset',
    configureServer(server) {
      server.middlewares.use(((req: Connect.IncomingMessage, res, next) => {
        if (req.url && /\.(md|txt)(\?|$)/.test(req.url)) {
          const origSetHeader = res.setHeader.bind(res);
          res.setHeader = (name: string, value: string | number | readonly string[]) => {
            if (name.toLowerCase() === 'content-type' && typeof value === 'string' && !value.includes('charset')) {
              return origSetHeader(name, value + '; charset=utf-8');
            }
            return origSetHeader(name, value);
          };
        }
        next();
      }) as Connect.NextHandleFunction);
    },
  };
}

// Resolve relative paths to absolute URLs at build time.
// Checks SITE_URL (custom env var) then CF_PAGES_URL (Cloudflare Pages built-in).
function absoluteUrls(): Plugin {
  let base = '/';
  // Splice the deployment base in front of a root-relative path, but only if it
  // isn't there already — Vite bases asset-like meta (og:image) and the
  // canonical link itself, while leaving route-like meta (og:url) and inline
  // JSON-LD `url` alone, so this guard makes the rewrite correct for both
  // without double-basing. No-op at base `/` (prefix === '').
  // NOTE: correctness relies on Vite's own asset/link basing running BEFORE this
  // transformIndexHtml — so canonical/og:image already carry the base (and this
  // guard no-ops them) while og:url/JSON-LD arrive unbased (and get prefixed).
  // The DEPLOY_BASE=/v1/ build is verified double-base-free; keep that check if
  // this ordering is ever revisited.
  const withBase = (path: string): string => {
    const prefix = basePrefix(base);
    if (prefix === '' || path === prefix || path.startsWith(prefix + '/')) return path;
    return prefix + path;
  };
  return {
    name: 'absolute-urls',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml(html) {
      const siteUrl = (process.env.SITE_URL || process.env.CF_PAGES_URL || '').replace(/\/$/, '');
      if (!siteUrl) return html;
      return html
        // OG/Twitter image + og:url meta tags
        .replace(
          /(<meta\s+(?:property|name)="(?:og:image|og:url|twitter:image)"\s+content=")(\/[^"]*)(")/g,
          (_, pre, path, post) => `${pre}${siteUrl}${withBase(path)}${post}`
        )
        // <link rel="canonical">
        .replace(
          /(<link\s+rel="canonical"\s+href=")(\/[^"]*)(")/g,
          (_, pre, path, post) => `${pre}${siteUrl}${withBase(path)}${post}`
        )
        // JSON-LD "url" field
        .replace(
          /("url"\s*:\s*")(\/[^"]*)(")/g,
          (_, pre, path, post) => `${pre}${siteUrl}${withBase(path)}${post}`
        );
    },
  };
}

// Prefix root-relative anchor nav hrefs (`<a href="/editor">`) in every emitted
// HTML page with the deployment base. Vite bases assets/scripts/canonical
// automatically but leaves `<a>` navigation alone; this closes that gap for the
// prerendered content shells. No-op at base `/`. See src/content/rebasePaths.ts.
function basePaths(): Plugin {
  let base = '/';
  return {
    name: 'partwright-base-anchor-hrefs',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      // 'post' so it runs after the content-prerender injection (which adds the
      // nav + body) and after Vite's own asset basing.
      order: 'post',
      handler(html) {
        return rebaseHtmlPaths(html, base);
      },
    },
  };
}

// Generate dist/sitemap.xml at build time with absolute <loc> URLs derived
// from SITE_URL (or CF_PAGES_URL), using the same precedence as absoluteUrls.
// absoluteUrls is transformIndexHtml-only and can't touch a static file in
// public/, so this is a separate closeBundle plugin. closeBundle runs AFTER
// Vite copies public/ into dist, so writing here overwrites any stale copy —
// which is why public/sitemap.xml has been removed (it would clobber this).
function dynamicSitemap(): Plugin {
  let outDir = 'dist';
  let base = '/';
  return {
    name: 'partwright-dynamic-sitemap',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      // Deployment base (`/`, `/v2/`, …) so each <loc> sits under this major's
      // mount. No-op while base is `/`.
      base = config.base;
    },
    closeBundle() {
      const siteUrl = (process.env.SITE_URL || process.env.CF_PAGES_URL || '').replace(/\/$/, '');
      const xml = buildSitemapXml(siteUrl, undefined, base);
      writeFileSync(resolve(outDir, 'sitemap.xml'), xml, 'utf8');
    },
  };
}

// Rewrite the copied dist/manifest.json so its `start_url` and icon `src`s sit
// under the deployment base — a `/vN/`-mounted PWA install then launches at the
// version and pulls its own icons, instead of the origin root. Vite copies
// public/manifest.json verbatim (no base rewrite), so like dynamicSitemap this
// runs in closeBundle (after the copy) and overwrites it. No-op at base `/`.
function baseAwareManifest(): Plugin {
  let outDir = 'dist';
  let base = '/';
  return {
    name: 'partwright-base-aware-manifest',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
      base = config.base;
    },
    closeBundle() {
      const prefix = basePrefix(base);
      if (prefix === '') return; // base '/' — copied manifest is already correct
      const manifestPath = resolve(outDir, 'manifest.json');
      let raw: string;
      try {
        raw = readFileSync(manifestPath, 'utf8');
      } catch {
        return; // no manifest emitted — nothing to do
      }
      const m = JSON.parse(raw) as { start_url?: string; icons?: { src?: string }[] };
      const withBase = (p: string | undefined): string | undefined =>
        typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? prefix + p : p;
      if (m.start_url) m.start_url = withBase(m.start_url);
      if (Array.isArray(m.icons)) {
        for (const icon of m.icons) if (icon && icon.src) icon.src = withBase(icon.src);
      }
      writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n', 'utf8');
    },
  };
}

// Inject the Cloudflare Web Analytics beacon into every emitted HTML page —
// but ONLY in a production build (`apply: 'build'`), never in the dev server or
// the Playwright e2e run. Two reasons it must stay build-only:
//   1. The RUM beacon reports to Cloudflare keyed by token regardless of origin,
//      so loading it from localhost / CI would pollute the production analytics
//      with dev + test-suite traffic.
//   2. The dev/preview CSP (server.headers below) deliberately omits the beacon
//      host, so a stray external call surfaces in dev; loading the beacon there
//      would trip that guard and the "no console errors" smoke specs.
// The matching production CSP allowance lives in public/_headers (script-src).
// The token is a public site identifier, not a secret, so it's safe in source.
function injectAnalyticsBeacon(): Plugin {
  const BEACON =
    `<!-- Cloudflare Web Analytics --><script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "8841daefa37741dda00d7e9c6a1441af"}'></script><!-- End Cloudflare Web Analytics -->`;
  return {
    name: 'partwright-analytics-beacon',
    apply: 'build',
    transformIndexHtml(html) {
      // Runs for every HTML input (index + the content pages); editor.html is a
      // closeBundle copy of the built index.html, so it inherits the beacon too.
      return html.replace('</body>', `  ${BEACON}\n</body>`);
    },
  };
}

// Emit `editor.html` as a copy of the SPA shell `index.html` so the editor's
// no-file route is served as a REAL static file at its clean URL (Cloudflare
// maps `/editor` → `/editor.html`, exactly like `/catalog` → `/catalog.html`).
// This is the only reliable SPA-fallback on Cloudflare Pages: a `_redirects`
// `200`-rewrite to `…/index.html` gets the destination canonicalized
// (`/index.html` → `/`, `/foo.html` → `/foo`) and 308-redirects the user away
// (and a `/*`/`/v1/*` splat to index.html is rejected as an infinite loop).
// Runs per build via config.build.outDir, so it covers both `dist/` and the
// nested `dist/v1/`. The copy keeps index.html's own (already base-correct)
// asset refs. `/` and `/v1/` still serve their index via directory-index.
function editorHtmlAlias(): Plugin {
  let outDir = 'dist';
  return {
    name: 'partwright-editor-html-alias',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      try {
        const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
        writeFileSync(resolve(outDir, 'editor.html'), html, 'utf8');
      } catch {
        /* no index.html emitted — nothing to alias */
      }
    },
  };
}

// Build/version metadata surfaced by the in-app About dialog so a given deploy
// can be traced back to an exact commit/branch — handy for Cloudflare branch &
// PR preview deploys, which otherwise look identical. Cloudflare sets CF_PAGES_*
// at build time; we fall back to local git so `npm run dev` and laptop builds
// show real values too.
function parseGitHubRepo(remoteUrl: string): string {
  const m = remoteUrl.match(/github\.com[:/]+([\w.-]+\/[\w.-]+?)(?:\.git)?$/i);
  return m ? m[1] : '';
}


function resolveBuildInfo() {
  const git = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      return '';
    }
  };
  const onCloudflare = !!process.env.CF_PAGES;
  const commit = process.env.CF_PAGES_COMMIT_SHA || git('git rev-parse HEAD') || 'unknown';
  const branch = process.env.CF_PAGES_BRANCH || git('git rev-parse --abbrev-ref HEAD') || 'unknown';
  const repo =
    process.env.GITHUB_REPOSITORY ||
    parseGitHubRepo(git('git config --get remote.origin.url')) ||
    'kemper/partwright';
  // "dirty" only means something for a local working tree; a fresh CI / CF
  // clone is always clean, so skip the (possibly slow) status call there.
  const dirty = !onCloudflare && git('git status --porcelain') !== '';
  // The released semantic version — the X.Y.Z a user pins/migrates against, and
  // the value the release-tag Action stamps onto the git tag on production.
  let version = 'unknown';
  try {
    version = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version || 'unknown';
  } catch {
    /* keep 'unknown' */
  }
  return { commit, branch, buildTime: new Date().toISOString(), repo, dirty, version };
}

export default defineConfig({
  // Deployment base. Default `/` (the unversioned production mount). Set
  // DEPLOY_BASE=/v1/ (etc.) to mount this build under a version path for the
  // versioned-deployment strategy — Vite then prefixes every emitted asset/
  // script/css URL automatically; the non-bundle paths (nav hrefs, SEO tags,
  // redirects, the pre-paint scripts) are handled by the base-aware plugins
  // and helpers. Normalized to a single leading+trailing slash.
  base: ((): string => {
    let b = (process.env.DEPLOY_BASE || '/').trim();
    if (b === '') b = '/';
    if (!b.startsWith('/')) b = '/' + b;
    if (!b.endsWith('/')) b = b + '/';
    return b;
  })(),
  // Replaced verbatim wherever `__BUILD_INFO__` appears (see src/buildInfo.ts).
  define: {
    __BUILD_INFO__: JSON.stringify(resolveBuildInfo()),
  },
  plugins: [tailwindcss(), prerenderContentPages(), absoluteUrls(), basePaths(), markdownCharset(), dynamicSitemap(), baseAwareManifest(), injectAnalyticsBeacon(), editorHtmlAlias()],
  esbuild: {
    // .tsx files compile JSX via preact/jsx-runtime — keeps the bundle on
    // Preact without pulling in React. Vanilla .ts files in the rest of
    // the app are unaffected.
    jsx: 'automatic',
    jsxImportSource: 'preact',
  },
  worker: {
    // ES module Workers support code-splitting and are required when
    // Worker files import other modules (agentWorker, engineWorker).
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['manifold-3d']
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      // Mirror the production CSP (public/_headers) so an accidental new
      // external call surfaces here in dev instead of slipping through to
      // production. connect-src allows `https:` + http://localhost / 127.0.0.1
      // so a user-configured Custom (OpenAI-compatible) endpoint — e.g. a
      // self-hosted llama.cpp server — works (matches _headers). That same
      // `https:` allowance also backs "Import from URL…" (fetching a remote
      // file over https). The dev-only
      // delta is the localhost WebSocket Vite uses for HMR/live-reload, which
      // production has no equivalent of. Keep the host allowlist in sync with
      // public/_headers — with ONE intentional exception: the Cloudflare Web
      // Analytics beacon host (static.cloudflareinsights.com) is in _headers'
      // script-src but deliberately NOT here, because the beacon is injected
      // build-only (see injectAnalyticsBeacon) and never loads in dev/test.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:* https: http://localhost:* http://127.0.0.1:* https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://huggingface.co https://*.huggingface.co https://*.xethub.hf.co https://raw.githubusercontent.com; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    },
    fs: {
      // Relax strict fs access for WASM files in node_modules
      // (required when running from a git worktree where node_modules
      // resolves to the original repo path outside the worktree root)
      strict: false,
    },
  },
  build: {
    chunkSizeWarningLimit: 520,
    rollupOptions: {
      // Multi-page: the editor SPA (index.html) plus the five pre-rendered,
      // app-free content pages. Each content page ships only the shared
      // Tailwind CSS — no app JS — so it paints instantly for users + crawlers.
      input: {
        main: resolve(__dirname, 'index.html'),
        catalog: resolve(__dirname, 'catalog.html'),
        help: resolve(__dirname, 'help.html'),
        legal: resolve(__dirname, 'legal.html'),
        'whats-new': resolve(__dirname, 'whats-new.html'),
        ideas: resolve(__dirname, 'ideas.html'),
      },
      output: {
        // Function form (not the object map) so we can isolate Vite's
        // `__vite_preload` helper into its own tiny chunk. With the object
        // form, Rollup folded that helper into the `manifold` chunk, which
        // meant the entry (src/entry.ts) imported manifold (~44 KB) just to
        // get the helper — pulling engine glue onto the landing route, which
        // must stay app-free. Keeping it standalone lets the landing entry
        // load only itself + storage/db.
        manualChunks(id) {
          if (id.includes('vite/preload-helper')) return 'vite-preload';
          if (id.includes('node_modules/three/')) return 'three';
          if (
            id.includes('node_modules/@codemirror/state') ||
            id.includes('node_modules/@codemirror/view') ||
            id.includes('node_modules/@codemirror/lang-javascript') ||
            id.includes('node_modules/@codemirror/theme-one-dark')
          ) return 'codemirror';
          if (id.includes('node_modules/manifold-3d')) return 'manifold';
          return undefined;
        },
      },
    },
  },
  appType: 'spa',
});
