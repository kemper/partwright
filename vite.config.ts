import { defineConfig, type Plugin, type Connect } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildSitemapXml } from './src/seo/sitemap';

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
  return {
    name: 'absolute-urls',
    transformIndexHtml(html) {
      const siteUrl = (process.env.SITE_URL || process.env.CF_PAGES_URL || '').replace(/\/$/, '');
      if (!siteUrl) return html;
      return html
        // OG/Twitter image + og:url meta tags
        .replace(
          /(<meta\s+(?:property|name)="(?:og:image|og:url|twitter:image)"\s+content=")(\/[^"]*)(")/g,
          (_, pre, path, post) => `${pre}${siteUrl}${path}${post}`
        )
        // <link rel="canonical">
        .replace(
          /(<link\s+rel="canonical"\s+href=")(\/[^"]*)(")/g,
          (_, pre, path, post) => `${pre}${siteUrl}${path}${post}`
        )
        // JSON-LD "url" field
        .replace(
          /("url"\s*:\s*")(\/[^"]*)(")/g,
          (_, pre, path, post) => `${pre}${siteUrl}${path}${post}`
        );
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
  return {
    name: 'partwright-dynamic-sitemap',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const siteUrl = (process.env.SITE_URL || process.env.CF_PAGES_URL || '').replace(/\/$/, '');
      const xml = buildSitemapXml(siteUrl);
      writeFileSync(resolve(outDir, 'sitemap.xml'), xml, 'utf8');
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
    'kemper/mainifold';
  // "dirty" only means something for a local working tree; a fresh CI / CF
  // clone is always clean, so skip the (possibly slow) status call there.
  const dirty = !onCloudflare && git('git status --porcelain') !== '';
  return { commit, branch, buildTime: new Date().toISOString(), repo, dirty };
}

export default defineConfig({
  base: '/',
  // Replaced verbatim wherever `__BUILD_INFO__` appears (see src/buildInfo.ts).
  define: {
    __BUILD_INFO__: JSON.stringify(resolveBuildInfo()),
  },
  plugins: [
    tailwindcss(),
    absoluteUrls(),
    markdownCharset(),
    dynamicSitemap(),
    // Offline app-shell service worker. We own the SW source (src/sw.ts) so it
    // can also re-stamp COOP/COEP on cached responses (cross-origin isolation
    // offline); vite-plugin-pwa just injects the precache manifest. Registration
    // lives in src/registerSW.ts (production-only), not the plugin's auto-inject.
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // We register manually (registerSW.ts) and ship our own public/manifest.json.
      injectRegister: false,
      manifest: false,
      injectManifest: {
        // Precache the core shell only. The main bundle is the largest single
        // file we keep (~6 MB and growing); the cap is set well above it so a
        // little growth can't silently drop it from the precache (vite-plugin-pwa
        // only *warns* when a file exceeds the cap) and break the offline boot —
        // the heavy lazy chunks excluded below stay out regardless via globIgnores.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,json,woff2,woff,ttf}'],
        // Keep large/optional chunks out of the install precache; they're
        // runtime-cached by sw.ts the first time they're actually used:
        //  - the lazy engines: OpenSCAD (~11 MB) + its BOSL2 libs, replicad WASM (~10 MB)
        //  - the ~6 MB WebLLM worker (only loads when a user opts into a local
        //    model — and downloading the weights needs the network anyway)
        //  - the catalog of premade sessions (~9 MB of JSON, browsed on demand)
        globIgnores: [
          '**/openscad-*',
          '**/openscad-libs/**',
          '**/replicad*',
          '**/localEngineWorker-*',
          '**/catalog/**',
        ],
      },
      // Keep the SW out of dev entirely: it would fight Vite's module/HMR
      // pipeline, and dev gets COOP/COEP straight from the server (see below),
      // so isolation doesn't need it. The e2e suite runs against dev, SW-free.
      devOptions: { enabled: false },
    }),
  ],
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
      // public/_headers.
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' ws://localhost:* ws://127.0.0.1:* https: http://localhost:* http://127.0.0.1:* https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com https://huggingface.co https://*.huggingface.co https://*.xethub.hf.co https://raw.githubusercontent.com; worker-src 'self' blob:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
    },
    fs: {
      // Relax strict fs access for WASM files in node_modules
      // (required when running from a git worktree where node_modules
      // resolves to the original repo path outside the worktree root)
      strict: false,
    },
  },
  preview: {
    // `npm run preview` serves the production build; mirror the COOP/COEP
    // headers Cloudflare sends in prod (public/_headers) so the preview is
    // cross-origin isolated like the real deployment — needed to exercise the
    // WASM engines and the offline service worker against a built bundle.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  build: {
    chunkSizeWarningLimit: 520,
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          'codemirror': [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/lang-javascript',
            '@codemirror/theme-one-dark',
          ],
          'manifold': ['manifold-3d'],
        },
      },
    },
  },
  appType: 'spa',
});
