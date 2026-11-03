---
session: "ad71db73"
timestamp: "2026-11-02T18:15:00Z"
---

## Human

I don't want to reference or accidentally include content that belongs to an
asset (or TV show, etc.) whose license doesn't allow this use; this is a free
and open site. Add rules for that, and audit the content flagged as possibly
third-party.

## Assistant

## Key decisions

**Rules in CLAUDE.md, not just a one-off cleanup.** Most of what had to be
scrubbed came from one habit: agents committing, screenshotting or naming
whatever file a user handed them. The new "Third-party content" section says
a user's file is permission to work on it, not to publish it. It also covers:
- test and demo with shareable content
- no recognisable characters or brands in shipped content, including data
  derived from a model
- source and license recorded for any third-party file that is committed
- nothing of a user's third-party model on GitHub

The Visual proof section points to it, because screenshots were the main way
images leaked.

**Audit findings:**
- Fixed here: 3DBenchy's text, which still cited CC BY-ND although the model
  has been CC0 since February 2025.
- Correctly attributed already: Dummy 13 (CC BY 4.0).
- Left for the owner to decide (they need a judgement or a source only the
  owner has):
  - two game-character catalog entries
  - the captured hair preset, which is derived from a third-party figurine scan
  - the creature example
  - eval reference photos fetched from Wikimedia Commons with no attribution
    recorded
  - the cat reference photos, which came from the owner
  - committed armor STLs whose source isn't recorded
