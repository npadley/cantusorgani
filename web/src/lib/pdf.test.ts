import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_SYSTEMS, buildPdf, validateSelection } from "./pdf";

const SLICES = resolve(__dirname, "../../../build/systems");

/** Reads the real @2x.png slices the site would fetch from R2. */
async function fileFetcher(ref: string): Promise<ArrayBuffer> {
  const buffer = await readFile(resolve(SLICES, `${ref}@2x.png`));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

const MISSA_I_PAGE = ["noh5/0051/000", "noh5/0051/001", "noh5/0051/002",
                      "noh5/0051/003", "noh5/0051/004"];

describe("validateSelection", () => {
  it("refuses an empty selection with an actionable message", () => {
    expect(validateSelection(0)).toContain("Select at least one");
  });

  it("names how many to remove when over the cap", () => {
    const message = validateSelection(MAX_SYSTEMS + 7);
    expect(message).toContain(`Remove 7`);
    expect(message).toContain("two parts");
  });

  it("accepts a normal Mass-sized selection", () => {
    expect(validateSelection(34)).toBeNull();
  });
});

describe("buildPdf", () => {
  it("produces a valid PDF from real slices", async () => {
    const result = await buildPdf({
      refs: MISSA_I_PAGE, title: "Missa I", fetchPng: fileFetcher,
    });
    const header = new TextDecoder().decode(result.bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  });

  it("packs several systems onto one page rather than one per sheet", async () => {
    // One system per page would make a single Mass a 34-page download.
    const result = await buildPdf({
      refs: MISSA_I_PAGE, title: "Missa I", fetchPng: fileFetcher,
    });
    expect(result.pages).toBeLessThan(MISSA_I_PAGE.length);
    expect(result.pages).toBeGreaterThan(0);
  });

  it("reports progress for every system", async () => {
    const seen: number[] = [];
    await buildPdf({
      refs: MISSA_I_PAGE, title: "Missa I", fetchPng: fileFetcher,
      onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws rather than emitting a partial PDF when a slice is missing", async () => {
    await expect(buildPdf({
      refs: [...MISSA_I_PAGE, "noh5/9999/000"],
      title: "Missa I",
      fetchPng: fileFetcher,
    })).rejects.toThrow();
  });

  it("refuses an over-cap selection before fetching anything", async () => {
    let fetched = 0;
    await expect(buildPdf({
      refs: Array.from({ length: MAX_SYSTEMS + 1 }, (_, i) => `x/${i}`),
      title: "Too big",
      fetchPng: async (r) => { fetched += 1; return fileFetcher(r); },
    })).rejects.toThrow(/limited to 60/);
    expect(fetched).toBe(0);
  });
});
