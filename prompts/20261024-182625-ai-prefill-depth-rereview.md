---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T18:26:25Z"
model: claude-opus-5-5
sequence: 3
---

## Human

PR6 re-review (no blockers). Should-fix items:
- "https-only" still lets an AI image src reach localhost or the LAN, either by
  redirect or because a local https host is accepted directly.
- Image attachments with same-origin or blob: data are refused.

Nits:
- A duplicate assertion in the e2e spec.
- SVG rendering ignores the pixel cap.
- Paint notes fire even when the part scope dropped the region.
- The fetch network-error text isn't caller-controlled.
- Modal tools bind to an unrelated docked panel.
- Add a screenshot of the muted app-note line.

## Assistant

## Key decisions

**Block local targets before any request, and never follow redirects.** The
post-response scheme check runs too late, because a redirected request has
already fired. `RemoteFetchOptions` gained `redirect`, `allowedProtocols` and
`networkErrorMessage`, and Import from URL keeps its defaults (follow,
http/https, the old text). The prefill path uses `redirect: 'error'`, accepts
https only, and rejects local hosts up front via a new pure
`isLocalOrPrivateHost`. It blocks localhost / `*.localhost`, `.local`,
127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 0/8, ::1, ::, fc00::/7,
fe80::/10, and IPv4-mapped forms. Because the check runs on
`new URL().hostname`, numeric-IP spellings like `127.1` and `0x7f000001` are
already canonicalised.

**Attachments may be same-origin or blob:.** For attachments only, a
same-origin or this-page `blob:` URL is accepted. It loads through `<img>` and
canvas (img-src allows `'self'` and `blob:`; connect-src doesn't allow blob:),
with the pixel cap checked before drawing. A typed src is still limited to
data:image or a public https URL.

**Smaller fixes.**
- An SVG renders at no more than the pixel cap.
- `commitBrushStroke` / `commitSlab` return whether a region survived the part
  scope, and the bucket path uses `dropIfClippedEmpty`'s result. Paint notes
  fire only for real paint.
- The registry binds an AI-opened tool to a docked panel only when its open
  produced that panel (or the tool was already open in it). Modal tools bind
  to null.
- A new e2e test seeds a transcript and checks the
  `[UI · app note]` line renders muted rather than as a blue user bubble.
  That test captures the screenshot.
