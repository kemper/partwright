---
session: "0ejjep"
timestamp: "2026-06-20T19:40:00Z"
---

## Human

If somebody attaches an image to an AI session in the rightmost pane, can I
capture it into the project's image list? And does it even make sense to have
"rough" reference images — I want past reference images to survive an AI history
clear, but some refs age out of relevance. (After discussion:) Implement the
reference-image list as a generalized "attachments" feature with enum kind
types. Make sure in-app AI sessions have tools to fetch past attachments, and
that AI-panel file uploads/attachments are saved as attachments on the
project/session.

## Assistant

## Key decisions

**Generalized the per-session "reference images" list into typed
**attachments** rather than adding a parallel system.** The app already had a
durable, exported, AI-readable image list (`Session.images` + the Images tab +
the `getReferenceImages` tool). The right move was to widen that, not invent a
second store. Renamed the persisted field `Session.images` → `Session.attachments`
holding `SessionAttachment` = the old `{id, src, label}` plus
`kind` (`image | model | document | text | other`), optional `mediaType`,
`addedAt`, and `source` (`'user' | 'chat'`).

**Put the types + classification in a dependency-free leaf
(`src/storage/attachment.ts`).** `inferMediaType`/`inferAttachmentKind`/
`normalizeAttachment` are pure and imported by both the storage layer (db.ts) and
the renderer's in-memory holder (multiview.ts) without adding a module cycle
(`lint:deps` stays acyclic). The renderer already imported `presetIndex` from
storage, so the edge existed.

**Back-compat was the main constraint — old IndexedDB sessions and exported
`.partwright` files must still load.** Schema bumped 1.15 → 1.16. The existing
read-time `migrateSessionImages` already normalized three legacy image shapes
(`referenceImages`, object-map, `{angle}`); extended it to fold all of them —
plus pre-1.16 `images` — into typed `kind:'image'` attachments via
`normalizeAttachment`. Export writes `attachments`; import reads
`attachments ?? images ?? referenceImages`. `updateSession` strips both legacy
keys on write.

**Kept the image-named API/UI as back-compat over the generalized store.**
`getImages()` returns image-kind only; `setImages`/`clearImages` touch only
image-kind attachments and preserve non-image ones; added
`getAttachments`/`addAttachment`/`setAttachments`/`removeAttachment`/
`clearAttachments`. All went into the `help()` table (and came off the
apiParity `UNDOCUMENTED_BACKLOG`), closing the long-standing parity gap for the
image methods at the same time.

**AI parity (the two explicit asks):**
- New `getAttachments` tool returns a text manifest of every attachment
  (kind/mediaType/label/addedAt/source), inlines `text`-kind contents, and points
  the model at `getReferenceImages` to actually *view* images. Added to
  `ALWAYS_AVAILABLE` + `RETRY_SAFE_TOOLS`. `getReferenceImages` stays the
  image-viewing path (now image-kind-filtered).
- AI-panel image uploads (`attachImageSource`: paste / drag-drop / picker) now
  also pin to the session as a `source:'chat'` image attachment (deduped by src,
  no-op without a real session), so they survive `/clear`.

**UI:** the tab is now "Attachments" (📎); non-image attachments render as a
file card with a type icon + media type, and every tile carries a kind badge.
File upload `accept` widened from `image/*` to any file.

**Deliberately deferred to a follow-up (noted in PR):** attachment *bytes* still
live inline as data URLs on the session (and thus in exports/share links), same
as images always did. Phase 3 — moving binary payloads to a separate blob store
and stripping large binaries from `trimForShare` — is a separate change.

Verified: `npm run preflight` (1552 unit tests, no type errors, no cycles), a new
`tests/unit/attachment.test.ts` for the pure helpers, a new
`tests/attachments.spec.ts` golden-path e2e (mixed kinds, the tool manifest, the
typed tiles), plus the existing getReferenceImages / share-link / import-export
specs for back-compat, and an eyes-on screenshot of the Attachments tab.
