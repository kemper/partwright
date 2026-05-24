import { defineConfig } from 'vitest/config';

// Fast unit tier: pure-logic modules that need no browser, DOM, or WASM.
// Anything that depends on browser APIs (fetch stubbing, IndexedDB, the real
// DOM) stays in the Playwright e2e suite as a `page.evaluate` test — see
// tests/ai-providers.spec.ts. Keep this runner dependency-free and instant.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
