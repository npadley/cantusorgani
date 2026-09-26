import { describe, expect, it } from "vitest";

import { publicEntries } from "./publicEnv";

describe("publicEntries", () => {
  it("should keep PUBLIC_ variables and drop every other variable", () => {
    const text = [
      "R2_ACCOUNT_ID=abc",
      "R2_SECRET_ACCESS_KEY=never-in-the-build",
      "PUBLIC_ASSET_BASE=https://images.example.org",
      "PUBLIC_TURNSTILE_SITE_KEY=0x4AAA",
    ].join("\n");
    expect(publicEntries(text)).toEqual({
      PUBLIC_ASSET_BASE: "https://images.example.org",
      PUBLIC_TURNSTILE_SITE_KEY: "0x4AAA",
    });
  });

  it("should unquote values and ignore comments, blank lines and export", () => {
    const text = [
      "# public build config",
      "",
      'export PUBLIC_A="quoted # not a comment"',
      "PUBLIC_B='single'",
      "PUBLIC_C=bare # trailing comment",
      "not a variable line",
    ].join("\r\n");
    expect(publicEntries(text)).toEqual({
      PUBLIC_A: "quoted # not a comment",
      PUBLIC_B: "single",
      PUBLIC_C: "bare",
    });
  });

  it("should return nothing for an empty file", () => {
    expect(publicEntries("")).toEqual({});
  });
});
