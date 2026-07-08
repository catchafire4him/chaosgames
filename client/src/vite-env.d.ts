/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Neon Auth base URL (…/neondb/auth) for optional player accounts. */
  readonly VITE_NEON_AUTH_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
