---
session: "a7f3c2"
timestamp: "2026-06-07T23:14:31Z"
sequence: 10
---

## Human

PR #495 CI: three e2e tests failed (import-merge-url ×2, ai-cli-bridge, and
language-help-modal) after the modalShell close-button aria-label change.

## Assistant

## Key decisions

**Root cause**: my fix gave the shared modal close ✕ an accessible name derived
from the modal title (`aria-label="Close <title>"`). That name *contains* the
title and the word "Close", so Playwright's substring role-name queries matched
the ✕ in addition to their intended target:
- `getByRole('button', { name: 'Import' })` matched "Close **Import** from URL".
- `getByRole('button', { name: 'Close' })` matched the ✕ *and* the AI-settings
  footer's own "Close" button.
- `getByLabel('Pick a modeling language')` matched the ✕ *and* the dialog.

These are real ambiguities (two controls sharing a name in one dialog), not just
test brittleness.

**Fix**: give the ✕ a distinct accessible name — `aria-label="Dismiss"` — that
doesn't shadow footer action buttons or title substrings. The dialog is already
named via `aria-labelledby`, so "Dismiss" is still correct, descriptive a11y;
`title="Close"` keeps the familiar tooltip for sighted users. Verified all four
previously-failing tests pass locally (import-merge-url, ai-cli-bridge-setup,
language-help-modal) plus a clean build. Chose a new label over editing the
tests because the duplicate-name was a genuine smell and touching unseen tests
across shards would have been fragile.
