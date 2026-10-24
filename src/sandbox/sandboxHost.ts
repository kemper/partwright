// App-side host for the engine sandbox (kemper/partwright#1090, "option 2").
//
// `createEngineWorker(direct)` is the single seam engine.ts and enginePool.ts
// go through to get a geometry Worker. With the sandbox off it just calls
// `direct()` (today's `new Worker(engineWorker.ts)`). With it on, it returns a
// `SandboxedEngineWorker` — a Worker-shaped façade (postMessage / onmessage /
// onerror / onmessageerror / terminate) whose real Worker lives inside a
// hidden cross-origin iframe:
//
//   app ──MessageChannel.port1──────────────────────────► (façade)
//    │                                                      ▲
//    └─ iframe.postMessage({spawn,id}, [port2]) ─► frame ─► Worker(port2)
//
// The frame transfers port2 into the Worker, so after the handshake the app
// and the Worker talk directly (one hop) and mesh buffers move with their
// transfer lists, as before.
//
// Handshake + fallback: the Worker's first port message reports whether it is
// cross-origin isolated (the WASM engines need SharedArrayBuffer). Until then
// the façade buffers everything the client posts. If the frame or Worker isn't
// isolated, fails to load, or doesn't answer within the boot timeout, the
// sandbox is marked broken for the rest of the page: the façade spins up a
// direct Worker, replays the buffer into it and forwards its events — so the
// client never notices — and the user gets one toast + a Diagnostic Log entry.
//
// Every message from the frame/Worker is treated as untrusted (see
// protocol.ts): the frame's must come from our iframe's window and match the
// allow-list; the Worker's must have an allow-listed engine message type.

import { getConfig } from '../config/appConfig';
import { errorLog } from '../diagnostics/errorLog';
import { showToast } from '../ui/toast';
import { BASE } from '../deployment';
import {
  getEngineSandboxMode,
  configuredSandboxOrigin,
  type EngineSandboxMode,
} from './engineSandboxSetting';
import { isAllowedEngineMessage, parseFrameMessage, parseWorkerStatus } from './protocol';

/** The slice of the Worker interface the geometry clients use. A real
 *  `Worker` satisfies it, so the 'off' path returns one unchanged. */
export interface EngineWorkerHandle {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: ErrorEvent) => void) | null;
  onmessageerror: ((ev: MessageEvent) => void) | null;
  terminate(): void;
}

export interface EngineSandboxStatus {
  /** Mode the setting asks for. */
  requested: EngineSandboxMode;
  /** Mode actually in effect ('off' after a fallback). */
  active: EngineSandboxMode;
  /** 'idle' (no Worker requested yet / mode off), 'loading', 'ready', 'fallback'. */
  state: 'idle' | 'loading' | 'ready' | 'fallback';
  /** `crossOriginIsolated` reported by the sandbox frame (null until known). */
  frameCrossOriginIsolated: boolean | null;
  /** `crossOriginIsolated` reported by the most recent sandboxed Worker. */
  workerCrossOriginIsolated: boolean | null;
  /** The frame's origin ('null' for opaque mode), or null when off. */
  frameOrigin: string | null;
  /** Why the sandbox fell back to 'off', if it did. */
  fallbackReason: string | null;
}

let fallbackReason: string | null = null;
let host: SandboxHost | null = null;
let lastWorkerCoi: boolean | null = null;
let handleCounter = 0;

function requestedMode(): EngineSandboxMode {
  return getEngineSandboxMode();
}

/** Snapshot of the sandbox state — surfaced via `partwright.getEngineSandboxStatus()`. */
export function getEngineSandboxStatus(): EngineSandboxStatus {
  const requested = requestedMode();
  const active: EngineSandboxMode = fallbackReason ? 'off' : requested;
  return {
    requested,
    active,
    state: requested === 'off'
      ? 'idle'
      : fallbackReason
        ? 'fallback'
        : host
          ? (host.ready ? 'ready' : 'loading')
          : 'idle',
    frameCrossOriginIsolated: host?.frameCoi ?? null,
    workerCrossOriginIsolated: lastWorkerCoi,
    frameOrigin: active === 'off' ? null : host?.expectedOrigin ?? null,
    fallbackReason,
  };
}

/** Mark the sandbox unusable for this page and tell the user once. Every
 *  façade still waiting on its handshake switches to a direct Worker. */
function breakSandbox(reason: string): void {
  if (fallbackReason) return;
  fallbackReason = reason;
  const msg = `Engine sandbox unavailable (${reason}) — model code is running without the sandbox in this tab.`;
  // showToast mirrors into the Diagnostic Log (warn, source 'engine').
  showToast(msg, { variant: 'warn', source: 'engine' });
  host?.failAll(reason);
}

