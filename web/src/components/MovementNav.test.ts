import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import { allPieces, jumpTargets, movementStarts, ordinaryMasses, parseCatalog } from "../lib/catalog";
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
      // A movement, or the row an editor named for it to move its start (data/sections/noh5.yml):
      // either way it is on the page under the movement's own anchor.
      const all = ["kyrie", "gloria", "credo", "sanctus", "agnus"];
      const starts = jumpTargets(piece).filter((t) => all.includes(t.anchor)).map((t) => t.anchor);
      expect(starts).toEqual(expected);
      expect(movementStarts(piece).every((s) => expected.includes(s.movement) || s.movement === "ite")).toBe(true);
      const html = await render(piece);
      for (const anchor of links(html)) expect(ids(html)).toContain(anchor);
    },
  );
});

function proper(parts: readonly Record<string, unknown>[], systems = 12, jgabc: string | null = null): Piece {
  const refs = Array.from({ length: systems }, (_, i) => `noh3/0397/${String(i).padStart(3, "0")}`);
  return parseCatalog({
    schema_version: 2, volumes: { noh3: { title: "Sanctorale", part: "III" } }, chant_source: null,
    pieces: [{
      id: "noh3-t", volume: "noh3", slug: "t", section: "S", label: "T", title: "S. Theresiae",
      incipit: null, genre: "proper", mode: null, mass: null, printed_pages: [364, 374],
      pdf_pages: [397, 407], division: "sanctorale", systems: refs, system_assets: refs.map(() => ""),
      system_aspect: refs.map(() => [1000, 250]), chant: null, review_status: "verified",
      movements: [], jgabc_url: jgabc,
      parts: parts.map((p) => ("system" in p ? { ...p, ref: refs[p["system"] as number] } : p)),
    }],
  }).pieces[0]!;
}

describe("MovementNav for a Proper", () => {
  const therese = proper([
    { part: "introit", system: 0, placed: "label", gregobase_id: 59 },
    { part: "gradual", system: 4, placed: "label", gregobase_id: 1034 },
    { part: "alleluia", variant: "paschal", system: 7, placed: "text", gregobase_id: null },
    { part: "communion", system: 10, placed: "label", gregobase_id: 162 },
  ]);

  it("should link every part to a heading before its first system", async () => {
    const html = await render(therese);
    expect(links(html)).toEqual(["introit", "gradual", "alleluia-paschal", "communion"]);
    for (const anchor of links(html)) expect(ids(html)).toContain(anchor);
    expect(html.indexOf('id="gradual"')).toBeLessThan(html.indexOf('data-ref="noh3/0397/004"'));
    expect(html).toContain(">Paschal Alleluia</a>");
  });

  it("should label the nav as the Proper's parts", async () => {
    expect(await render(therese)).toContain('aria-label="Parts of the Proper"');
  });

  it("should put the chant link beside the heading, never inside it, opening a new tab", async () => {
    const html = await render(therese);
    expect(html).toMatch(/<h2[^>]*id="introit"[^>]*>Introit<\/h2>/);
    expect(html).toContain('href="https://gregobase.selapa.net/chant.php?id=59"');
    expect(html).toMatch(/href="https:\/\/gregobase\.selapa\.net\/chant\.php\?id=59" target="_blank" rel="noopener"/);
    expect(html).toContain("opens in new tab");
  });

  it("should leave out the chant link when the part has no chant id", async () => {
    const html = await render(therese);
    const paschal = html.slice(html.indexOf('id="alleluia-paschal"'), html.indexOf('id="communion"'));
    expect(paschal).not.toContain("gregobase");
  });

  it("should not render a nav for a Proper with a single part", async () => {
    expect(await render(proper([{ part: "introit", system: 0, placed: "label" }]))).not.toContain("Jump to");
  });
});

describe("every divided Proper in the catalog", () => {
  const propers = allPieces().filter((p) => p.parts.some((x) => x.kind === "printed"));

  it("should exist in quantity", () => {
    expect(propers.length).toBeGreaterThan(150);
  });

  it.each(propers.map((p) => [p.slug, p] as const))(
    "%s should link each part to a heading on the page",
    async (_slug, piece) => {
      const html = await render(piece);
      for (const anchor of links(html)) expect(ids(html)).toContain(anchor);
    },
  );
});

describe("parts placed by order", () => {
  it("should not be offered as jump links: a wrong link is worse than none", async () => {
    const piece = proper([
      { part: "introit", system: 0, placed: "label" },
      { part: "alleluia", system: 4, placed: "order" },
      { part: "communion", system: 9, placed: "text" },
    ]);
    const html = await render(piece);
    expect(links(html)).toEqual(["introit", "communion"]);
    expect(html).not.toContain('id="alleluia"');
  });
});


