---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-25T13:30:00Z"
tools: [vitest, playwright]
sequence: 1
---

## Human

Do option 1 and spike the SES compartment. (While baselining main for that
work: main's staging gate is red.)

## Assistant

- Main's gate failed on `tests/surface-in-code.spec.ts:315`, the select scope
  test. The run fails with "malformed execute_result (surfaceOps scope kind must
  be label or point)".
- Cause: #1109's Worker→main validator (`checkSurfaceOp`) only knew the
  `label` and `point` surface scopes. #1111 landed alongside it and added a
  third, `{ kind: 'select', select: Selector }`. So legitimate
  `api.surface.*({ select })` results were rejected and the Worker recycled.
- Fix: accept `select`, limited to the `kind` and `select` keys, and pass it to
  `parseSurfaceOpts`, which re-parses it with `parseSelector`, the same
  validator the Worker uses. Also refuse `select` smuggled into `params`, as
  `label` and `region` already are.
- Unit tests: an accepted parsed selector; rejection of an empty selector, an
  extra scope key, and `select` passed inside params.
