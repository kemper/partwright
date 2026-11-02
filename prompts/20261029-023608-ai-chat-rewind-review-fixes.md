---
session: "01QnZGNP"
timestamp: "2026-10-29T02:36:08Z"
sequence: 2
---

## Human

(Follow-up within the same request: drive the rewind-transport PR to green;
an internal review pass flagged issues.)

## Assistant

## Key decisions

**Keep the rewound slice across same-session reloads.** Clearing the stack in
`loadHistoryForCurrentSession` lost a fully-rewound chat on the next
`saveVersion`/version load (setActiveSession reloads when history is empty).
Now cleared only when the read is for another session, or on a peer-tab edit.
Making it survive refresh/navigation needs soft-delete — filed as #1203 rather
than widening this PR.

**Chapter cut at a queued follow-up keeps its tool results.** Instead of
cutting the carrier and letting repair invent an "interrupted" error result,
`planRewind` strips only the human text; the original carrier leads the entry
and a restore replaces it by id.

**Exclusive, write-first edits.** `withRewindLock` serialises rewinds/restores
and blocks Send/Resume meanwhile; IndexedDB writes happen before memory/stack
change, and a failed write toasts and re-reads history from IndexedDB.

**Plan-aware continuation.** Resume / Keep going / Retry drop plan-mode's
read-only tool list once the plan was approved (`continuationToggles`), as
approvePlan already does; Resume also honours the spend cap. A plan request
whose reply was rewound no longer shows an empty "Plan ready" bar.

Smaller: ownership change refreshes the transport, a manual review posted
while rewound discards the slice, banner counts per entry, and the ephemeral
predicate is shared with historyRepair instead of duplicated.
