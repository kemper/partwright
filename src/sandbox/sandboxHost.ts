// App-side host for the engine sandbox (kemper/partwright#1090, "option 2").
//
// `createEngineWorker(direct)` is the single seam engine.ts and enginePool.ts
// go through to get a geometry Worker (every boot, crash restart, Cancel and
// per-session recycle). With the sandbox off it just calls `direct()` (today's
// `new Worker(engineWorker.ts)`). With it on, it returns a
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
// transfer lists.
//
// FAIL CLOSED. Once a tab has the sandbox on, model code never runs outside
// it. The façade buffers what the client posts until the Worker reports
// `crossOriginIsolated`; that buffer is only ever delivered to a SANDBOXED
// Worker. When something goes wrong:
//   - a spawn that times out after the frame was ready, or a Worker port that
//     closes unexpectedly (the frame's renderer crashed / was OOM-killed),
//     restarts the iframe and re-spawns the waiting façades in the new frame
//     (bounded by renderer.engineSandboxMaxFrameRestarts);
//   - anything else — the frame or Worker isn't cross-origin isolated, the
//     frame doesn't load, the restart budget is spent, 'origin' mode isn't
//     configured — marks the sandbox UNAVAILABLE for the tab: every queued and
//     future engine call fails with "engine sandbox unavailable", and a
//     persistent status pill (src/ui/engineSandboxPill.ts) offers an explicit
//     per-tab "Run without sandbox" action. Nothing falls back on its own.
//
// The mode is captured ONCE per tab (at module load): a later change in
// Settings — or in another tab, which shares localStorage — applies after a
// reload and is reported as `pendingAfterReload`.
//
// Every message from the frame/Worker is treated as untrusted (protocol.ts):
// the frame's must come from our iframe's window with the expected origin and
// match the allow-list; the Worker's must have an allow-listed engine type.

import { getConfig } from '../config/appConfig';
import { errorLog } from '../diagnostics/errorLog';
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

export type EngineSandboxState = 'idle' | 'loading' | 'ready' | 'unavailable' | 'bypassed';

export interface EngineSandboxStatus {
  /** Mode this tab started with (captured once, at page load). */
  requested: EngineSandboxMode;
  /** Mode model code is actually running under ('off' once bypassed). */
  active: EngineSandboxMode;
  /** idle (no Worker yet / off), loading, ready, unavailable (fail-closed —
   *  model code can't run), bypassed (the user chose "Run without sandbox"). */
  state: EngineSandboxState;
  /** The saved setting, which applies after a reload (may differ from `requested`). */
  pendingAfterReload: EngineSandboxMode;
  /** `crossOriginIsolated` reported by the sandbox frame (null until known). */
  frameCrossOriginIsolated: boolean | null;
  /** `crossOriginIsolated` reported by the most recent sandboxed Worker. */
  workerCrossOriginIsolated: boolean | null;
  /** The frame's origin ('null' for opaque mode), or null when off. */
  frameOrigin: string | null;
  /** Why the sandbox is unavailable (also kept after a bypass), else null. */
  unavailableReason: string | null;
  /** How many times the frame was restarted after a crash / stuck spawn. */
  frameRestarts: number;
}

/** The mode this tab runs under — read once, never re-read (cross-tab rule). */
const TAB_MODE: EngineSandboxMode = typeof window === 'undefined' ? 'off' : getEngineSandboxMode();

const UNAVAILABLE_PREFIX = 'engine sandbox unavailable';

let unavailableReason: string | null = null;
let bypassed = false;
let host: SandboxHost | null = null;
let lastWorkerCoi: boolean | null = null;
let lastFrameCoi: boolean | null = null;
let frameRestarts = 0;
/** Restarts since the last Worker that connected successfully. */
let restartsSinceConnect = 0;
let handleCounter = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* a listener must not break the host */ }
  }
}

/** Subscribe to sandbox status changes (state, availability). Returns an
 *  unsubscribe function. */
export function onEngineSandboxStatusChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Snapshot of the sandbox state — surfaced via `partwright.getEngineSandboxStatus()`. */
export function getEngineSandboxStatus(): EngineSandboxStatus {
  let state: EngineSandboxState;
  if (TAB_MODE === 'off') state = 'idle';
  else if (bypassed) state = 'bypassed';
  else if (unavailableReason) state = 'unavailable';
  else if (!host) state = 'idle';
  else state = host.ready ? 'ready' : 'loading';
  return {
    requested: TAB_MODE,
    active: bypassed ? 'off' : TAB_MODE,
    state,
    pendingAfterReload: getEngineSandboxMode(),
    frameCrossOriginIsolated: lastFrameCoi,
    workerCrossOriginIsolated: lastWorkerCoi,
    frameOrigin: TAB_MODE === 'off' || bypassed ? null : host?.expectedOrigin ?? null,
    unavailableReason,
    frameRestarts,
  };
}

