import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { ordinaryFormOccasions, ordinaryFormPiece } from "../lib/ordinaryFormPieces";
import OrdinaryFormPage from "../pages/ordinary-form/[key].astro";

async function render(key: string): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(OrdinaryFormPage, { props: { key },
    request: new Request(`https://cantusorgani.org/ordinary-form/${key}/`) });
}

describe("Ordinary Form occasion pages", () => {
  it("puts selection in the rail and gives each part an inline box and year links", async () => {
    const html = await render("easter");
    expect(html).toContain('class="service-rail');
    expect(html).toContain('data-inline-part=');
    const chooser = html.match(/<section id="cycle-alternatives"[\s\S]*?<\/section>/)?.[0];
    expect(chooser).toBeDefined();
    expect(chooser?.match(/data-cycle=/g)).toHaveLength(3);
    expect(html).toContain('class="source-block');
  });

  it("assembles sourced chants without inventing a printed-page citation", async () => {
    const html = await render("easter");
    expect(html).toContain("Graduale Romanum (1974)");
    expect(html).toContain("This page assembles available Nova Organi Harmonia music");
    expect(html).toContain('data-ref="noh2/0033/000"');
    expect(html).not.toContain("rubric cites");
    expect(html).not.toContain('id="source-ordinary-form"');
    for (const part of ordinaryFormOccasions().find(row => row.key === "easter")!.parts) {
      if (part.lender) expect(html).toContain('id="source-' + part.lender.ref.split("/")[0] + '"');
    }
  });

  it("names the missing accompaniment and links the chant to GregoBase without a fake page", async () => {
    const occasion = ordinaryFormOccasions().find(row => row.parts.some(part => !part.lender));
    expect(occasion).toBeDefined();
    const missing = occasion!.parts.find(part => !part.lender)!;
    const html = await render(occasion!.key);
    expect(html).toContain("Not in Nova Organi Harmonia");
    const about = html.match(/<section id="missing-lender"[\s\S]*?<\/section>/)?.[0];
    expect(about).toContain(`chant.php?id=${missing.gregobase_id}`);
    expect(about).not.toContain('role="status"');
    expect(html).not.toMatch(/<p[^>]*role="status"[^>]*>(?:(?!<\/p>)[\s\S])*Not in Nova Organi Harmonia/);
    expect(html).not.toContain("p. 0");
  });

  it("explains unmapped assignments and keeps synthetic pieces outside the EF catalog", async () => {
    const occasion = ordinaryFormOccasions().find(row => row.assignment_status === "unmapped");
    expect(occasion).toBeDefined();
    expect(ordinaryFormPiece(occasion!.key)?.parts).toEqual([]);
    const html = await render(occasion!.key);
    expect(html).toContain("chants not yet mapped");
    expect(html).not.toContain('id="cycle-alternatives"');
    expect(html).toContain('id="of-export-note"');
  });
});

describe("skip link", () => {
  it.each(["lateran-dedication", "sacred-heart", "st-joseph"])("%s points at an anchor that exists", async (key) => {
    const html = await render(key);
    const target = html.match(/class="skip-link[^"]*" href="#([^"]+)"/)?.[1];
    expect(target).toBeDefined();
    expect(html).toContain(`id="${target}"`);
  });
});
