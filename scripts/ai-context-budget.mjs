#!/usr/bin/env node
// `npm run ai:budget` — print the in-app AI's turn-0 context report (system
// prompt, suffix, tool schemas by group, heaviest tools, largest ai.md
// sections). The numbers and ceilings live in tests/unit/aiContextBudget.test.ts,
// which also gates them in the unit tier.
import { spawnSync } from 'node:child_process';

const r = spawnSync('npx', ['vitest', 'run', 'tests/unit/aiContextBudget.test.ts', '--reporter=dot', '--silent=false'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, AI_BUDGET_REPORT: '1' },
});
process.exit(r.status ?? 1);