/** Fail closed: the sandbox can't be used in this tab. Every façade — waiting
 *  or connected — errors out (so its client rejects what's in flight), and
 *  every later Worker request gets an always-failing handle. Model code does
 *  not run again in this tab unless the user explicitly bypasses. */
function failClosed(reason: string): void {
  if (unavailableReason || bypassed) return;
  unavailableReason = reason;
  errorLog.capture({
    level: 'warn',
    source: 'engine',
    message: `Engine sandbox unavailable (${reason}) — model code won't run in this tab until you reload or choose "Run without sandbox".`,
  });
  const h = host;
  host = null;
  h?.destroy(`${UNAVAILABLE_PREFIX}: ${reason}`);
  notify();
}

/** The explicit per-tab escape hatch behind the status pill: after the
 *  sandbox became unavailable, let model code run in a plain app-origin
 *  Worker for the rest of this tab. Returns false when there is nothing to
 *  bypass (sandbox off, or healthy). */
export function runWithoutEngineSandbox(): boolean {
  if (TAB_MODE === 'off' || bypassed || !unavailableReason) return false;
  bypassed = true;
  errorLog.capture({
    level: 'warn',
    source: 'engine',
    message: 'Engine sandbox bypassed for this tab — model code now runs WITHOUT the sandbox (it can reach this site\'s storage and the network).',
  });
  notify();
  return true;
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
  readonly mode: 'opaque' | 'origin';
  readonly origin: string | null;
  private readonly targetOrigin: string;
  ready = false;
  private destroyed = false;
  private readonly handles = new Map<string, SandboxedEngineWorker>();
  private readonly pendingSpawns: { id: string; port: MessagePort }[] = [];
  private readonly bootTimer: number;
  private heartbeatTimer = 0;
  private lastTickAt = 0;
  private pingSentAt: number | null = null;

  /** `replacement`: created by restartFrame after an earlier frame died. Its
   *  boot timeout is one more failed restart (bounded by the restart budget);
   *  only the tab's FIRST frame failing to load fails closed immediately. */
  constructor(mode: 'opaque' | 'origin', origin: string | null, replacement = false) {
    this.mode = mode;
    this.origin = origin;
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
      if (this.ready || this.destroyed) return;
      if (replacement) restartFrame('the replacement sandbox frame did not load in time');
      else failClosed('the sandbox frame did not load in time');
    }, getConfig().renderer.engineSandboxBootTimeoutMs);
  }

  private onWindowMessage = (event: MessageEvent): void => {
    if (this.destroyed) return;
    if (event.source !== this.frame.contentWindow) return;
    if (event.origin !== this.expectedOrigin) return;
    const msg = parseFrameMessage(event.data);
    if (!msg) return;
    if (msg.type === 'frame_ready') {
      if (this.ready) return; // a frame announces itself once
      window.clearTimeout(this.bootTimer);
      lastFrameCoi = msg.coi;
      if (!msg.coi || !msg.sab) {
        failClosed('the sandbox frame is not cross-origin isolated');
        return;
      }
      this.ready = true;
      for (const s of this.pendingSpawns.splice(0)) this.postSpawn(s.id, s.port);
      this.startHeartbeat();
      notify();
      return;
    }
    if (msg.type === 'pong') {
      this.pingSentAt = null;
      return;
    }
    const handle = this.handles.get(msg.id);
    if (!handle) return;
    if (msg.type === 'spawn_failed') failClosed(`a sandboxed engine worker could not be created (${msg.message})`);
    else handle.workerError(msg.message);
  };

  /** Liveness: a frame whose renderer crashed (e.g. OOM-killed by model
   *  code) never says so — no error event reaches the app, and pending runs
   *  would hang. Ping it; ~3 unanswered intervals ⇒ restart the frame. A tick
   *  that itself fired late (the app's own main thread was busy, and with a
   *  same-process frame so was the frame's) only re-pings, never judges. */
  private startHeartbeat(): void {
    const interval = getConfig().renderer.engineSandboxHeartbeatMs;
    this.lastTickAt = performance.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.destroyed) return;
      const now = performance.now();
      const stalled = now - this.lastTickAt > interval * 2;
      this.lastTickAt = now;
      const win = this.frame.contentWindow;
      if (!this.frame.isConnected || !win) {
        restartFrame('the sandbox frame went away');
        return;
      }
      if (stalled) {
        this.pingSentAt = null;
      } else if (this.pingSentAt !== null && now - this.pingSentAt > interval * 3) {
        restartFrame('the sandbox frame stopped responding (renderer crashed?)');
        return;
      }
      if (this.pingSentAt === null) {
        this.pingSentAt = now;
        win.postMessage({ type: 'ping', id: 'hb' }, this.targetOrigin);
      }
    }, interval);
  }

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
    // A spawn still queued for frame_ready must not create an ownerless Worker.
    const i = this.pendingSpawns.findIndex(s => s.id === id);
    if (i !== -1) {
      this.pendingSpawns[i].port.close();
      this.pendingSpawns.splice(i, 1);
      return;
    }
    if (this.ready) this.frame.contentWindow?.postMessage({ type: 'terminate', id }, this.targetOrigin);
  }

  /** Tear the frame down. Every façade still attached errors out with
   *  `reason` (its client rejects in-flight calls and asks for a new Worker). */
  destroy(reason: string): SandboxedEngineWorker[] {
    if (this.destroyed) return [];
    this.destroyed = true;
    window.clearTimeout(this.bootTimer);
    window.clearInterval(this.heartbeatTimer);
    window.removeEventListener('message', this.onWindowMessage);
    for (const s of this.pendingSpawns.splice(0)) s.port.close();
    const handles = [...this.handles.values()];
    this.handles.clear();
    this.frame.remove();
    for (const h of handles) h.detach(reason);
    return handles;
  }
}

