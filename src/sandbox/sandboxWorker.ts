// Engine-sandbox Worker shim. Runs as the Worker the sandbox frame spawns
// (via a blob: bootstrap, so it inherits the frame's tight CSP and origin).
//
// The frame's first message hands over a MessagePort whose other end lives in
// the APP page. From then on the unmodified engine Worker
// (src/geometry/engineWorker.ts) talks straight to the app over that port:
//   - `self.postMessage` is redirected to `port.postMessage` (transfer lists
//     included — mesh buffers still move without a relay hop), and
//   - port messages are re-dispatched as `message` events on `self`, which is
//     what engineWorker's `self.onmessage` listens for.
// So engineWorker.ts needs no sandbox-specific code at all.
//
// The frame starts us from a classic blob: bootstrap that `import()`s this
// module and queues any message that lands first (see sandboxMain.ts); we
// take over its listener and replay that queue.
//
// Before loading the engine we report whether this Worker is cross-origin
// isolated (SharedArrayBuffer is a hard requirement of the WASM engines); the
// app falls back to a direct Worker when it isn't.

import { BOOT_GLOBAL, CONNECT_MESSAGE_TYPE, STATUS_MESSAGE_TYPE } from './protocol';

type PostFn = (message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) => void;

function onConnect(event: MessageEvent): void {
  const data = event.data as { type?: unknown; port?: unknown } | null;
  if (!data || data.type !== CONNECT_MESSAGE_TYPE || !(data.port instanceof MessagePort)) return;
  self.removeEventListener('message', onConnect);
  const port = data.port;

  const coi = (self as unknown as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
  const sab = typeof SharedArrayBuffer !== 'undefined';
  port.postMessage({ type: STATUS_MESSAGE_TYPE, coi, sab });
  if (!coi || !sab) {
    port.close();
    return;
  }

  // A blob: Worker's base URL is the blob URL, which can't resolve the
  // root-relative paths the engines fetch (`/openscad-libs/…`, the OCCT
  // `?url` wasm path). Resolve string URLs against this module's real URL
  // instead — the same base a directly-created engine Worker would have.
  const realFetch = self.fetch.bind(self);
  const base = import.meta.url;
  self.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
    realFetch(typeof input === 'string' ? new URL(input, base).href : input, init)) as typeof fetch;

  // Route the engine's replies over the direct port to the app.
  const post: PostFn = (message, transfer) => {
    if (Array.isArray(transfer)) port.postMessage(message, transfer);
    else if (transfer) port.postMessage(message, transfer);
    else port.postMessage(message);
  };
  (self as unknown as { postMessage: PostFn }).postMessage = post;

  // Load the engine first and only then start the port: messages the app sends
  // meanwhile (`init`, an early `execute`) queue in the port instead of being
  // dispatched before engineWorker has installed its `onmessage`.
  import('../geometry/engineWorker')
    .then(() => {
      port.onmessage = (ev: MessageEvent) => {
        self.dispatchEvent(new MessageEvent('message', { data: ev.data }));
      };
    })
    .catch((err: unknown) => {
      port.postMessage({
        type: 'error',
        callId: null,
        message: `Sandboxed engine failed to load: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
}

self.addEventListener('message', onConnect);

const boot = (self as unknown as Record<string, { queue: MessageEvent[]; listener: (e: MessageEvent) => void } | undefined>)[BOOT_GLOBAL];
if (boot) {
  self.removeEventListener('message', boot.listener);
  delete (self as unknown as Record<string, unknown>)[BOOT_GLOBAL];
  for (const ev of boot.queue.splice(0)) onConnect(ev);
}
