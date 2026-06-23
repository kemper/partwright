# Scope (capture a multi-deliverable session before it leaks)

Capture the **full intended set of work** the moment you recognize a request fans out into more than one deliverable — in a durable place that outlives the chat. This is the front-half counterpart to `/retro` and `/issue-reconcile`: it records the *plan* at the start, so the *outcome* checks have something to reconcile against.

## Why this exists

The #1 way work is lost: a dynamic session fans out into 3–4 intended deliverables, the first becomes a PR and merges, and the rest — which lived only in the conversation — evaporate when the session ends or its context compacts. Every other durable mechanism in this repo (prompt logs, retros, the close-out nudge) writes at the *end* of work. Nothing records the plan at the *start*. That's the gap this fills.

## When to use it

- The moment the work clearly has **≥2 deliverables** (e.g. "add the modifier, then wire it into the panel, then document it" — or a request that obviously splits into several PRs).
- **Skip it for genuinely single ad-hoc tasks.** Don't open a tracking issue for one-PR work — that's the friction the fast chat flow is meant to avoid. The carve-out in CLAUDE.md's *Issue hygiene* still holds: no issue required before single ad-hoc work.
- If you're unsure whether it's multi-part, it probably is — capturing costs one issue; losing a deliverable costs a whole re-discovery.

## What it does — one tracking issue per session, not per task

Keep the granularity **low**: open **one** umbrella issue for the whole session's intent, not one issue per deliverable.

1. Open a GitHub issue titled `[tracking] <session intent>` (the `[tracking]` title prefix needs no label setup; add a `tracking` label too if one exists).
2. Body is a **task-list checklist** of the intended deliverables, each a short phrase:

   ```
   Session intent: <one line>.

   - [ ] <deliverable 1>
   - [ ] <deliverable 2>
   - [ ] <deliverable 3>

   Each deliverable's PR refs this issue and ticks its box. This issue closes
   only when every box is ticked — unchecked boxes are the next session's pickup.
   ```
3. As each deliverable lands, its PR **refs this issue** (`Refs #N`) and carries a scope manifest in its body (see CLAUDE.md → *Commit & PR Conventions*). Tick the box when it merges.
4. **Never close the tracking issue with unchecked boxes.** Leftovers stay visible as the pickup list; the weekly `/issue-reconcile` sweeps anything that stalled.

## Lighter-weight fallback

If a full tracking issue feels heavy for a two-part change, the minimum is to put the **whole checklist in the first PR's body** as the scope manifest. That still makes the leftover visible at merge time and greppable by `/issue-reconcile`. But the issue is the durable anchor that survives a clean-tree session end — prefer it whenever the work spans more than one PR.

## Discipline

- One tracking issue per *session of work*, folding related deliverables together. Don't shard a session into a dozen issues — that's the over-granularity the user explicitly doesn't want.
- The tracking issue is a living checklist, not a spec. Keep deliverables as short phrases; detail belongs in the per-deliverable PRs.
- Update it as the plan changes — add a box for scope that emerges mid-session rather than letting it live only in chat.
