// Engine-sandbox frame (sandbox.html). Loaded into a hidden iframe on a
// separate hostname from the app ('origin' mode, VITE_SANDBOX_ORIGIN) — so
// model code running in the Workers it spawns can't reach the app's IndexedDB /
// localStorage, and its network is fenced by this document's own CSP
// (connect-src 'self' only).
//
// The frame is a thin spawner: for each `spawn` request it creates one engine
// Worker and transfers the app-supplied MessagePort into it. All geometry
// traffic then flows app ⇄ Worker over that port; the frame only relays
// lifecycle events (Worker load errors) back to the app.

import workerUrl from './sandboxWorker.ts?worker&url';
import {
  allowedParentOrigins,
  BOOT_ERROR_MESSAGE_TYPE,
  BOOT_GLOBAL,
  CONNECT_MESSAGE_TYPE,
  parseParentMessage,
  type FrameToParent,
} from './frameProtocol';

const parentWin = window.parent;
// Only the app may drive this frame. frame-ancestors limits who can embed the
// sandbox host; check the sender as well.
const PARENT_ORIGINS = allowedParentOrigins(import.meta.env.VITE_APP_ORIGIN);
const workers = new Map<string, Worker>();

function post(msg: FrameToParent): void {
  // targetOrigin '*': frame_ready goes out before the app has said anything
  // (so before the frame knows which of the app origins embeds it), and these
  // lifecycle messages carry nothing sensitive. The app checks `event.source`
  // + `event.origin` on receipt.
  parentWin.postMessage(msg, '*');
}

// One blob: bootstrap for every Worker. A blob Worker inherits this document's
// origin + CSP (an http-URL Worker would take its CSP from its own response
// headers instead), so the frame's tight connect-src applies to model code.
//
// It's a CLASSIC Worker that dynamic-imports the (module) shim. (That shape was
// required by the removed 'opaque' mode — Chromium refuses a module blob Worker
// from an opaque-origin document — and works unchanged here.) Messages that
// arrive before the shim has loaded are queued on a global the shim drains.
// Kept for the page lifetime — revoking it while a spawn's fetch is still
// pending would break that spawn.
let bootstrapUrl: string | null = null;
function bootstrap(): string {
  if (!bootstrapUrl) {
    const abs = new URL(workerUrl, location.href).href;
    const src =
      `var q = [];\n` +
      `function h(e) { q.push(e); }\n` +
      `self.addEventListener('message', h);\n` +
      `self[${JSON.stringify(BOOT_GLOBAL)}] = { queue: q, listener: h };\n` +
      `import(${JSON.stringify(abs)}).catch(function (e) {\n` +
      `  self.postMessage({ type: ${JSON.stringify(BOOT_ERROR_MESSAGE_TYPE)}, message: String((e && e.message) || e) });\n` +
      `});\n`;
    bootstrapUrl = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
  }
  return bootstrapUrl;
}

function spawn(id: string, port: MessagePort): void {
  workers.get(id)?.terminate();
  let worker: Worker;
  try {
    worker = new Worker(bootstrap(), { name: `partwright-engine-${id}` });
  } catch (err) {
    post({ type: 'spawn_failed', id, message: err instanceof Error ? err.message : String(err) });
    port.close();
    return;
  }
  worker.onmessage = (ev: MessageEvent) => {
    // The only thing the Worker says on its frame-side channel is a boot
    // failure (everything else goes over the app's port).
    const d = ev.data as { type?: unknown; message?: unknown } | null;
    if (d && d.type === BOOT_ERROR_MESSAGE_TYPE) {
      post({ type: 'worker_error', id, message: `engine failed to load: ${String(d.message).slice(0, 500)}` });
    }
  };
  worker.onerror = (ev: ErrorEvent) => {
    ev.preventDefault();
    post({ type: 'worker_error', id, message: ev.message || 'Sandboxed engine worker failed to load or crashed' });
  };
  worker.postMessage({ type: CONNECT_MESSAGE_TYPE, port }, [port]);
  workers.set(id, worker);
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== parentWin) return;
  if (!PARENT_ORIGINS.has(event.origin)) return;
  const msg = parseParentMessage(event.data);
  if (!msg) return;
  if (msg.type === 'spawn') {
    const port = event.ports[0];
    if (!port) {
      post({ type: 'spawn_failed', id: msg.id, message: 'spawn request carried no MessagePort' });
      return;
    }
    spawn(msg.id, port);
  } else if (msg.type === 'ping') {
    // Liveness heartbeat — the app replaces a frame that stops answering.
    post({ type: 'pong', id: msg.id });
  } else {
    workers.get(msg.id)?.terminate();
    workers.delete(msg.id);
  }
});

post({
  type: 'frame_ready',
  coi: (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true,
  sab: typeof SharedArrayBuffer !== 'undefined',
});
