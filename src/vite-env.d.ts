/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Engine-sandbox default mode for this build: 'off' | 'opaque' | 'origin' (docs/engine-sandbox.md). */
  readonly VITE_ENGINE_SANDBOX?: string;
  /** Origin the 'origin'-mode sandbox frame is served from. */
  readonly VITE_SANDBOX_ORIGIN?: string;
  /** Comma-separated app origin(s) the sandbox frame accepts in 'origin' mode. */
  readonly VITE_APP_ORIGIN?: string;
}
