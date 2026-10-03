import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { pieceBySlug } from "../lib/catalog";
import PiecePage from "../pages/piece/[slug].astro";

const slug = "s-hieronymi-presbyteris-confessoris-et-ecclesi-doctoris";

async function render(piece = pieceBySlug(slug)!) {
  const container = await AstroContainer.create();
  return container.renderToString(PiecePage, { props: { piece },
    request: new Request(`https://cantusorgani.org/piece/${piece.slug}/`) });
}

describe("a Mass printed wholly by reference", () => {
  it("shows St Jerome's cited pages and embeds the Common of Doctors in order", async () => {
    const html = await render();
    expect(html).toContain("Pars IV, p. 71");
    expect(html).toContain("pp. 71–76");
    expect([...html.matchAll(/data-ref="([^"]+)"/g)].map((m) => m[1])).toEqual([
      ...[102, 103, 104, 105, 106].flatMap((page) =>
        Array.from({ length: 6 }, (_, i) => `noh4/0${page}/00${i}`)),
      "noh4/0045/004", "noh4/0046/000", "noh4/0046/001", "noh4/0046/002", "noh4/0046/003",
      "noh4/0046/004", "noh4/0046/005", "noh4/0047/000", "noh4/0047/001", "noh4/0047/002", "noh4/0047/003",
      ...Array.from({ length: 5 }, (_, i) => `noh4/0107/00${i}`),
      // The Communion, Fidelis servus, is cited from p. 65.
      ...Array.from({ length: 4 }, (_, i) => `noh4/0096/00${i + 2}`),
    ]);
    expect(html).not.toContain("No music of its own");
    expect(html).toContain('href="#introit"');
    expect(html).toContain('id="introit"');
    expect(html).toContain('id="music"');
    // The export must offer the embedded score, not the empty feast entry.
    expect(html).toMatch(/data-stems="[^"]*systems\/noh4\/0102\/000-/);
  });

  it("keeps a feast with no known reference honest", async () => {
    const piece = { ...pieceBySlug(slug)!, reference: null, days: ["sancti:99-99"] };
    const html = await render(piece);
    expect(html).toContain("No music of its own");
    expect(html).not.toContain('data-ref="noh4/0102/000"');
  });

  it("does not substitute an entire Mass for a reference to just one part", async () => {
    const piece = { ...pieceBySlug(slug)!, reference: "Introitus. In médio Ecclésiæ, Pars IV, p. 71." };
    expect(await render(piece)).not.toContain('data-ref="noh4/0102/000"');
  });

  it("keeps music printed in the entry itself even when there is a citation", async () => {
    const piece = { ...pieceBySlug("in-dedicatione-s-mich-lis-archangelis")!,
      reference: "Missa. In médio Ecclésiæ, Pars IV, p. 71.", days: ["sancti:09-30"] };
    const html = await render(piece);
    expect(html).toContain('data-ref="noh3/0387/000"');
    expect(html).not.toContain('data-ref="noh4/0102/000"');
  });
});
