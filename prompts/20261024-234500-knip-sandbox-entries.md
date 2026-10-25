---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T23:45:00Z"
tools: [knip]
sequence: 2
---

## Human

Do both option 1 and option 2 as separate PRs and also test the option 2
performance. (CI follow-up on the iframe-sandbox PR.)

## Assistant

- The static-analysis job failed: knip's gated "unused files" category flagged
  `src/sandbox/sandboxMain.ts` and `src/sandbox/sandboxWorker.ts`.
- Neither file is really unused. One is loaded by `sandbox.html`; the other is
  dynamic-imported from a blob-Worker bootstrap string. Knip can't trace either
  path.
- Declared both as knip entries. Listing `sandbox.html` itself didn't resolve
  its script, so the TS files are listed directly. This also clears the protocol
  constants knip had reported as unused exports.
