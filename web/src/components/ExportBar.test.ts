import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import { parseCatalog } from "../lib/catalog";
import type { Piece } from "../lib/catalog";
import ExportBar from "./ExportBar.astro";
import PartLinks from "./PartLinks.astro";

function proper(systems: number, parts: readonly [string, number, string?][], jgabc: string | null = null): Piece {
  const refs = Array.from({ length: systems }, (_, i) => `noh3/0100/${String(i).padStart(3, "0")}`);
  return parseCatalog({
    schema_version: 2, volumes: { noh3: { title: "III", part: "III" } }, chant_source: null,
    pieces: [{
      id: "noh3-t", volume: "noh3", slug: "t", section: "S", label: "T", title: "S. Theresiae",
      incipit: null, genre: "proper", mode: null, mass: null, printed_pages: [1, 2], pdf_pages: [3, 4],
      division: "sanctorale", systems: refs, system_assets: refs.map(() => ""),
      system_aspect: refs.map(() => [1000, 250]), chant: null, review_status: "verified", movements: [],
      jgabc_url: jgabc,
      parts: parts.map(([part, system, variant]) => ({ part, variant: variant ?? "", system, ref: refs[system], placed: "label" })),
    }],
  }).pieces[0]!;
}

const THERESE = proper(10, [["introit", 0], ["gradual", 2], ["alleluia", 4], ["tract", 6], ["communion", 8]],
                       "https://bbloomf.github.io/jgabc/propers.html#saint=Oct3");

async function render(component: typeof ExportBar | typeof PartLinks, props: Record<string, unknown>): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(component, { props });
}

describe("ExportBar", () => {
  it("should offer each part in a fieldset, ticking all on a piece page", async () => {
    const html = await render(ExportBar, { pieces: [THERESE], title: "T" });
    expect(html).toMatch(/<legend[^>]*>Parts to export<\/legend>/);
    expect((html.match(/name="export-part"/g) ?? []).length).toBe(5);
    expect((html.match(/checked/g) ?? []).length).toBe(5);
    expect(html).toContain("Export PDF (10 systems");
  });

  it("should untick the Tract in October and say which date set the defaults", async () => {
    const html = await render(ExportBar, {
      pieces: [THERESE], title: "T", season: "pentecost", dateLabel: "Saturday, 3 October 2026",
    });
    expect(html).toContain("Defaults for Saturday, 3 October 2026 (Tract unticked).");
    expect(html).toMatch(/data-label="Tract"(?![^>]*checked)/);
    expect(html).toContain("Export PDF (8 systems");
  });

  it("should never tell the organist to use movement pages", async () => {
    const big = proper(320, [["introit", 0]]);
    const html = await render(ExportBar, { pieces: [big], title: "T" });
    expect(html).toContain("the limit is 300");
    expect(html).not.toContain("movement pages");
  });

  it("should render nothing for pieces with no music", async () => {
    expect(await render(ExportBar, { pieces: [proper(0, [])], title: "T" })).not.toContain("export-btn");
  });
});

describe("PartLinks", () => {
  it("should link each part to its anchor on the piece page, and the whole Proper to jgabc", async () => {
    const html = await render(PartLinks, { pieces: [THERESE] });
    expect(html).toContain('href="/piece/t/#gradual"');
    expect(html).toContain('href="https://bbloomf.github.io/jgabc/propers.html#saint=Oct3"');
    expect(html).toContain('aria-label="Parts of S. Theresiae"');
  });

  it("should render nothing for a piece with no parts and no chant link", async () => {
    expect(await render(PartLinks, { pieces: [proper(4, [])] })).not.toContain("<nav");
  });
});
