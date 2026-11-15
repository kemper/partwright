---
session: "b01bd443"
timestamp: "2026-11-15T04:45:00Z"
model: claude-opus-5-5
---

## Human

"Proceed with the next step using a stacked PR" — Stage A of the image-tools
plan (#1256): import an image once, apply tools as stored operations.

## Assistant

## Key decisions

**The operation record lives in the object's code** as a header comment,
`// @image-tool {"tool","image","params"}`. Code already persists, versions
and exports with the session, so no schema migration; it's also halfway to
Stage B, where the header becomes a real `api.*` call with the same params.
A layered print needs no header — its `api.layeredPrint(api.image(id))` call
is already the record.

**Tools reuse the existing generators and wizards** (relief wizard, voxel
modal, layered-print dialog) pre-loaded from the attachment. Each launch
passes its target (attachment id + new-object vs replace) through the
wizard's own callbacks rather than a global "pending" flag a cancelled
wizard could leak into a later import. Re-apply replaces the open object via
the existing import helpers (a new version; undo = version history).

**API/AI parity**: `applyImageTool` (same-tool re-apply merges params over the
stored ones, so an agent can tweak one setting at a time), `getImageToolOp`,
`listImageTools`, `openImageTools`; Import → Image tools… and a palette entry.

Stacked on #1249 (needs `api.image` + layered-print code), at the user's
request; CI won't run on the stacked PR, so affected specs ran locally.
