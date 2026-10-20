import { defineConfig } from 'vitest/config';

// Fast unit tier: pure-logic modules that need no browser, DOM, or WASM.
// Node 22's native fetch/Response/Blob/ReadableStream cover fetch-stubbing
// tests too (see tests/unit/aiGemini.test.ts, aiOpenai.test.ts,
// aiAnthropic.test.ts, aiCustom.test.ts) — only modules that touch IndexedDB,
// localStorage-backed singletons without a try/catch fallback, or the real
// DOM stay in the Playwright e2e suite as a `page.evaluate` test — see
// tests/ai-autoresume.spec.ts and tests/ai-transient-retry.spec.ts, which
// drive chatLoop's IndexedDB-backed persistence. Keep this runner
// dependency-free and instant.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
