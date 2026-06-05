#!/usr/bin/env node
// partwright CLI entry point. See docs/headless-cli.md.
import { main } from '../scripts/cli/main.mjs';

main(process.argv.slice(2)).catch((e) => {
  console.error('partwright:', e?.stack || e?.message || e);
  process.exit(1);
});
