// App-side wire protocol + untrusted-message guards for the engine sandbox.
//
// Three parties:
//   app (parent page)  ⇄  sandbox frame (sandbox.html, sandboxMain.ts)
//   app (parent page)  ⇄  engine Worker inside the frame (sandboxWorker.ts),
//                          over a MessagePort the app creates and hands through
//                          the frame — one hop, no relay.
//
// Everything that arrives FROM the frame or the Worker is untrusted: the
// Worker evaluates arbitrary model code, which can call `postMessage` on its
// port with anything. The app therefore only reacts to an allow-list of
// message types with the expected field shapes; everything else is dropped.
// Field-level validation of each geometry result happens in engine.ts /
// enginePool.ts (checkEngineWorkerMessage).
//
// The frame side lives in frameProtocol.ts (kept out of the app bundle); the
// constants below must equal its copies — a unit test checks.
//
// Pure — no DOM — so it runs in the unit tier.

import { ENGINE_WORKER_MESSAGE_TYPES } from '../geometry/workerMessageValidation';

/** Must equal frameProtocol.STATUS_MESSAGE_TYPE. */
export const STATUS_MESSAGE_TYPE = '__sandbox_status';

/** frame → app */
type FrameToParent =
  | { type: 'frame_ready'; coi: boolean; sab: boolean }
  | { type: 'spawn_failed'; id: string; message: string }
  | { type: 'worker_error'; id: string; message: string }
  | { type: 'pong'; id: string };

/** First message the Worker shim posts on its port, before the engine loads. */
interface WorkerStatusMessage {
  type: typeof STATUS_MESSAGE_TYPE;
  coi: boolean;
  sab: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Bounded id: the app mints these (`w1`, `exec-3`, …), so anything long or
 *  non-string is not one of ours. */
function isId(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 64;
}

function isShortString(v: unknown, max = 4096): v is string {
  return typeof v === 'string' && v.length <= max;
}

/** Validate a message the sandbox frame posted to the app window. */
export function parseFrameMessage(data: unknown): FrameToParent | null {
  if (!isRecord(data)) return null;
  switch (data.type) {
    case 'frame_ready':
      if (typeof data.coi !== 'boolean' || typeof data.sab !== 'boolean') return null;
      return { type: 'frame_ready', coi: data.coi, sab: data.sab };
    case 'pong':
      if (!isId(data.id)) return null;
      return { type: 'pong', id: data.id };
    case 'spawn_failed':
    case 'worker_error':
      if (!isId(data.id)) return null;
      return {
        type: data.type,
        id: data.id,
        message: isShortString(data.message) ? data.message : 'Sandbox worker error',
      };
    default:
      return null;
  }
}

/** Validate the Worker shim's first (status) message on the port. */
export function parseWorkerStatus(data: unknown): WorkerStatusMessage | null {
  if (!isRecord(data) || data.type !== STATUS_MESSAGE_TYPE) return null;
  if (typeof data.coi !== 'boolean' || typeof data.sab !== 'boolean') return null;
  return { type: STATUS_MESSAGE_TYPE, coi: data.coi, sab: data.sab };
}

/** True when a port message from the sandboxed Worker is one the engine
 *  clients handle: a plain object with an allow-listed `type` and, when
 *  present, a well-formed `callId` (string or null). */
export function isAllowedEngineMessage(data: unknown): boolean {
  if (!isRecord(data)) return false;
  if (typeof data.type !== 'string' || !ENGINE_WORKER_MESSAGE_TYPES.has(data.type)) return false;
  if ('callId' in data && data.callId !== null && !isId(data.callId)) return false;
  return true;
}
