// Dedicated Web Worker that owns the WebLLM MLCEngine.
//
// The main thread drives it through a `WebWorkerMLCEngine` proxy built in
// local.ts (`getEngineProxy`). Keeping the engine here moves the heavy work —
// model download, GPU weight upload, and per-token generation — off the main
// thread so the UI stays responsive during local inference.
//
// WebLLM ships this handler for exactly this purpose: it instantiates its own
// MLCEngine and answers the proxy's reload / chat.completions / interrupt /
// unload messages, forwarding init-progress reports back over postMessage.

import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm';

const handler = new WebWorkerMLCEngineHandler();

self.onmessage = (event: MessageEvent): void => {
  handler.onmessage(event);
};
