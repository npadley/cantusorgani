import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExsurgeLib } from "./exsurge";
import { loadExsurge, resetExsurgeLoader } from "./exsurgeLoader";

interface FakeScript { src: string; onload: (() => void) | null; onerror: (() => void) | null }

function stubDom(win: { exsurge?: ExsurgeLib }): FakeScript[] {
  const scripts: FakeScript[] = [];
  vi.stubGlobal("window", win);
  vi.stubGlobal("document", {
    createElement: () => { const s: FakeScript = { src: "", onload: null, onerror: null }; scripts.push(s); return s; },
    head: { appendChild: () => undefined },
  });
  return scripts;
}

const LIB = { marker: "lib" } as unknown as ExsurgeLib;

describe("loadExsurge", () => {
  beforeEach(() => resetExsurgeLoader());
  afterEach(() => vi.unstubAllGlobals());

  it("adds one script tag however many callers ask", async () => {
    const win: { exsurge?: ExsurgeLib } = {};
    const scripts = stubDom(win);
    const a = loadExsurge();
    const b = loadExsurge();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toBe("/vendor/exsurge/exsurge.min.js");
    win.exsurge = LIB;
    scripts[0]?.onload?.();
    await expect(a).resolves.toBe(LIB);
    await expect(b).resolves.toBe(LIB);
    expect(await loadExsurge()).toBe(LIB);
    expect(scripts).toHaveLength(1);
  });

  it("reuses window.exsurge without a script tag", async () => {
    const scripts = stubDom({ exsurge: LIB });
    await expect(loadExsurge()).resolves.toBe(LIB);
    expect(scripts).toHaveLength(0);
  });

  it("rejects when the script fails and lets a later call retry", async () => {
    const scripts = stubDom({});
    const first = loadExsurge();
    scripts[0]?.onerror?.();
    await expect(first).rejects.toThrow("exsurge did not load");
    const second = loadExsurge();
    expect(scripts).toHaveLength(2);
    second.catch(() => undefined);
  });
});
