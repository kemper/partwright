// Pure, browser-API-free helpers for the "Import from URL…" flow.
//
// The flow accepts EITHER:
//   (a) a Partwright share link (a full URL whose hash is `#share=…`, or a raw
//       `#share=…` fragment) — decoded locally with NO network, OR
//   (b) an http(s) URL to a remote file (.json / mesh / image / etc.) that the
//       app fetches and routes through the existing data-import paths.
//
// Everything here is deterministic string logic so it can be unit-tested
// without a DOM, network, or IndexedDB. The actual `fetch`, share decode, and
// `File`-wrapping live in the caller (src/main.ts), which owns the side effects.

import { classifyImportSource, type ImportSource } from './importInbox';

/** Result of classifying a raw "Import from URL" text input. */
export type ImportUrlParse =
  | { kind: 'share'; hash: string }
  | { kind: 'remote'; url: string }
  | { kind: 'invalid'; reason: string };

/** Hard cap on a remote response we'll buffer (~25 MB). Enforced against
 *  `Content-Length` up front and against the streamed byte count as a backstop
 *  for servers that omit or lie about the header. */
export const MAX_REMOTE_BYTES = 25 * 1024 * 1024;


/**
 * Classify a trimmed user input string into a share link, a remote http(s)
 * URL, or an invalid input with a human-readable reason.
 *
 * Share detection comes first: a `#share=…` fragment (raw or embedded in any
 * URL) is always treated as a local share decode, never a network fetch — even
 * if the URL also has an http(s) scheme. Only `http:` / `https:` are accepted
 * for the remote path; `file:`, `data:`, `blob:`, `javascript:` and friends are
 * rejected so the fetch path can't be pointed at a local or inline resource.
 */
export function parseImportUrlInput(raw: string): ImportUrlParse {
  const input = raw.trim();
  if (!input) return { kind: 'invalid', reason: 'Enter a URL or share link.' };

  // A raw `#share=…` fragment (no scheme/host) — local share decode.
  if (input.startsWith('#share=')) {
    const hash = input.slice('#share='.length);
    return hash.length > 0
      ? { kind: 'share', hash }
      : { kind: 'invalid', reason: 'That share link is empty.' };
  }

  // Try to parse as an absolute URL. A bare `#share=…` is handled above; a
  // relative input (no scheme) is rejected — we need an absolute http(s) URL.
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { kind: 'invalid', reason: 'That doesn’t look like a valid URL.' };
  }

  // Share link embedded in a full URL — decode locally regardless of scheme.
  if (url.hash.startsWith('#share=')) {
    const hash = url.hash.slice('#share='.length);
    return hash.length > 0
      ? { kind: 'share', hash }
      : { kind: 'invalid', reason: 'That share link is empty.' };
  }

  // Remote fetch path — only http(s). Reject file:, data:, blob:, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      kind: 'invalid',
      reason: `Only http(s) URLs or share links are supported (got "${url.protocol}").`,
    };
  }

  return { kind: 'remote', url: url.toString() };
}

/** Derive a sensible filename from a remote URL's path, falling back to a
 *  generic name when the path has no usable last segment. */
export function filenameFromUrl(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return 'import';
  }
  const last = pathname.split('/').filter(Boolean).pop() ?? '';
  // Strip query-ish residue and decode percent-encoding for a readable name.
  let name = last;
  try {
    name = decodeURIComponent(last);
  } catch {
    // keep the raw segment if it isn't valid percent-encoding
  }
  return name || 'import';
}

/**
 * Decide which import path a fetched remote resource should take, given the
 * URL-derived filename and the response `Content-Type`. The filename's
 * extension is authoritative (it's what `handleImportFile` keys off), so we try
 * it first; only when the URL carries no recognizable extension do we sniff the
 * Content-Type as a fallback. Returns null when neither yields a supported type.
 */
export function classifyRemoteResource(
  filename: string,
  contentType: string | null,
): ImportSource | null {
  const byName = classifyImportSource(filename);
  if (byName) return byName;

  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!ct) return null;
  if (ct === 'application/json' || ct === 'text/json') return 'JSON';
  if (ct === 'model/stl' || ct === 'application/sla' || ct === 'application/vnd.ms-pki.stl') return 'STL';
  if (ct === 'model/step' || ct === 'application/step' || ct === 'application/p21') return 'STEP';
  if (ct === 'image/svg+xml') return 'SVG';
  if (ct.startsWith('image/')) return 'IMAGE';
  return null;
}

/** A best-effort filename with an extension matching the resolved source, so
 *  `handleImportFile` (which keys off the extension) still routes a
 *  Content-Type-classified resource correctly even when the URL had no
 *  extension. No-op when the filename already classifies the same way. */
export function ensureExtensionForSource(filename: string, source: ImportSource): string {
  if (classifyImportSource(filename) === source) return filename;
  const ext: Record<ImportSource, string> = {
    JSON: '.json', JS: '.js', SCAD: '.scad', STL: '.stl',
    STEP: '.step', SVG: '.svg', VOX: '.vox', IMAGE: '.png',
  };
  const base = filename && filename !== 'import' ? filename : 'import';
  return base + ext[source];
}
