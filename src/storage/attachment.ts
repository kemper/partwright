// Shared, dependency-free types + classification helpers for session
// attachments — the generalization of the old "reference images" list.
//
// An attachment is any file the user pins to a session as durable project
// context: a reference photo, a spec-sheet PDF, a reference STL/STEP, a notes
// markdown, etc. It outlives the AI chat transcript (clearing the chat does
// NOT remove it) and is exported with the session, so an agent resuming a
// session — or one whose chat history was cleared — can still find the
// material the work was based on.
//
// This module is a LEAF (imported by both the storage layer and the renderer's
// in-memory holder): it must stay free of any app imports so the dependency
// graph keeps its direction. Pure data + pure functions only.

/** The coarse category of an attachment. Drives how the UI previews it and how
 *  the AI is allowed to consume it: an `image` can be *seen* by a vision model,
 *  a `text` document can be *read* inline, while `model`/`document`/`other`
 *  binaries can generally only be referenced by name + type. */
export type AttachmentKind = 'image' | 'model' | 'document' | 'text' | 'other';

export const ATTACHMENT_KINDS: readonly AttachmentKind[] = ['image', 'model', 'document', 'text', 'other'];

/** Legacy display shape — every reference image was historically `{id, src, label?}`.
 *  Retained as the *read* shape used by display/sort helpers; the persisted and
 *  in-memory shape is the richer {@link SessionAttachment} below, which extends
 *  it with the `kind`/`mediaType` metadata. */
export interface AttachedImage {
  id: string;
  /** data URL or remote URL — the payload. */
  src: string;
  /** User-facing caption. */
  label?: string;
}

/** A typed session attachment. Superset of {@link AttachedImage}: old image
 *  rows migrate forward by gaining `kind: 'image'`. */
export interface SessionAttachment extends AttachedImage {
  /** Coarse category. */
  kind: AttachmentKind;
  /** MIME type when known (e.g. `image/png`, `model/stl`, `text/markdown`). */
  mediaType?: string;
  /** Free-form note describing WHY this attachment matters — what to match, the
   *  constraint it captures, the source it came from. Distinct from `label`
   *  (a short caption / perspective preset): the description is the durable
   *  context the AI reads back. */
  description?: string;
  /** Epoch ms when the attachment was added — lets the UI/AI reason about
   *  staleness (a reference photo can age out of relevance). */
  addedAt?: number;
  /** Provenance: `'user'` = added in the Attachments panel; `'chat'` =
   *  captured from a file uploaded in the AI chat drawer. */
  source?: 'user' | 'chat';
}

/** Map a file extension (no dot, lowercased) to a MIME type, for the cases the
 *  browser doesn't hand us one (remote URLs, some drag-drops). */
const EXT_MEDIA_TYPE: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
  stl: 'model/stl', step: 'model/step', stp: 'model/step', '3mf': 'model/3mf',
  obj: 'model/obj', gltf: 'model/gltf+json', glb: 'model/gltf-binary',
  pdf: 'application/pdf',
  md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain',
  csv: 'text/csv', json: 'application/json', scad: 'text/plain', svgz: 'image/svg+xml',
};

/** Extract a lowercased extension from a filename, URL path, or label. */
function extOf(s: string | undefined): string {
  if (!s) return '';
  // Strip query/hash, then take the final path segment's extension.
  const path = s.split(/[?#]/)[0];
  const seg = path.split('/').pop() ?? '';
  const dot = seg.lastIndexOf('.');
  return dot >= 0 ? seg.slice(dot + 1).toLowerCase() : '';
}

/** Best-effort MIME type from a data URL prefix, a URL/filename extension, or a
 *  label. Returns undefined when nothing can be determined. */
export function inferMediaType(src: string | undefined, label?: string): string | undefined {
  if (src && src.startsWith('data:')) {
    const semi = src.indexOf(';');
    const comma = src.indexOf(',');
    const end = semi >= 0 ? semi : comma;
    const mt = end > 5 ? src.slice(5, end) : '';
    if (mt) return mt;
  }
  const ext = extOf(label) || extOf(src);
  return ext ? EXT_MEDIA_TYPE[ext] : undefined;
}

/** Classify into one of the coarse {@link AttachmentKind} buckets from whatever
 *  is known (MIME type, src/data URL, and/or label). */
export function inferAttachmentKind(mediaType: string | undefined, src?: string, label?: string): AttachmentKind {
  const mt = (mediaType || inferMediaType(src, label) || '').toLowerCase();
  if (mt.startsWith('image/')) return 'image';
  if (mt.startsWith('model/')) return 'model';
  if (mt === 'application/pdf') return 'document';
  if (mt.startsWith('text/') || mt === 'application/json') return 'text';
  // Fall back to extension for binaries the MIME table didn't cover.
  const ext = extOf(label) || extOf(src);
  if (['stl', 'step', 'stp', '3mf', 'obj', 'gltf', 'glb'].includes(ext)) return 'model';
  if (ext === 'pdf') return 'document';
  if (['md', 'markdown', 'txt', 'csv', 'json', 'scad'].includes(ext)) return 'text';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(ext)) return 'image';
  return 'other';
}

/** Fill in the typed fields of an attachment from a loose/legacy partial. Pure:
 *  the caller supplies a fallback id (and may pass `addedAt`/`source`). Used by
 *  the read-time migration and by every construction site, so `kind`/`mediaType`
 *  are always populated consistently. */
export function normalizeAttachment(
  partial: { id?: string; src: string; label?: string; description?: string; kind?: AttachmentKind; mediaType?: string; addedAt?: number; source?: 'user' | 'chat' },
  fallbackId: string,
): SessionAttachment {
  const mediaType = partial.mediaType || inferMediaType(partial.src, partial.label);
  const kind = partial.kind || inferAttachmentKind(mediaType, partial.src, partial.label);
  const out: SessionAttachment = {
    id: partial.id || fallbackId,
    src: partial.src,
    kind,
  };
  if (mediaType) out.mediaType = mediaType;
  const label = partial.label?.trim();
  if (label) out.label = label;
  const description = partial.description?.trim();
  if (description) out.description = description;
  if (typeof partial.addedAt === 'number') out.addedAt = partial.addedAt;
  if (partial.source) out.source = partial.source;
  return out;
}

/** Short human-readable noun for a kind, for UI badges and AI manifests. */
export function attachmentKindLabel(kind: AttachmentKind): string {
  switch (kind) {
    case 'image': return 'Image';
    case 'model': return 'Model';
    case 'document': return 'Document';
    case 'text': return 'Text';
    default: return 'File';
  }
}
