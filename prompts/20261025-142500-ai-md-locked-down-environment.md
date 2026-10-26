---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-25T14:25:00Z"
tools: []
sequence: 3
---

## Human

Would 1119 [explain itself] if a user tried to do something wrong? What message
do they see? ... add the ai.md line.

## Assistant

- Blocked APIs fail with ordinary JS errors: `fetch is not a function`,
  `X is not defined`, or reading `.open` of undefined. Only `importScripts` and
  the `URL` blob statics say "disabled in the geometry sandbox". So an AI author
  could mistake a deliberate block for a missing API and try to work around it.
- Added a short "Locked-down environment" note at the top of the model-code
  section of `public/ai.md`. It lists what is available, gives the error shapes
  to recognise as deliberate blocks, and points to the supported ways to get
  data in: imports, params, and the console API.
