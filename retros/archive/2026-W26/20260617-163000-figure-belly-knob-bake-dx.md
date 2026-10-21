# Retro — figure `belly` knob + dress-hem pendant fix

**Task:** Diagnosed a dress-colored pendant on the catalog Expectant Mother
(root cause: `buildTop`'s chest-ellipsoid bottom tip dangling below a low hem),
added a native `belly` rig knob so dresses drape over a pregnant bump
automatically, and refactored + re-baked the catalog entry. (PR #722)

## Liked
- `model:preview`'s isolate-and-measure loop (return just the `dress` region,
  read its bbox floor) pinned the defect to a number (floor 4.98 vs hem 10) in
  minutes, before touching any code. Empirical bisection >> staring at math.
- The figure builder's shared-source design (`torsoMasses` feeds body, navel,
  AND clothing coverage) meant one knob made the body swell, the navel ride it,
  and the dress drape — no extra wiring. Adding `belly` mirrored `bust` exactly.

## Lacked
- `scripts/build-catalog-entry.cjs` fails with a cryptic `API never appeared`
  when no dev server is running on :5173 — it doesn't auto-start one (unlike
  `playwright.config.ts`) and doesn't say "start `npm run dev` first." Burned a
  couple turns (and a red herring toward xvfb) before I read the script and saw
  the `BASE_URL` fetch. A clear error ("no dev server at :5173 — run npm run
  dev") or an auto-start would save the next agent the detour.

## Learned
- A `smoothIntersect(hemPlane)` applied to a whole garment also trims sleeves
  that hang below a high hem — the clip has to be scoped to the parts that own
  the hemline (shell + coverage), with sleeves unioned in afterward. The
  work-reviewer caught this; my own dress-only verification didn't because the
  catalog figure uses `sleeve:'none'`. Verify the *general* contract of a
  shared builder, not just the one model that motivated the change.

## Longed for
- A headless *colored* render in the fast loop. `model:preview` shades by normal
  (can't see label colors); confirming "is that the dress or skin showing?"
  needed the slow browser bake (which itself needs a dev server). A
  `model:preview --palette foo.json` that bakes label colors headlessly would
  close the last gap between the fast loop and the catalog bake.