describe("printed and borrowed parts together", () => {
  it("should list them in the order of Mass, not printed first", async () => {
    const lender = { part: "introit", borrowed_volume: "noh3", borrowed_page: 354, borrowed_from: null,
                     borrowed_ref: null };
    const piece = proper([lender, { part: "offertory", system: 2, placed: "label" },
                          { part: "communion", system: 6, placed: "label" }]);
    const { partOrder } = await import("../lib/catalog");
    expect(partOrder("introit")).toBeLessThan(partOrder("offertory"));
    expect(partOrder("alleluia", "paschal")).toBeGreaterThan(partOrder("tract"));
    expect(partOrder("gradual", "2")).toBeGreaterThan(partOrder("gradual", "1"));
    expect(links(await render(piece))).toEqual(["offertory", "communion"]);   // unresolved lender: no link
  });
});

describe("chant notation beside each part", () => {
  const withChant = proper([
    { part: "introit", system: 0, placed: "label", gregobase_id: 59 },     // Veni de Libano: published
    { part: "communion", system: 6, placed: "label", gregobase_id: null },
  ]);

  it("should offer the switch, off by default, when a part has notation", async () => {
    const html = await render(withChant);
    expect(html).toMatch(/<input type="checkbox" data-chant-toggle[^>]*>/);
    expect(html).not.toMatch(/data-chant-toggle[^>]*checked/);
    expect(html).toContain("Show the chant with each part");
  });

  it("should place a hidden container under the part's heading, with its annotation and credit", async () => {
    const html = await render(withChant);
    const heading = html.indexOf('id="introit"');
    const box = html.indexOf('data-chant-id="59"');
    expect(heading).toBeGreaterThan(-1);
    expect(box).toBeGreaterThan(heading);
    expect(html).toMatch(/class="chant-notation"[^>]*hidden/);
    expect(html).toContain('data-annotation="Intr."');
    expect(html).toContain("Chant from");
  });

  it("should offer neither switch nor container where no part has published notation", async () => {
    const html = await render(proper([
      { part: "introit", system: 0, placed: "label", gregobase_id: null },
      { part: "communion", system: 6, placed: "label", gregobase_id: 999999 },
    ]));
    expect(html).not.toContain("data-chant-toggle");
    expect(html).not.toContain("chant-notation");
  });
});

describe("chant notation in the Kyriale", () => {
  const missaIX = allPieces().find((p) => p.slug === "ordinarium-missae-ix")!;
  const credoI = allPieces().find((p) => p.slug === "ordinarium-missae-credo-i")!;

  it("should give each movement of Missa IX its chant link and notation, and the switch", async () => {
    const html = await render(missaIX);
    expect(html).toContain("data-chant-toggle");
    for (const id of [2976, 2771, 587, 707]) {
      expect(html).toContain(`data-chant-id="${id}"`);
      expect(html).toContain(`gregobase.selapa.net/chant.php?id=${id}`);
    }
    // Each notation follows its own heading.
    expect(html.indexOf('data-chant-id="587"')).toBeGreaterThan(html.indexOf('id="sanctus"'));
  });

  it("should show a single chant's notation above its music, without a second heading", async () => {
    const html = await render(credoI);
    expect(html).toContain("data-chant-toggle");
    expect(html).toMatch(/class="chant-notation"[^>]*hidden/);
    expect(html).not.toMatch(/<h2[^>]*id="chant"/);
    expect(html.indexOf("chant-notation")).toBeLessThan(html.indexOf("data-ref="));
  });

  it("should not attach an unverified pairing", async () => {
    const piece = mass([["kyrie", 0], ["gloria", 4]]);
    const unverified = { ...piece, chant: [{ source: "gregobase" as const, id: 2976, movement: "kyrie" as const,
      incipit: "Kyrie IX", mode: "1", score: 0.5, status: "unverified" as const }] };
    const html = await render(unverified);
    expect(html).not.toContain("data-chant-id");
    expect(html).not.toContain("data-chant-toggle");
  });
});

describe("a Mass with rows of its own (data/sections/noh5.yml)", () => {
  it("should list Mass XVII's second Kyrie and both responses among its movements, in the book's order", async () => {
    const xvii = allPieces().find((p) => p.slug === "ordinarium-missae-xvii")!;
    const html = await render(xvii);
    expect(html).toContain('aria-label="Movements"');
    const jump = links(html).filter((a) => !a.startsWith("music"));
    expect(jump).toEqual(["kyrie", "other-kyrie-b", "sanctus", "agnus", "other-deo-gratias-i", "other-deo-gratias-vi"]);
    for (const anchor of jump) expect(ids(html).has(anchor), anchor).toBe(true);
    // The first response starts where the pipeline found "Ite": one heading there, the row's.
    expect(html).not.toMatch(/<h2[^>]*id="ite"/);
  });
});
