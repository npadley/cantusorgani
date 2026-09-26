/// <reference types="astro/client" />

// The build's public configuration (web/.env, mounted from 1Password). Only
// PUBLIC_ variables reach the site; the R2 keys in the same file are for the
// pipeline and are never referenced here.
interface ImportMetaEnv {
  readonly PUBLIC_ASSET_BASE?: string;
  readonly PUBLIC_TURNSTILE_SITE_KEY?: string;
  readonly PUBLIC_CORRECTIONS_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
