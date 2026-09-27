import { afterEach, describe, expect, it, vi } from "vitest";

async function freshConfig() {
  vi.resetModules();
  return import("./config");
}

describe("config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("should strip a trailing slash from the asset base", async () => {
    vi.stubEnv("PUBLIC_ASSET_BASE", "https://images.cantusorgani.org/");
    expect((await freshConfig()).ASSET_BASE).toBe("https://images.cantusorgani.org");
  });

  it("should fall back to the local path when no asset base is configured", async () => {
    vi.stubEnv("PUBLIC_ASSET_BASE", "");
    expect((await freshConfig()).ASSET_BASE).toBe("/systems");
  });

  it("should leave the Turnstile key empty rather than inventing one", async () => {
    vi.stubEnv("PUBLIC_TURNSTILE_SITE_KEY", "");
    expect((await freshConfig()).TURNSTILE_SITE_KEY).toBe("");
  });

  it("should cap exports at three hundred systems, sized from ~12 KB slices", async () => {
    expect((await freshConfig()).EXPORT_CEILING).toBe(300);
  });
});