function hostOrigin(): { ok: true; mode: 'opaque' | 'origin'; origin: string | null } | { ok: false } {
  if (TAB_MODE === 'off') return { ok: false };
  if (TAB_MODE === 'opaque') return { ok: true, mode: 'opaque', origin: null };
  const origin = configuredSandboxOrigin();
  if (!origin) {
    failClosed("'origin' mode needs VITE_SANDBOX_ORIGIN set at build time");
    return { ok: false };
  }
  if (origin === location.origin) {
    failClosed('VITE_SANDBOX_ORIGIN is the app origin itself, which would not isolate anything');
    return { ok: false };
  }
  return { ok: true, mode: 'origin', origin };
}

/** The live sandbox host, creating its iframe on first use; null when the
 *  sandbox is off, bypassed or unavailable. */
function activeHost(): SandboxHost | null {
  if (TAB_MODE === 'off' || bypassed || unavailableReason || typeof document === 'undefined') return null;
  if (host) return host;
  const o = hostOrigin();
  if (!o.ok) return null;
  host = new SandboxHost(o.mode, o.origin);
  notify();
  return host;
}

/** The frame crashed or a spawn got stuck after the frame was up: replace the
 *  iframe. Connected façades error out (their Worker is gone); waiting ones
 *  re-spawn — with their buffered messages — in the NEW sandboxed frame. */
function restartFrame(reason: string): void {
  const old = host;
  if (!old || unavailableReason) return;
  if (restartsSinceConnect >= getConfig().renderer.engineSandboxMaxFrameRestarts) {
    failClosed(`the sandbox frame kept failing (${reason})`);
    return;
  }
  restartsSinceConnect++;
  frameRestarts++;
  errorLog.capture({ level: 'warn', source: 'engine', message: `Restarting the engine sandbox frame: ${reason}` });
  host = new SandboxHost(old.mode, old.origin, true);
  const waiting = old.destroy(`sandbox frame restarted: ${reason}`);
  // detach() above already errored connected façades; re-home the waiting ones.
  for (const h of waiting) h.rehome(host);
  notify();
}

/** Start loading the sandbox frame early (no-op when off), so its document +
 *  spawner script load in parallel with the main thread's own WASM init
 *  instead of after it. */
export function prewarmEngineSandbox(): void {
  activeHost();
}

/** Worker-shaped façade over a Worker running inside the sandbox frame. */
class SandboxedEngineWorker implements EngineWorkerHandle {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;

  readonly id: string;
  private state: 'connecting' | 'sandboxed' | 'dead' = 'connecting';
  /** Delivered only to a sandboxed Worker — never replayed anywhere else. */
  private buffer: { message: unknown; transfer: Transferable[] }[] = [];
  private port: MessagePort | null = null;
  private sandboxHost: SandboxHost;
  private connectTimer = 0;

  constructor(sandboxHost: SandboxHost) {
    this.id = `w${++handleCounter}`;
    this.sandboxHost = sandboxHost;
    this.connect();
  }

