import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import { inPrintedOrder, parseCatalog } from "../lib/catalog";
import type { Piece } from "../lib/catalog";
import { defaultTicked, exportSegments } from "../lib/exportParts";
import MovementNav from "./MovementNav.astro";
import SystemStack from "./SystemStack.astro";

// The Ember Saturday of Advent as the book prints it (NOH1 pp. 24-38): four
// Graduals, one after each lesson, the hymn *Benedictus es* after Daniel, then
// the Tract, Offertory and Communion. Systems counted from 0.
const EMBER: readonly [string, number, string, string | null, number | undefined][] = [
  ["introit", 0, "Intr. II", "Veni et ostende", undefined],
  ["gradual", 6, "Grad. II", "A summo caelo", 1],
  ["gradual", 15, "2. Grad. I", "In sole posuit", 2],
  ["gradual", 24, "3. Grad. II", "Domine Deus virtutum", 3],
  ["gradual", 32, "4. Grad. II", "Excita Domine", 4],
  ["hymn", 44, "Hymn. VIII", "Benedictus es", undefined],
  ["tract", 68, "Tract. VIII", "Qui regis Israel", undefined],
  ["offertory", 79, "Offert. III", "Exsulta satis", undefined],
  ["communion", 83, "Comm. VI", "Ecce Dominus veniet", undefined],
];

function ember(rubrics = false): Piece {
  const refs = Array.from({ length: 86 }, (_, i) => `noh1/${String(50 + Math.floor(i / 6)).padStart(4, "0")}/${String(i % 6).padStart(3, "0")}`);
  return parseCatalog({
    schema_version: 3, volumes: { noh1: { title: "Proprium de Tempore", part: "I" } }, chant_source: null,
    pieces: [{
      id: "noh1-sabbato", volume: "noh1", slug: "sabbato-temporum-adventus", section: "S", label: "Sabbato",
      title: "Sabbato Quattuor Temporum Adventus", incipit: null, genre: "proper", mode: null, mass: null,
      printed_pages: [24, 38], pdf_pages: [50, 64], division: "temporale", systems: refs,
      system_assets: refs.map(() => ""), system_aspect: refs.map(() => [1000, 250]), chant: null,
      review_status: "verified", movements: [],
      sections: EMBER.map(([kind, system, label, title, n]) => ({
        kind, ...(n ? { n } : {}), variant: "", label, title, system, ref: refs[system], gregobase_id: null,
        placed: "reviewed",
        ...(rubrics && kind === "gradual" && n === 2 ? { rubric: "Tempore Paschali.", rubric_translation: "During Paschaltide." } : {}),
      })),
    }],
  }).pieces[0]!;
}

async function render(piece: Piece): Promise<string> {
  const container = await AstroContainer.create();
  return await container.renderToString(MovementNav, { props: { piece } })
    + await container.renderToString(SystemStack, { props: { piece, id: "music" } });
}

describe("a Proper with four Graduals and a hymn", () => {
  it("should link every section in the order printed, the hymn by its opening words", async () => {
    const html = await render(ember());
    const nav = html.slice(0, html.indexOf("</nav>"));
    expect([...nav.matchAll(/<a href="#[^"]+"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1])).toEqual([
      "Introit", "Gradual 1", "Gradual 2", "Gradual 3", "Gradual 4", "Benedictus es", "Tract", "Offertory", "Communion"]);
  });

  it("should head each section with its name and what the book prints beside it", async () => {
    const html = await render(ember());
    expect(html).toContain('id="gradual-2"');
    expect(html).toMatch(/id="gradual-2"[^>]*>Gradual 2<span class="printed-as"[^>]*> · 2\. Grad\. I · In sole posuit<\/span>/);
    // The hymn's heading is its opening words; its label follows, not the words twice.
    expect(html).toMatch(/id="hymn"[^>]*>Benedictus es<span class="printed-as"[^>]*> · Hymn\. VIII<\/span>/);
    const heading = html.indexOf('id="hymn"');
    expect(html.indexOf('data-ref="noh1/0057/001"')).toBeLessThan(heading);    // system 43
    expect(heading).toBeLessThan(html.indexOf('data-ref="noh1/0057/002"'));   // system 44
  });

  it("should export each section, all sung that day, in the order printed", () => {
    const segments = exportSegments([ember()], []);
    expect(segments.map((s) => s.label)).toEqual([
      "Introit", "Gradual 1", "Gradual 2", "Gradual 3", "Gradual 4", "Benedictus es", "Tract", "Offertory", "Communion"]);
    expect(segments.map((s) => s.systems)).toEqual([6, 9, 9, 8, 12, 24, 11, 4, 3]);
    expect(segments.every((s) => defaultTicked(s, segments, "other"))).toBe(true);
    expect(segments.every((s) => defaultTicked(s, segments, "lent"))).toBe(true);
  });
});

describe("inPrintedOrder", () => {
  it("should keep the book's order and slot a section printed elsewhere by its place in the Mass", () => {
    // NOH3's Queenship Mass: its Paschal Alleluia is printed before the Gradual.
    const own = [{ order: 0, id: "introit" }, { order: 4, id: "alleluia-paschal" }, { order: 1, id: "gradual" },
                 { order: 8, id: "communion" }];
    const borrowed = [{ order: 7, id: "offertory (from the Common)" }];
    expect(inPrintedOrder(own, borrowed).map((x) => x.id)).toEqual(
      ["introit", "alleluia-paschal", "gradual", "offertory (from the Common)", "communion"]);
  });
});


describe("reviewed rubrics", () => {
  it("normalizes both languages and places them above the affected music only", async () => {
    const p = ember(true);
    expect(p.parts[2]).toMatchObject({ rubric: "Tempore Paschali.", rubricTranslation: "During Paschaltide." });
    const html = await render(p);
    const heading = html.indexOf('id="gradual-2"');
    const latin = html.indexOf("Tempore Paschali.");
    const english = html.indexOf("During Paschaltide.");
    const music = html.indexOf('data-ref="noh1/0052/003"');
    expect(heading).toBeLessThan(latin);
    expect(latin).toBeLessThan(english);
    expect(english).toBeLessThan(music);
    expect(html).toMatch(/lang="la"[^>]*>Tempore Paschali\./);
    expect(html).toMatch(/lang="en"[^>]*>During Paschaltide\./);
    expect(html.match(/Tempore Paschali\./g)).toHaveLength(1);
    expect(await render(ember())).not.toContain('class="section-rubric"');
  });

  it("exports the affected section's bilingual instruction and drops it with an excluded part", () => {
    const p = ember(true);
    const segs = exportSegments([p], []);
    expect(segs[2]).toMatchObject({ rubric: "Tempore Paschali.", rubricTranslation: "During Paschaltide." });
    expect(segs.filter((s) => s.rubric)).toHaveLength(1);
    expect(exportSegments([{ ...p, excludedParts: ["gradual"] }], []).some((s) => s.rubric)).toBe(false);
  });
});
