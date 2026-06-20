---
date: 2026-06-20
branch: claude/wonderful-einstein-qrp65q
files_changed:
  - src/publish/publishTargets.ts
  - src/ui/publishModal.ts
  - src/main.ts
  - public/ai.md
  - public/ai/file-io.md
  - tests/unit/publishTargets.test.ts
  - tests/publish.spec.ts
---

## Human

Can I add a feature to auto-release a model to Printables or Bambu MakerWorld
(maybe others like Thangs and Thingiverse)? What do you suggest? — then: "I like
the assisted publish idea. Let's do it. I won't be making a backend yet."

## Assistant

Researched each platform's API first because that's the crux: only Thingiverse
has a sanctioned write API, and even that needs a server to hold the OAuth client
secret + proxy CORS. Printables, MakerWorld, and Thangs have **no** public upload
API (bots are actively blocked on Printables; MakerWorld's own answer is "import
from Printables/Thingiverse"). Partwright is a pure static site with no backend,
so true auto-publish is off the table without a Cloudflare Function — which the
user explicitly deferred.

So I built the **assisted-publish** tier: it can't POST for the user, but it
prepares the publish end-to-end. The flow downloads the model file in the
platform's preferred format (3MF where colour matters, STL otherwise), downloads
a rendered cover PNG, copies a title/description/tags block to the clipboard, and
opens the platform's upload page in a new tab — turning "publish" into "drop the
file, paste, done." Zero backend, ToS-clean (no API scraping), CSP already
permits it.

Design decisions:
- **`src/publish/publishTargets.ts`** is dependency-free (data + string helpers)
  so it unit-tests in the node tier: target metadata (id/label/uploadUrl/accepted
  formats/notes), `recommendedFormat` (= first accepted), tag parsing, default
  description with an optional size line + credit, and the clipboard composer.
- **`src/ui/publishModal.ts`** is the DOM shell on the shared `modalShell` +
  `BUTTON_*` constants + `showToast` (no parallel messaging). File/cover building
  and download are passed in as callbacks so the modal doesn't reach into
  `main.ts`'s mesh closures.
- **UI ↔ API parity** (a core repo norm): added `partwright.publish(platform?)`
  validated with `assertString` + a platform allow-list (returns `{ error }` on
  bad input, never throws), registered it in `help()`, documented it in `ai.md`
  and `ai/file-io.md`, and added the "Publish to a print site…" command-palette
  entry. It's inherently assisted (needs DOM + clipboard + a new tab), so there's
  no in-app AI tool — the modal IS the surface.

Scoped to the single active model for this PR; multi-part publish and the
Thingiverse real-API path (needs the deferred backend) are natural follow-ups.

Verified: typecheck, full unit tier (1514 pass) incl. the new
`publishTargets.test.ts`, `lint:deps` (no cycle), and an e2e golden-path spec
(`tests/publish.spec.ts`) that opens the modal, switches platform, asserts the
file download + window.open + clipboard, and rejects an unknown platform id.
Eyes-on screenshot of the modal posted in chat.

Follow-up (same session): the user expected the entry point in the Export
menu, not just the command palette — so added a "Publish to a print site…"
item to the toolbar Export dropdown's Project section (under "Share link…"),
wired through a new `onPublish` toolbar callback, with an e2e assertion guarding
the menu path.

Follow-up 2 (same session), from user feedback:
- **Single ZIP instead of multiple downloads.** Separate model + cover downloads
  tripped the browser's "open multiple files?" prompt. Reworked the flow to bundle
  the model file + `cover.png` + `details.txt` into one ZIP (`buildZip`,
  STORE method) — `buildBundle` replaced the per-file `buildFile`/`buildCover`
  callbacks in the modal context.
- **MakerWorld → Bambu/Orca 3MF.** Added a `3mf-bambu` `PublishFormat` that
  routes through `build3MFProject({bambu:true})` (same builder as the toolbar's
  Bambu export) for the single active model; it's MakerWorld's recommended format.
- **MakerWorld 404 fix.** `/en/upload` 404s because the real upload page is
  user-scoped (`/en/@<username>/upload`); pointed the target at the homepage
  (`https://makerworld.com/en`) where the "Upload" button lives, and said so in
  the modal note.
