import { expect, test } from "@playwright/test";
import { dateLabel } from "../src/lib/dayService";
import type { DayTable } from "../src/lib/dayService";

const DAY = "/day/sancti/05-26/";
const shiftDate = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

test.describe("day reader", () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test("reads Proper then the build's Ordinary without JavaScript", async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, baseURL: baseURL! });
    const page = await context.newPage();
    try {
      await page.goto(DAY);
      await expect(page.locator("#music .systems").first()).toBeVisible();
      await expect(page.locator("section.ordinary:not([hidden]) .systems")).toBeVisible();
      const data = JSON.parse((await page.locator(".export").getAttribute("data-day-service"))!) as { buildDefaultIso: string };
      expect(await page.locator("[data-day-summary]").textContent()).toContain(new Date(`${data.buildDefaultIso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));
      await expect(page.getByText("Export needs JavaScript.", { exact: true })).toBeVisible();
    } finally { await context.close(); }
  });

  for (const index of [0, 1]) test(`dated service ${index + 1} reads and selects only its Ordinary`, async ({ page }) => {
    await page.goto(DAY, { waitUntil: "networkidle" });
    const data = JSON.parse((await page.locator(".export").getAttribute("data-day-service"))!) as { table: DayTable };
    const masses = data.table.options.filter((o, i, all) => o.mass !== null && all.findIndex(other => other.mass === o.mass) === i
      && data.table.groups.some(g => g.option === o.key && g.dates.length > 0));
    expect(masses.length, "St Philip Neri needs at least two dated, non-null Mass options").toBeGreaterThanOrEqual(2);
    const chosen = masses[index]!;
    const date = data.table.groups.find(g => g.option === chosen.key)!.dates[0]!;
    const mass = chosen.mass!;
    const requests: string[] = [];
    page.on("request", req => { if (req.resourceType() === "image") requests.push(req.url()); });
    await page.goto(`${DAY}?date=${date}`, { waitUntil: "networkidle" });
    const root = page.locator(".export");
    await expect(page.locator(`section.ordinary[data-ordinary-option="${chosen.key}"]`)).toBeVisible();
    await expect(page.locator(`section.ordinary[data-ordinary-option="${chosen.key}"]`)).toContainText(`Missa ${mass}`);
    for (const option of data.table.options) {
      const active = option.key === chosen.key;
      const section = page.locator(`section.ordinary[data-ordinary-option="${option.key}"]`);
      if (active) await expect(section).toBeVisible();
      else await expect(section).toBeHidden();
      const boxes = root.locator(`input[name="export-part"][data-ordinary-option="${option.key}"]`);
      expect(await boxes.count()).toBeGreaterThan(0);
      for (const box of await boxes.all()) {
        if (active) { await expect(box).toBeVisible(); await expect(box).toBeChecked(); await expect(box).toBeEnabled(); }
        else { await expect(box).toBeHidden(); await expect(box).not.toBeChecked(); await expect(box).toBeDisabled(); }
      }
    }
    const total = await root.locator('input[name="export-part"]:enabled').count();
    await expect(page.locator("#selection-status")).toContainText(`of ${total} parts`);
    await expect(root).toHaveAttribute("data-title", new RegExp(`with Missa ${mass} — ${dateLabel(date)}`));
    const hiddenUrls = await page.locator("section.ordinary[hidden]").evaluateAll(sections => sections.flatMap(section => {
      return [...section.querySelectorAll("img, source")].flatMap(node => {
        const urls = [node.getAttribute("src"), ...(node.getAttribute("srcset") ?? "").split(",").map(s => s.trim().split(/\s+/)[0])];
        return urls.filter((s): s is string => Boolean(s)).map(s => new URL(s, location.href).href);
      });
    }));
    expect(requests.filter(url => hiddenUrls.includes(url)), "hidden Ordinary images requested on load").toEqual([]);
    await expect(page.locator("section.ordinary[hidden] img[loading='eager']")).toHaveCount(0);
    // Capture the shared model, not just checkbox paint.
    await root.evaluate(node => node.addEventListener("selectionchange", event => {
      if (!(event instanceof CustomEvent)) return;
      const selection = event.detail as { segments: { id: string; included: boolean }[] };
      (node as HTMLElement).dataset["e2eSelection"] = JSON.stringify(selection.segments.map(s => ({ id: s.id, included: s.included })));
    }));
    await page.getByRole("button", { name: "Clear", exact: true }).click();
    await expect(root.locator('input[name="export-part"]:checked')).toHaveCount(0);
    expect((JSON.parse((await root.getAttribute("data-e2e-selection"))!) as { included: boolean }[]).some(s => s.included)).toBe(false);
    // Select all cannot introduce the other Ordinary into the model.
    await page.getByRole("button", { name: "Select all", exact: true }).click();
    await expect(root.locator('input[name="export-part"]:disabled:checked')).toHaveCount(0);
    const selected = JSON.parse((await root.getAttribute("data-e2e-selection"))!) as { id: string; included: boolean }[];
    expect(selected).toHaveLength(total);
    expect(selected.every(s => s.included)).toBe(true);
    await expect(page.locator("[data-day-summary]")).toContainText(`For ${dateLabel(date)}:`);
    await expect(page.locator("#export-status")).not.toContainText("For ");
    expect(selected.some(s => s.id.startsWith(`${chosen.key}:`))).toBe(true);
    expect(selected.filter(s => s.id.startsWith("ordinary-")).every(s => s.id.startsWith(`${chosen.key}:`))).toBe(true);
  });

  test("invalid dates explain the fallback and keep the canonical", async ({ page }) => {
    await page.goto(DAY);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    const defaultTitle = await page.locator(".export").getAttribute("data-title");
    const data = JSON.parse((await page.locator(".export").getAttribute("data-day-service"))!) as { table: DayTable; buildDefaultIso: string };
    const matching = new Set(data.table.groups.flatMap(g => g.dates));
    let nonmatching: string | undefined;
    for (let iso = data.table.start; iso <= data.table.end; iso = shiftDate(iso, 1)) {
      if (!matching.has(iso)) { nonmatching = iso; break; }
    }
    expect(nonmatching, "a valid in-range date outside this occasion").toBeDefined();
    for (const query of ["bad-date", nonmatching!, shiftDate(data.table.start, -1), shiftDate(data.table.end, 1)]) {
      await page.goto(`${DAY}?date=${query}`);
      await expect(page.locator("[data-day-message]")).toBeVisible();
      const reason = query === "bad-date" ? "That isn't a date we can read" : `This occasion doesn't fall on ${dateLabel(query)}`;
      await expect(page.locator("[data-day-message]")).toHaveText(`${reason}. Showing ${dateLabel(data.buildDefaultIso)}.`);
      await expect(page.locator(".export")).toHaveAttribute("data-title", defaultTitle!);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical!);
    }
  });
});
