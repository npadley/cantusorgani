import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { parseCatalog, type Piece } from "../lib/catalog";
import SourceBlock from "./SourceBlock.astro";

function proper(volume = "noh1", pages = [3, 7], pagination: string | null = null): Piece {
  const piece = parseCatalog({
    schema_version: 2, volumes: { [volume]: { title: "Proper", part: "I" } }, chant_source: null,
    pieces: [{
      id: `${volume}-test`, volume, slug: `${volume}-test`, section: "Advent", label: "Advent I",
      title: "Dominica I Adventus", incipit: null, genre: "proper", mode: null, mass: null,
      printed_pages: pages, pdf_pages: [5, 9], division: "temporale",
      systems: [], system_assets: [], system_aspect: [], chant: null,
      review_status: "verified", movements: [], parts: [],
    }],
  }).pieces[0]!;
  return { ...piece, pagination };
}

async function render(props: { piece: Piece } | { pieces: readonly Piece[] }): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(SourceBlock, { props });
}

describe("SourceBlock", () => {
  it("renders the registered NOH source and printed citation for a Proper", async () => {
    const html = await render({ piece: proper() });
    expect(html).toMatch(/<h2[^>]*>Source<\/h2>/);
    expect(html).toMatch(/<section[^>]*aria-labelledby="source-noh1"/);
    expect(html).toMatch(/lang="la"[^>]*>Nova Organi Harmonia ad Graduale Romanum</);
    expect(html).toContain("Book I");
    expect(html).toContain("Lemmens Institute, Mechelen: H. Dessain, 1942.");
    expect(html).toContain("pp. 3–7");
    expect(html).toContain("The page images and everything cut from them are in the public domain.");
    expect(html).not.toMatch(/Illustrative/i);
  });

  it("omits missing provenance and publication notes rather than rendering blank fields", async () => {
    const html = await render({ piece: proper() });
    expect(html).not.toContain("Provenance");
    expect(html).not.toContain("Bound scan includes");
    expect(html).not.toMatch(/<dd[^>]*>\s*<\/dd>/);
    expect(html).not.toMatch(/null|undefined|Illustrative/i);
  });

  it("groups pieces by volume without losing or repeating printed citations", async () => {
    const html = await render({ pieces: [proper(), proper("noh5", [20, 24]), proper("noh1", [8, 9]), proper()] });
    expect(html.match(/<section\b/g)).toHaveLength(2);
    expect(html).toContain('id="source-noh1"');
    expect(html).toContain('id="source-noh5"');
    expect(html).toContain("Book V");
    expect(html.match(/pp\. 3–7/g)).toHaveLength(1);
    expect(html).toContain("pp. 8–9");
    expect(html).toContain("pp. 20–24");
    expect(html).not.toMatch(/Illustrative/i);
  });

  it("keeps the real Book III publication note and addendum pagination", async () => {
    const html = await render({ piece: proper("noh3", [3, 11], "Addenda ad Partem III") });
    expect(html).toContain("Bound scan includes the regina and pius-x addenda (1954)");
    expect(html).toMatch(/<span lang="la"[^>]*>Addenda ad Partem III<\/span>, pp. 3–11/);
  });

  it("renders no source blocks for an empty list", async () => {
    expect(await render({ pieces: [] })).not.toContain("<section");
  });
});
