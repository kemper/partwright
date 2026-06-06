# Partwright — Spending Mode

The user sets a **budget** that controls how much compute/tokens the AI agent
should spend. **Read it at the start of a session and respect it:**

```js
partwright.getSpendingMode()
// -> { mode: "balanced", thinking: "off", verifyWithImages: true,
//      renderResolution: "medium", renderResolutionPx: 384,
//      verificationAngles: "auto", painting: false, sessionNotes: true,
//      maxIterations: "medium", maxSpendUsd: 2 }
```

`mode` is `"cheap"`, `"balanced"`, `"expensive"`, or `"custom"` (the user
hand-tuned the toggles). It maps to the in-app AI presets Minimal / Standard /
Full. It's also included in `getSessionContext().agentHints.spending`.

`setSpendingMode("cheap"|"balanced"|"expensive")` applies a preset — it sets
thinking, image verification, painting, session notes, and the iteration/spend
caps in one shot. The user can also adjust each knob individually in the AI
panel's toggle strip.

## Enforced by the app — you don't have to do anything, but know the limits

- **`renderResolution`** sets the **default** pixel `size` for `renderView()` /
  `renderViews()` (low=256, medium=384, high=512) when you don't pass one. Keep
  routine checks at the default; pass a larger `size` only for a deliberate
  final high-res inspection. (The hard budget guard is the USD spend cap.)
- **`painting`** — when `false`, the paint tools are removed from your tool list
  and the paint console API returns an error. Don't try to paint; tell the user
  to raise the budget if they want color.
- **`sessionNotes`** — when `false`, `addSessionNote` is removed from your tool
  list. The chat transcript already records your reasoning, so this just saves a
  round-trip; don't work around it.

## Advisory — adjust your own behavior to match

- **`thinking`** (`off`/`low`/`medium`/`high`) — when `off`, keep reasoning
  minimal and act directly.
- **`verifyWithImages`** — when `false`, reason from stats/code alone; render
  images sparingly only when the user explicitly needs a visual check.
- **`verificationAngles`** (`auto`/`tri`/`all`) — the default angle set for
  `renderViews()`; lower means fewer image tokens per check.
- **`maxIterations`** / **`maxSpendUsd`** — hard caps; the turn stops when either
  trips. Pace your tool calls so you finish useful work before the cap.

Honor the budget unless the user overrides it for a specific request.
