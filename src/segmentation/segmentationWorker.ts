// Dedicated Worker for part detection.
//
// Stateful: holds one SegmentationRunner (mesh + per-options feature cache +
// current draft) so seeds, re-runs and edits don't re-send a 460k-triangle
// mesh or recompute creases. Cancellation is terminate+respawn (the
// engrave/surface Worker idiom — detection is synchronous math), after which
// the client reloads the mesh and the draft is gone.

import type { DraftSummary, PartEditOp } from './draft';
import { SegmentationRunner, type DetectRequest } from './runner';
import type { EdgeCut } from './smoothEdges';
import type { SavedPartsPayload, SegMesh } from './types';


export type SegWorkerRequest =
  | { type: 'load'; callId: number; meshKey: string; mesh: SegMesh; undoDepth: number; defaultEdgeSmoothing: number; anchorMinRegionFrac: number; autoAbsorbFrac: number }
  | { type: 'detect'; callId: number; req: Omit<DetectRequest, 'signal' | 'progress'> }
  | { type: 'preview'; callId: number; req: Omit<DetectRequest, 'signal' | 'progress'> }
  | { type: 'edit'; callId: number; ops: PartEditOp[]; stroke?: string }
  | { type: 'adopt'; callId: number; saved: SavedPartsPayload }
  | { type: 'cut'; callId: number; iterations?: number; pinCreaseDeg: number }
  | { type: 'discard'; callId: number };

export type SegWorkerResponse =
  | { type: 'progress'; callId: number; fraction: number; message?: string }
  | { type: 'result'; callId: number; summary: DraftSummary | null; triPart: Int32Array | null }
  | { type: 'cut'; callId: number; cut: EdgeCut | null }
  | { type: 'error'; callId: number; message: string };

let runner: SegmentationRunner | null = null;

function reply(msg: SegWorkerResponse, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(msg, transfer);
}

function result(callId: number, summary: DraftSummary | null): void {
  const triPart = runner?.draft ? runner.draft.triPart.slice() : null;
  reply({ type: 'result', callId, summary, triPart }, triPart ? [triPart.buffer] : []);
}

self.onmessage = (e: MessageEvent<SegWorkerRequest>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'load':
        runner = new SegmentationRunner(msg.mesh, { undoDepth: msg.undoDepth, defaultEdgeSmoothing: msg.defaultEdgeSmoothing, anchorMinRegionFrac: msg.anchorMinRegionFrac, autoAbsorbFrac: msg.autoAbsorbFrac });
        reply({ type: 'result', callId: msg.callId, summary: null, triPart: null });
        return;
      case 'detect': {
        if (!runner) throw new Error('No mesh loaded');
        const summary = runner.detect({
          ...msg.req,
          progress: (fraction, message) => reply({ type: 'progress', callId: msg.callId, fraction, message }),
        });
        result(msg.callId, summary);
        return;
      }
      case 'preview': {
        if (!runner) throw new Error('No mesh loaded');
        const p = runner.preview({
          ...msg.req,
          progress: (fraction, message) => reply({ type: 'progress', callId: msg.callId, fraction, message }),
        });
        reply({ type: 'result', callId: msg.callId, summary: p.summary, triPart: p.triPart }, [p.triPart.buffer]);
        return;
      }
      case 'edit': {
        if (!runner) throw new Error('No mesh loaded');
        result(msg.callId, runner.edit(msg.ops, msg.stroke));
        return;
      }
      case 'adopt': {
        if (!runner) throw new Error('No mesh loaded');
        result(msg.callId, runner.adopt(msg.saved));
        return;
      }
      case 'cut': {
        if (!runner) throw new Error('No mesh loaded');
        // Structured-cloned, not transferred: the runner keeps the cut cached
        // for the accept that usually follows.
        reply({ type: 'cut', callId: msg.callId, cut: runner.cut(msg.iterations, msg.pinCreaseDeg) });
        return;
      }
      case 'discard':
        if (runner) runner.draft = null;
        reply({ type: 'result', callId: msg.callId, summary: null, triPart: null });
        return;
    }
  } catch (err) {
    reply({ type: 'error', callId: msg.callId, message: err instanceof Error ? err.message : String(err) });
  }
};
