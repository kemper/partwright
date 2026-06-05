// Phase 2 daemon — a long-lived headless Chromium running the REAL Partwright
// app, fronted by a localhost-only control server. This is the "warm browser as
// the server" approach from docs/headless-cli.md: full window.partwright parity
// and stateful sessions, with the WASM+renderer cold-start paid exactly once.
//
// One Node process holds three things:
//   1. an in-process Vite dev server (project's real config → COEP/COOP headers
//      that SharedArrayBuffer / WASM threads need),
//   2. a Playwright Chromium with a persistent user-data-dir (IndexedDB — i.e.
//      sessions/versions/notes — survives across daemon restarts),
//   3. an HTTP control server bound to 127.0.0.1 exposing /rpc, /eval, /health,
//      /shutdown.
//
// Run (internal — `partwright daemon start` spawns this detached):
//   node bin/partwright.mjs __daemon-run --app-port 5179 --control-port 7391
import { createServer as createViteServer } from 'vite';
import { chromium } from 'playwright';
import { createServer as createHttpServer } from 'node:http';
import { detectChromiumExecutable, USER_DATA_DIR, ensureStateDir } from './paths.mjs';

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// Run window.partwright[method](...args) inside the page. Domain errors (a bad
// model, a failed boolean) are caught IN the page and returned as structured
// data — they're the useful payload a CLI agent needs, and returning them as a
// value (not a thrown Node Error) keeps stack-trace data off the response.
async function callMethod(page, method, args) {
  return page.evaluate(async ({ method, args }) => {
    try {
      const pw = window.partwright;
      if (!pw) throw new Error('window.partwright not ready');
      const fn = pw[method];
      if (typeof fn !== 'function') throw new Error(`window.partwright.${method} is not a function`);
      return { ok: true, result: await fn.apply(pw, args || []) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }, { method, args });
}

// Run an arbitrary async function body (string) in the page with a JSON arg.
// Local-only power tool used by `bake` to run a multi-step flow in one round
// trip. Gated behind 127.0.0.1; never a remote surface.
async function evalBody(page, body, arg) {
  return page.evaluate(async ({ body, arg }) => {
    try {
      const fn = new Function('arg', 'pw', `return (async () => { ${body} })();`);
      return { ok: true, result: await fn(arg, window.partwright) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  }, { body, arg });
}

export async function runDaemon({ appPort, controlPort }) {
  ensureStateDir();

  // 1. In-process Vite dev server using the project's real config (COEP/COOP).
  const vite = await createViteServer({
    server: { port: appPort, strictPort: true, host: '127.0.0.1' },
    logLevel: 'warn',
  });
  await vite.listen();
  const appUrl = `http://127.0.0.1:${appPort}`;

  // 2. Persistent Chromium (IndexedDB survives across restarts).
  const executablePath = detectChromiumExecutable();
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: ['--no-sandbox'],
    viewport: { width: 1280, height: 900 },
  });
  const page = context.pages()[0] ?? await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.error('[page]', m.text()); });

  await page.goto(`${appUrl}/editor`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => !!(window.partwright && window.partwright.run), { timeout: 60_000 });
  console.error(`[daemon] page ready at ${appUrl}/editor`);

  // 3. Control server.
  const server = createHttpServer(async (req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, ready: true, appUrl });
      if (req.method === 'POST' && req.url === '/shutdown') { send(200, { ok: true }); shutdown(); return; }
      if (req.method === 'POST' && req.url === '/reset') {
        // Fresh /editor load — resets in-page state and clears any pending
        // navigation from a prior session switch (createSession pushes history).
        await page.goto(`${appUrl}/editor`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForFunction(() => !!(window.partwright && window.partwright.run), { timeout: 60_000 });
        return send(200, { ok: true });
      }
      if (req.method === 'POST' && req.url === '/rpc') {
        const { method, args } = await readBody(req);
        return send(200, await callMethod(page, method, args)); // {ok, result|error}
      }
      if (req.method === 'POST' && req.url === '/eval') {
        const { body, arg } = await readBody(req);
        return send(200, await evalBody(page, body, arg)); // {ok, result|error}
      }
      send(404, { ok: false, error: 'not found' });
    } catch (e) {
      // Infrastructure failure (bad request body, page navigated mid-call, …).
      // Log the detail to the daemon log; keep stack-trace data out of the
      // HTTP response (CodeQL js/stack-trace-exposure).
      console.error('[daemon] request error', e);
      send(200, { ok: false, error: 'internal daemon error (see .partwright/daemon.log)' });
    }
  });

  await new Promise((resolve) => server.listen(controlPort, '127.0.0.1', resolve));
  console.error(`[daemon] control server on 127.0.0.1:${controlPort}`);

  let closing = false;
  async function shutdown() {
    if (closing) return; closing = true;
    console.error('[daemon] shutting down');
    try { await context.close(); } catch { /* ignore */ }
    try { await vite.close(); } catch { /* ignore */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
