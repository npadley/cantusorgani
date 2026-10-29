import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";
import { pieceBySlug } from "../lib/catalog";
import { selectionFromBoxes } from "../lib/selection";
import { musicView } from "../lib/music";
import { exportRuns } from "../lib/typeset";
import { exportSegments } from "../lib/exportParts";
import ServiceRail from "./ServiceRail.astro";
import SystemStack from "./SystemStack.astro";
const piece = pieceBySlug("dominica-i-adventus")!;
async function render(pieces = [piece]) {
  return (await AstroContainer.create()).renderToString(ServiceRail, { props: { pieces, title: piece.title } });
}
describe("ServiceRail", () => {
  it("provides a lazy chalice template for the empty selection in the parts list", async () => {
    const html = await render();
    expect(html).toMatch(/<template[^>]*data-woodcut-selection/);
    expect(html).toMatch(/<img[^>]*class="woodcut woodcut-small"[^>]*loading="lazy"/);
    expect(html).toContain("/art/v1/detail-chalice-360.webp 360w, /art/v1/detail-chalice-720.webp 720w");
  });
  it("offers one hidden input per part with contextual names, counts and capability", async () => {
    const html = await render();
    const parts = exportSegments([piece]);
    expect(html.match(/name="export-part"/g)).toHaveLength(parts.length);
    for (const part of parts) {
      // The accessible name holds the visible label (WCAG 2.5.3); the counts describe it.
      expect(html).toMatch(new RegExp(`<span id="part-name-\\d+"[^>]*><span class="sr-only"[^>]*>In PDF: </span>${part.label}</span>`));
      expect(html).toContain(`${part.systems} systems`);
    }
    const model = selectionFromBoxes(parts.map(part => ({ value: part.id, checked: true, dataset: {
      stems: part.stems.join(","), runs: JSON.stringify(exportRuns(piece, part.source!.start, part.source!.end)),
    } })), piece.title, () => false);
    for (const segment of model.segments) {
      for (const run of segment.runs) {
        expect(html).toContain(run.capability === "mei" ? "Customizable typeset" : run.capability === "fixed" ? "Typeset" : "Scans");
      }
    }
    expect(html).toMatch(/aria-describedby="part-detail-0"/);
    expect(html).toMatch(/id="part-detail-0"[^>]*>[^<]*systems? · <span[^>]*>[^<]+<\/span> · NOH</);
    expect(html).toContain("Export needs JavaScript.");
    expect(html).toMatch(/<div[^>]*data-part-list[^>]*hidden/);
    expect(html).toMatch(/<div[^>]*class="go"[^>]*hidden/);
    expect(html).toMatch(/<button[^>]*data-choose-parts[^>]*hidden/);
    expect(html).toContain('id="selection-status"');
    expect(html).not.toContain("Illustrative");
    expect(html).toContain("day-marker--violet");
    expect(html).toContain("Violet");
  });
  it("can retain the page's own day marker and full English service title", async () => {
    const railTitle = "I Vespers — Christmas, sung on the evening of 24 December 2026";
    const html = await (await AstroContainer.create()).renderToString(ServiceRail, {
      props: { pieces: [piece], title: "PDF title", observanceKey: piece.days[0], railTitle, showDayMarker: false },
    });
    expect(html).toMatch(new RegExp(`<p class="rail-title" lang="en"[^>]*>${railTitle}</p>`));
    expect(html).not.toContain("day-marker--");
  });
  it("keeps Paper before the export note so the compact bar can share its controls row", async () => {
    const html = await render();
    expect(html.indexOf('class="small paper"')).toBeLessThan(html.indexOf('export-foot-note'));
  });
  it("keeps exports and tools but hides the chooser for one part", async () => {
    const html = await render([{ ...piece, parts: [], movements: [] }]);
    expect(html).not.toContain("data-choose-parts");
    expect(html).toContain('id="export-btn"');
    expect(html).toContain('class="reader-tools"');
    expect(html).toMatch(/data-part-list[^>]*hidden/);
  });
  it("shows the 300-system refusal once, outside export progress", async () => {
    const large = { ...piece, parts: [], movements: [], systems: Array.from({ length: 301 }, (_, i) => `noh1/0029/${i}`) };
    const html = await render([large]);
    expect(html.match(/the limit is 300/g)).toHaveLength(1);
    expect(html).toMatch(/<p id="export-status"[^>]*><\/p>/);
  });
  it("passes reading tools through the rail without duplicating them", async () => {
    const html = await (await AstroContainer.create()).renderToString(ServiceRail, {
      props: { pieces: [piece], title: piece.title }, slots: { "reader-tools": '<a href="/chant/">Chant tool</a>' },
    });
    expect(html.match(/Chant tool/g)).toHaveLength(1);
  });
  it("preserves reader links even when there is no exportable music", async () => {
    const html = await (await AstroContainer.create()).renderToString(ServiceRail, {
      props: { pieces: [], title: "By reference" }, slots: { "reader-tools": '<a href="/chant/">Whole Proper chant</a>' },
    });
    expect(html).toContain("Whole Proper chant");
    expect(html).not.toContain('id="export-btn"');
  });
  it("does not match an inline part from another piece at the same system", async () => {
    const parts = exportSegments([piece]).map(s => ({ ...s, pieceSlug: "another-piece" }));
    const html = await (await AstroContainer.create()).renderToString(SystemStack, { props: { piece, exportParts: parts } });
    expect(html).not.toContain("data-inline-part");
  });
  it("matches composed borrowed headings using their original source positions", async () => {
    const original = pieceBySlug("commune-doctorum")!;
    const parts = exportSegments([original]);
    const html = await (await AstroContainer.create()).renderToString(SystemStack, { props: { piece: musicView(original), exportParts: parts } });
    for (const part of parts) expect(html).toContain(`data-inline-part="${part.id}"`);
  });
  it("matches inline controls by piece and starting system without export input duplicates", async () => {
    const html = await (await AstroContainer.create()).renderToString(SystemStack, { props: { piece, exportParts: exportSegments([piece]) } });
    expect(html).toContain('aria-label="In PDF: Introit"');
    expect(html).toContain('data-inline-part="dominica-i-adventus:0"');
    expect(html).not.toContain('name="export-part"');
    expect(html).toMatch(/<label[^>]*class="include[^>]*hidden/);
  });
});
