import { defineConfig, type Plugin, type Connect } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { execSync } from 'node:child_process';

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

// Build/version metadata surfaced by the in-app About dialog so a given deploy
// can be traced back to an exact commit/branch — handy for Cloudflare branch &
// PR preview deploys, which otherwise look identical. Cloudflare sets CF_PAGES_*
// at build time; we fall back to local git so `npm run dev` and laptop builds
// show real values too.
function parseGitHubRepo(remoteUrl: string): string {
  const m = remoteUrl.match(/github\.com[:/]+([\w.-]+\/[\w.-]+?)(?:\.git)?$/i);
  return m ? m[1] : '';
}

// Refresh the models.dev catalog snapshot at the start of every production
// build so the picker menus + cost meter ship with the latest data. Runs in
// `build` only (not dev) so iterating on the dev server doesn't spam
// models.dev on every restart — devs can refresh manually with
// `npm run refresh-models` when they want the freshest data locally.
//
// The script is itself defensive: on any network failure it logs a warning
// and exits 0, leaving the committed snapshot intact, so this hook can
// never fail a build (CI / Cloudflare Pages stay green when models.dev is
// down). Synchronous spawn keeps the build's task ordering simple.
function catalogSnapshot(): Plugin {
  return {
    name: 'partwright-catalog-snapshot',
    apply: 'build',
    buildStart() {
      try {
        execSync('node scripts/refreshModelsSnapshot.mjs', { stdio: 'inherit' });
      } catch (err) {
        // The script soft-fails internally — anything reaching here is a
        // crash (missing node, permissions). Don't break the build over it.
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[partwright-catalog-snapshot] refresh script crashed: ${msg}`);
      }
    },
  };
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
  plugins: [tailwindcss(), absoluteUrls(), markdownCharset(), catalogSnapshot()],
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
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' https:; worker-src 'self' blob:; font-src 'self'",
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
