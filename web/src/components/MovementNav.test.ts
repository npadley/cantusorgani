import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import { movementStarts, ordinaryMasses, parseCatalog } from "../lib/catalog";
import type { Piece } from "../lib/catalog";
import MovementNav from "./MovementNav.astro";
import SystemStack from "./SystemStack.astro";

async function render(piece: Piece): Promise<string> {
  const container = await AstroContainer.create();
  const nav = await container.renderToString(MovementNav, { props: { piece } });
  const music = await container.renderToString(SystemStack, { props: { piece, id: "music" } });
  return nav + music;
}

function links(html: string): string[] {
  return [...html.matchAll(/<a[^>]*\shref="#([^"]+)"/g)].map((m) => m[1] ?? "");
}

function ids(html: string): Set<string> {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1] ?? ""));
}

function mass(movements: readonly [string, number][], systems = 12,
              hymns: readonly [string, number][] = []): Piece {
  const refs = Array.from({ length: systems }, (_, i) => `noh5/0100/${String(i).padStart(3, "0")}`);
  return parseCatalog({
    schema_version: 2, volumes: { noh5: { title: "Kyriale", part: "V" } }, chant_source: null,
    pieces: [{
      id: "noh5-m", volume: "noh5", slug: "m", section: "S", label: "IX", title: "T", incipit: null,
      genre: "mass_ordinary", mode: null, mass: "IX", printed_pages: [1, 2], pdf_pages: [47, 48],
      division: "kyriale", systems: refs, system_assets: refs.map(() => ""),
      system_aspect: refs.map(() => [1000, 250]), chant: null, review_status: "verified",
      movements: movements.map(([movement, i]) => ({
        movement, score: 0.9, pdf_page: 100, system: i, ref: refs[i], mode_marker: null,
      })),
      hymns: hymns.map(([title, i]) => ({ title, ref: refs[i], printed_page: 51 })),
    }],
  }).pieces[0]!;
}

describe("MovementNav with SystemStack", () => {
  it("should link every movement to a heading that exists on the page", async () => {
    const html = await render(mass([["kyrie", 0], ["gloria", 4], ["sanctus", 8], ["agnus", 10]]));
    expect(links(html)).toEqual(["kyrie", "gloria", "sanctus", "agnus"]);
    for (const anchor of links(html)) expect(ids(html)).toContain(anchor);
  });

  it("should put each heading directly before the movement's first system", async () => {
    const html = await render(mass([["kyrie", 0], ["sanctus", 5]]));
    const heading = html.indexOf('id="sanctus"');
    const system = html.indexOf('data-ref="noh5/0100/005"');
    const previous = html.indexOf('data-ref="noh5/0100/004"');
    expect(previous).toBeLessThan(heading);
    expect(heading).toBeLessThan(system);
  });

  it("should label the Agnus Dei and the dismissal in full", async () => {
    const html = await render(mass([["kyrie", 0], ["agnus", 6], ["ite", 11]]));
    expect(html).toContain(">Agnus Dei</a>");
    expect(html).toContain(">Ite, missa est</h2>");
  });

  it("should not render a nav for a piece with one movement or none", async () => {
    expect(await render(mass([["kyrie", 0]]))).not.toContain("Jump to");
    expect(await render(mass([]))).not.toContain("Jump to");
  });

  it("should ignore a boundary whose system is not in the piece", async () => {
    const piece = mass([["kyrie", 0], ["gloria", 3]]);
    const broken = { ...piece, movements: [...piece.movements,
      { ...piece.movements[1]!, movement: "sanctus" as const, ref: "noh5/9999/000" }] };
    expect(movementStarts(broken).map((s) => s.movement)).toEqual(["kyrie", "gloria"]);
  });
});

describe("hymns in a Vespers office", () => {
  it("should link each hymn to a heading before its first system", async () => {
    const html = await render(mass([], 10, [["Creator alme siderum", 3], ["Te lucis ante terminum", 7]]));
    expect(links(html)).toEqual(["hymn-creator-alme-siderum", "hymn-te-lucis-ante-terminum"]);
    for (const anchor of links(html)) expect(ids(html)).toContain(anchor);
    expect(html.indexOf('id="hymn-creator-alme-siderum"'))
      .toBeLessThan(html.indexOf('data-ref="noh5/0100/003"'));
  });

  it("should give a hymn printed twice two distinct anchors", async () => {
    const html = await render(mass([], 10, [["Iste Confessor", 2], ["Iste Confessor", 6]]));
    expect(links(html)).toEqual(["hymn-iste-confessor", "hymn-iste-confessor-2"]);
    expect(ids(html)).toContain("hymn-iste-confessor-2");
  });
});

describe("the Kyriale's eighteen Masses", () => {
  const withoutGloria = new Set(["XVI", "XVII", "XVIII"]);

  it.each(ordinaryMasses().map((m) => [m.label, m] as const))(
    "Missa %s should have its movements, each linked and in order",
    async (label, piece) => {
      const expected = ["kyrie", ...(withoutGloria.has(label) ? [] : ["gloria"]), "sanctus", "agnus"];
      const starts = movementStarts(piece).map((s) => s.movement);
      expect(starts.filter((m) => m !== "ite")).toEqual(expected);
      const html = await render(piece);
      for (const anchor of links(html)) expect(ids(html)).toContain(anchor);
    },
  );
});