  private connect(): void {
    const channel = new MessageChannel();
    this.port = channel.port1;
    channel.port1.onmessage = this.onPortMessage;
    channel.port1.onmessageerror = (ev) => {
      if (this.state === 'sandboxed') this.onmessageerror?.(ev);
    };
    // Fired when the entangled port goes away without us closing ours: the
    // frame's renderer died (crash / OOM) or the Worker was torn down.
    channel.port1.addEventListener('close', this.onPortClose);
    this.sandboxHost.spawn(this, channel.port2);
    window.clearTimeout(this.connectTimer);
    this.connectTimer = window.setTimeout(() => {
      if (this.state !== 'connecting') return;
      // While the frame itself is still loading, its own boot timer decides.
      if (this.sandboxHost.ready) restartFrame('a sandboxed engine worker did not start in time');
    }, getConfig().renderer.engineSandboxBootTimeoutMs);
  }

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    if (this.state === 'sandboxed') this.port!.postMessage(message, transfer);
    else if (this.state === 'connecting') this.buffer.push({ message, transfer });
    // 'dead': dropped — the client was told via onerror / terminated us.
  }

  terminate(): void {
    if (this.state === 'dead') return;
    this.state = 'dead';
    window.clearTimeout(this.connectTimer);
    this.buffer = [];
    this.closePort();
    this.sandboxHost.release(this.id);
  }

  private closePort(): void {
    if (!this.port) return;
    this.port.removeEventListener('close', this.onPortClose);
    this.port.onmessage = null;
    this.port.close();
    this.port = null;
  }

  private onPortClose = (): void => {
    if (this.state === 'dead') return;
    restartFrame('a sandboxed engine worker stopped unexpectedly (frame crashed?)');
  };

  private onPortMessage = (ev: MessageEvent): void => {
    if (this.state === 'connecting') {
      const status = parseWorkerStatus(ev.data);
      if (!status) return; // nothing else is legitimate before the status
      lastWorkerCoi = status.coi;
      if (!status.coi || !status.sab) {
        failClosed('the sandboxed engine worker is not cross-origin isolated');
        return;
      }
      window.clearTimeout(this.connectTimer);
      this.state = 'sandboxed';
      restartsSinceConnect = 0;
      for (const b of this.buffer.splice(0)) this.port!.postMessage(b.message, b.transfer);
      notify();
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

  /** The host is going away. A waiting façade keeps its buffer (the caller may
   *  re-home it into a new sandboxed frame); a connected one errors out. */
  detach(reason: string): void {
    if (this.state === 'dead') return;
    window.clearTimeout(this.connectTimer);
    this.closePort();
    if (this.state === 'connecting' && !unavailableReason) return; // rehome() follows
    this.state = 'dead';
    this.buffer = [];
    this.onerror?.(new ErrorEvent('error', { message: reason }));
  }

  /** Re-spawn a waiting façade in a replacement frame. */
  rehome(next: SandboxHost): void {
    if (this.state !== 'connecting') return;
    this.sandboxHost = next;
    this.connect();
  }

  /** The sandboxed Worker failed to load or crashed (relayed by the frame). */
  workerError(message: string): void {
    if (this.state === 'dead') return;
    if (this.state === 'connecting') {
      failClosed(`the sandboxed engine worker failed to load (${message})`);
      return;
    }
    this.onerror?.(new ErrorEvent('error', { message }));
  }
}

/** Stand-in Worker while the sandbox is unavailable: the first post fails the
 *  client (async, like a Worker error) with "engine sandbox unavailable". */
class UnavailableEngineWorker implements EngineWorkerHandle {
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  onmessageerror: ((ev: MessageEvent) => void) | null = null;
  private fired = false;
  private dead = false;
  private readonly reason: string;

  constructor(reason: string) {
    this.reason = reason;
  }

  postMessage(): void {
    if (this.fired || this.dead) return;
    this.fired = true;
    queueMicrotask(() => {
      if (!this.dead) this.onerror?.(new ErrorEvent('error', { message: `${UNAVAILABLE_PREFIX}: ${this.reason}` }));
    });
  }

  terminate(): void {
    this.dead = true;
  }
}

/** True when an engine error message is the sandbox's fail-closed refusal. */
export function isEngineSandboxUnavailableError(message: string): boolean {
  return message.includes(UNAVAILABLE_PREFIX);
}

/** Create a geometry Worker, sandboxed when this tab's engine-sandbox mode
 *  asks for it. `direct` must construct the plain Worker (keep the
 *  `new Worker(new URL(...), …)` literal at the call site so Vite bundles it).
 *  Never falls back to `direct` on its own once the sandbox is on. */
export function createEngineWorker(direct: () => Worker): EngineWorkerHandle {
  if (TAB_MODE === 'off' || bypassed || typeof document === 'undefined') return direct();
  const h = activeHost();
  if (h) return new SandboxedEngineWorker(h);
  return new UnavailableEngineWorker(unavailableReason ?? 'the sandbox could not start');
}