function frameSrc(mode: 'opaque' | 'origin', origin: string | null): string {
  // Dev (Vite) serves the page at /sandbox.html; Cloudflare Pages serves the
  // built page at its clean URL (and 308s /sandbox.html → /sandbox), so use
  // the clean URL in production builds to skip that redirect.
  const file = import.meta.env.DEV ? 'sandbox.html' : 'sandbox';
  const path = `${BASE}${file}`;
  return mode === 'origin' ? `${origin}${path}` : new URL(path, location.href).href;
}

class SandboxHost {
  readonly frame: HTMLIFrameElement;
  /** Origin the frame's messages must carry: 'null' (opaque) or the sandbox origin. */
  readonly expectedOrigin: string;
  private readonly targetOrigin: string;
  ready = false;
  frameCoi: boolean | null = null;
  private readonly handles = new Map<string, SandboxedEngineWorker>();
  private readonly pendingSpawns: { id: string; port: MessagePort }[] = [];
  private readonly bootTimer: number;

  constructor(mode: 'opaque' | 'origin', origin: string | null) {
    this.expectedOrigin = mode === 'origin' ? origin! : 'null';
    this.targetOrigin = mode === 'origin' ? origin! : '*';
    const frame = document.createElement('iframe');
    // 'opaque': no allow-same-origin ⇒ the frame gets an opaque origin even
    // though its URL is the app's. 'origin': the frame keeps its (different)
    // real origin so its Worker can load same-origin modules; the sandbox
    // flags still strip navigation, popups, forms and downloads.
    frame.setAttribute('sandbox', mode === 'origin' ? 'allow-scripts allow-same-origin' : 'allow-scripts');
    // Delegate cross-origin isolation (SharedArrayBuffer) into the frame.
    frame.setAttribute('allow', 'cross-origin-isolated');
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.title = 'Partwright engine sandbox';
    frame.dataset.engineSandbox = mode;
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none;left:-10px;top:-10px;';
    frame.src = frameSrc(mode, origin);
    this.frame = frame;
    window.addEventListener('message', this.onWindowMessage);
    document.body.appendChild(frame);
    this.bootTimer = window.setTimeout(() => {
      if (!this.ready) breakSandbox('sandbox frame did not load in time');
    }, getConfig().renderer.engineSandboxBootTimeoutMs);
  }

  private onWindowMessage = (event: MessageEvent): void => {
    if (event.source !== this.frame.contentWindow) return;
    if (event.origin !== this.expectedOrigin) return;
    const msg = parseFrameMessage(event.data);
    if (!msg) return;
    if (msg.type === 'frame_ready') {
      window.clearTimeout(this.bootTimer);
      this.frameCoi = msg.coi;
      if (!msg.coi || !msg.sab) {
        breakSandbox('sandbox frame is not cross-origin isolated');
        return;
      }
      this.ready = true;
      for (const s of this.pendingSpawns.splice(0)) this.postSpawn(s.id, s.port);
      return;
    }
    const handle = this.handles.get(msg.id);
    if (!handle) return;
    if (msg.type === 'spawn_failed') handle.connectFailed(`worker spawn failed: ${msg.message}`);
    else handle.workerError(msg.message);
  };

  private postSpawn(id: string, port: MessagePort): void {
    this.frame.contentWindow?.postMessage({ type: 'spawn', id }, this.targetOrigin, [port]);
  }

  spawn(handle: SandboxedEngineWorker, port: MessagePort): void {
    this.handles.set(handle.id, handle);
    if (this.ready) this.postSpawn(handle.id, port);
    else this.pendingSpawns.push({ id: handle.id, port });
  }

  release(id: string): void {
    if (!this.handles.delete(id)) return;
    if (this.ready) this.frame.contentWindow?.postMessage({ type: 'terminate', id }, this.targetOrigin);
  }

  /** The sandbox broke: hand every not-yet-connected façade to a direct Worker
   *  (connected ones ignore this and keep running sandboxed). */
  failAll(reason: string): void {
    window.clearTimeout(this.bootTimer);
    for (const h of [...this.handles.values()]) h.connectFailed(reason);
    this.pendingSpawns.length = 0;
  }
}

function ensureHost(mode: 'opaque' | 'origin', origin: string | null): SandboxHost {
  if (!host) host = new SandboxHost(mode, origin);
  return host;
}

/** Worker-shaped façade over a Worker running inside the sandbox frame. */
class SandboxedEngineWorker implements EngineWorkerHandle {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;

  readonly id: string;
  private state: 'connecting' | 'sandboxed' | 'direct' | 'dead' = 'connecting';
  private buffer: { message: unknown; transfer: Transferable[] }[] = [];
  private port: MessagePort | null;
  private direct: Worker | null = null;
  private readonly connectTimer: number;

  private readonly directFactory: () => Worker;
  private readonly sandboxHost: SandboxHost;

