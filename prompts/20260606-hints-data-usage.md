---
session: "serene-cray"
timestamp: "2026-06-06T22:40:00Z"
model: claude-opus-4-8
tools: [explore, Bash, Edit, Write, Read, AskUserQuestion]
---

## Human

Added a hint feature recently. Realized it'd be good to tell people they can
view and control all browser data usage and wipe all local data like API keys.
Update the hint list — and think of more things to add.

## Assistant

## Key decisions

**The Data tab is the honest hub for the requested ask.** `tab-data`
(`switchTab('data')`, `src/ui/dataExplorer.ts`) browses every IndexedDB store +
localStorage with a "Total browser storage used" readout and a "Manage / delete
data…" link to the Uninstall modal (`showUninstallModal`, which wipes selectable
categories incl. `aiKeys`). So one hint with a `command` CTA to `tab-data`
covers both "view all browser data usage" and "wipe local data incl. API keys"
— rather than splitting across the Settings → Uninstall button (which has no
direct open command). Copy: "See exactly what Partwright stores in your browser
— and wipe it all, including AI API keys, anytime."

**Added four more underused-feature hints** (user selected all four from a
multi-select): `share-link` (read-only share link, `command` CTA), `inspect-tools`
(measure + cross-section — `coach` pointing at `#measure-toggle` inside the
`#viewport-inspect-group-btn` popover, mirroring the paint/surface coach
pattern), `export-formats` (`coach` at `#export-wrapper`, mirroring the import
hint), and `guided-tour` (`command` → `retake-tour`).

**Verification:** all CTA command ids (`tab-data`, `share-link`, `retake-tour`)
are in the unit test's `REGISTERED_COMMAND_IDS` mirror, and all coach selectors
were confirmed against the live DOM (popover button id convention is
`${id}-group-btn` from `createPopoverGroup` in `popoverMenu.ts`). Updated the
verified-targets comment block at the top of `hintsData.ts`. Ran the hints unit
test (7 passing), `npm run build`, and a throwaway Playwright spec that rotated
the ticker to the data-usage hint and confirmed its CTA opens the Data tab
(screenshots posted in chat, scratch spec deleted).
