// Dedicated Playwright config for the catalog generators in `generators/`.
// They re-use the runner's webServer + browser launch + viewport so they
// have access to the same `page` fixtures the e2e suite does, but live
// outside `tests/` so `npm run test:e2e` never picks them up.
//
// Invoked via `npm run generate:catalog`.

import { defineConfig } from 'playwright/test';
import baseConfig from './playwright.config';

export default defineConfig({
  ...baseConfig,
  testDir: './generators',
  testMatch: '**/*.ts',
});