  constructor(directFactory: () => Worker, sandboxHost: SandboxHost) {
    this.directFactory = directFactory;
    this.sandboxHost = sandboxHost;
    this.id = `w${++handleCounter}`;
    const channel = new MessageChannel();
    this.port = channel.port1;
    channel.port1.onmessage = this.onPortMessage;
    channel.port1.onmessageerror = (ev) => {
      if (this.state === 'sandboxed') this.onmessageerror?.(ev);
    };
    sandboxHost.spawn(this, channel.port2);
    this.connectTimer = window.setTimeout(() => {
      if (this.state === 'connecting') breakSandbox('sandboxed engine worker did not start in time');
    }, getConfig().renderer.engineSandboxBootTimeoutMs);
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.state === 'sandboxed') this.port!.postMessage(message, transfer);
    else if (this.state === 'direct') this.direct!.postMessage(message, transfer);
    else if (this.state === 'connecting') this.buffer.push({ message, transfer });
  }

  terminate(): void {
    const prev = this.state;
    this.state = 'dead';
    window.clearTimeout(this.connectTimer);
    this.buffer = [];
    this.port?.close();
    this.port = null;
    this.sandboxHost.release(this.id);
    if (prev === 'direct') this.direct?.terminate();
    this.direct = null;
  }

  private onPortMessage = (ev: MessageEvent): void => {
    if (this.state === 'connecting') {
      const status = parseWorkerStatus(ev.data);
      if (!status) return; // nothing else is legitimate before the status
      lastWorkerCoi = status.coi;
      if (!status.coi || !status.sab) {
        breakSandbox('sandboxed engine worker is not cross-origin isolated');
        return;
      }
      window.clearTimeout(this.connectTimer);
      this.state = 'sandboxed';
      for (const b of this.buffer.splice(0)) this.port!.postMessage(b.message, b.transfer);
      return;
    }
    if (this.state !== 'sandboxed') return;
    if (!isAllowedEngineMessage(ev.data)) {
      errorLog.capture({
        level: 'warn',
        source: 'engine',
        message: 'Dropped an unrecognised message from the sandboxed engine worker',
      });
      return;
    }
    this.onmessage?.(ev);
  };

  /** Handshake never completed — switch to a direct Worker transparently. */
  connectFailed(reason: string): void {
    // A façade that already connected keeps its healthy sandboxed Worker even
    // when a later spawn breaks the sandbox for new Workers.
    if (this.state !== 'connecting') return;
    window.clearTimeout(this.connectTimer);
    this.port?.close();
    this.port = null;
    this.sandboxHost.release(this.id);
    if (!fallbackReason) breakSandbox(reason);
    const w = this.directFactory();
    this.direct = w;
    this.state = 'direct';
    w.onmessage = (ev) => this.onmessage?.(ev);
    w.onerror = (ev) => this.onerror?.(ev);
    w.onmessageerror = (ev) => this.onmessageerror?.(ev);
    for (const b of this.buffer.splice(0)) w.postMessage(b.message, b.transfer);
  }

  /** The sandboxed Worker failed to load or crashed (relayed by the frame). */
  workerError(message: string): void {
    if (this.state === 'connecting') {
      this.connectFailed(`sandboxed engine worker failed to load: ${message}`);
      return;
    }
    if (this.state !== 'sandboxed') return;
    this.onerror?.(new ErrorEvent('error', { message }));
  }
}

/** The sandbox host for the requested mode, creating its iframe on first use;
 *  null when the sandbox is off, unavailable, or misconfigured (the latter
 *  falls back with a warning). */
function activeHost(): SandboxHost | null {
  const mode = requestedMode();
  if (mode === 'off' || fallbackReason || typeof document === 'undefined') return null;
  let origin: string | null = null;
  if (mode === 'origin') {
    origin = configuredSandboxOrigin();
    if (!origin) {
      breakSandbox("'origin' mode needs VITE_SANDBOX_ORIGIN set at build time");
      return null;
    }
    if (origin === location.origin) {
      breakSandbox('VITE_SANDBOX_ORIGIN is the app origin itself, which would not isolate anything');
      return null;
    }
  }
  return ensureHost(mode, origin);
}

/** Start loading the sandbox frame early (no-op when off), so its document +
 *  spawner script load in parallel with the main thread's own WASM init
 *  instead of after it. */
export function prewarmEngineSandbox(): void {
  activeHost();
}

/** Create a geometry Worker, sandboxed when the engine-sandbox setting asks
 *  for it. `direct` must construct the plain Worker (keep the
 *  `new Worker(new URL(...), …)` literal at the call site so Vite bundles it). */
export function createEngineWorker(direct: () => Worker): EngineWorkerHandle {
  const h = activeHost();
  return h ? new SandboxedEngineWorker(direct, h) : direct();
}
