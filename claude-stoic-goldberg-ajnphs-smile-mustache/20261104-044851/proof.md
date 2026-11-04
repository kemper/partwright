`api.human({ body: { gender: 1 }, expression: 'laugh', hair: { style: 'short', beard: 'goatee' } })`, front view, zoomed on the mouth.

| Before (main) | After (this PR) | Neutral face (reference) |
|---|---|---|
| ![before](laugh-before.png) | ![after](laugh-after.png) | ![neutral](neutral-reference.png) |

Before, the lifted upper lip splits the mustache into two thin drips. After, the mustache keeps its neutral shape, carried onto the smile.
