Headless renders (`model:preview`'s renderer, zoomed), before (#1167's head) and after (this PR).

**Tank tops and the cuirass.** A sleeveless top keeps straps over the shoulders, with a scoop neck; necklines run round the neck. The cuirass's top edge falls from the neck to the shoulder: no more points standing up the slope. Rows: `{ item: 'top', sleeve: 'none' }`, then a cuirass over a tshirt.

| Before | After |
|---|---|
| ![tops before](tops-before.png) | ![tops after](tops-after.png) |

**Beard and an open jaw.** The beard below the mouth rides the jaw, and the lips' bare patch is centred on the lips. Rows: jaw closed, then `jawOpen: 1`.

| Before | After |
|---|---|
| ![beard before](beard-before.png) | ![beard after](beard-after.png) |

**Toy and anime faces.** Funko: no nose, and at most a small mouth shape. `blinkL: 1` closes a sculpted eye to a lid line; `blinkR: 0.5` (anime) squashes it.

| Before | After |
|---|---|
| ![funko before](funko-before.png) | ![funko after](funko-after.png) |
| ![anime before](anime-before.png) | ![anime after](anime-after.png) |
