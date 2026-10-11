import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

test.describe("Ordinary Form discovery and date calendar", () => {
  test("names both forms in the header and keeps the EF calendar heading", async ({ page }) => {
    await page.goto("/calendar/");
    await expect(page.getByRole("link", { name: "Extraordinary Form (1962) calendar" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ordinary Form calendar" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Calendar: Extraordinary Form (1962)" })).toBeVisible();
  });

  test("uses short labels on a narrow header while keeping full accessible names", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/calendar/");
    const ef = page.getByRole("link", { name: "Extraordinary Form (1962) calendar" });
    const of = page.getByRole("link", { name: "Ordinary Form calendar" });
    await expect(ef.locator(".form-full")).toBeHidden();
    await expect(ef.locator(".form-short")).toBeVisible();
    await expect(ef.locator(".form-short")).toHaveText("EF (1962)");
    await expect(of.locator(".form-full")).toBeHidden();
    await expect(of.locator(".form-short")).toBeVisible();
    await expect(of.locator(".form-short")).toHaveText("OF");
  });

  test("home page links directly to the Ordinary Form calendar", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-10-11T12:00:00") });
    await page.goto("/");
    await page.getByRole("link", { name: "Find the Mass for any date in the Ordinary Form" }).click();
    await expect(page).toHaveURL(/\/calendar\/ordinary-form\//);
    await expect(page.getByLabel("Date")).toHaveValue("2026-10-11");
    await expect(page.getByText("Year A · Weekday Year II")).toBeVisible();
  });

  test("Ordinary Form pages are discoverable and keep source music references", async ({ page }) => {
    await page.goto("/ordinary-form/easter/");
    await expect(page.getByRole("heading", { name: /Easter Sunday/ })).toBeVisible();
    await expect(page.getByText(/Graduale Romanum \(1974\)/).first()).toBeVisible();
    const sitemap = await page.request.get("/sitemap.xml");
    expect(await sitemap.text()).toContain("https://cantusorgani.org/ordinary-form/easter/");
  });

  test("date links carry cycle and season into the composed page selection", async ({ page }) => {
    await page.goto("/calendar/ordinary-form/?date=2026-04-05");
    await expect(page.getByText("Year A · Weekday Year II")).toBeVisible();
    await page.getByRole("link", { name: "View accompaniments for this occasion" }).click();
    await expect(page).toHaveURL(/cycle=A.*season=easter|season=easter.*cycle=A/);
    await expect(page.locator("#of-export-note")).toContainText("Year A · easter season");
  });

  test("presets derive Custom and reset writes explicit defaults to the URL", async ({ page }) => {
    await page.goto("/calendar/ordinary-form/?date=2026-04-05");
    await page.getByLabel("Sunday transfers", { exact: true }).check();
    await expect(page).toHaveURL(/epiphany=sunday.*ascension=sunday.*corpusChristi=sunday/);
    await page.getByLabel("6 January", { exact: true }).check();
    await expect(page.getByLabel("Custom")).toBeChecked();
    await expect(page.locator("#settings-changed")).toContainText("Calendar settings changed");
    await page.getByRole("button", { name: "Reset to General Roman" }).click();
    await expect(page).toHaveURL(/epiphany=jan6.*ascension=thursday.*corpusChristi=thursday/);
    await expect(page.getByLabel("General Roman", { exact: true })).toBeChecked();
  });

  test("browser back and forward restore the selected date and live result", async ({ page }) => {
    await page.goto("/calendar/ordinary-form/?date=2026-04-05");
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page).toHaveURL(/date=2026-04-06/);
    await expect(page.locator("#date")).toHaveValue("2026-04-06");
    await page.goBack();
    await expect(page.locator("#date")).toHaveValue("2026-04-05");
    await page.goForward();
    await expect(page.locator("#date")).toHaveValue("2026-04-06");
  });

  test("back restores stored initial settings from a bare URL after an edit", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem("cantusorgani.ordinary-form.settings.v1", JSON.stringify({
      epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday",
    })));
    const page = await context.newPage();
    await page.goto("/calendar/ordinary-form/");
    await expect(page.getByLabel("Sunday transfers", { exact: true })).toBeChecked();
    await expect(page).toHaveURL(/epiphany=sunday.*ascension=sunday.*corpusChristi=sunday/);
    await page.getByLabel("6 January", { exact: true }).check();
    await expect(page.getByLabel("Custom", { exact: true })).toBeChecked();
    await page.goBack();
    await expect(page.getByLabel("Sunday transfers", { exact: true })).toBeChecked();
    await expect(page.getByLabel("6 January", { exact: true })).not.toBeChecked();
    await context.close();
  });

  test("submitting a date with Enter preserves all effective transfer settings", async ({ page }) => {
    await page.goto("/calendar/ordinary-form/?date=2026-04-05&epiphany=jan6&ascension=sunday&corpusChristi=thursday");
    await page.locator("#date").fill("2026-04-06");
    await page.locator("#date").press("Enter");
    await expect(page).toHaveURL(/date=2026-04-06.*epiphany=jan6.*ascension=sunday.*corpusChristi=thursday/);
    await expect(page.getByLabel("6 January", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Sunday", { exact: true }).nth(1)).toBeChecked();
    await expect(page.getByLabel("Thursday", { exact: true }).last()).toBeChecked();
  });

  test("cycle and season links filter an occasion's export checkboxes without hiding static chants", async ({ page }) => {
    await page.goto("/ordinary-form/easter/?cycle=B&season=easter");
    const boxes = page.locator('input[name="export-part"]');
    await expect(boxes).not.toHaveCount(0);
    for (const box of await boxes.all()) {
      const years = (await box.getAttribute("data-years") ?? "").split(",").filter(Boolean);
      const seasons = (await box.getAttribute("data-seasons") ?? "").split(",").filter(Boolean);
      const eligible = (!years.length || years.includes("B")) && (!seasons.length || seasons.includes("easter"));
      if (eligible) await expect(box).toBeChecked();
      else await expect(box).not.toBeChecked();
    }
    await expect(page.locator("#of-export-note")).toContainText("Year B · easter season");
    await page.goto("/ordinary-form/annunciation/?cycle=A&season=easter");
    await expect(page.locator("#music")).toBeVisible();
    await expect(page.locator("#of-export-note")).toContainText("Every applicable alternative starts selected");
  });

  test("builds Letter, A4, and scan PDFs from composed lender assets without dropping sections", async ({ page }) => {
    const png = await readFile(new URL("../src/lib/__fixtures__/slices/noh5/0051/000@2x.png", import.meta.url));
    const sourcePdf = await PDFDocument.create();
    sourcePdf.addPage([612, 792]).drawText("controlled typeset fixture");
    const pdf = Buffer.from(await sourcePdf.save());
    const requests: string[] = [];
    let failPdfs = false;
    let failSvgHash: string | null = null;
    await page.goto("/"); // Establish the same-origin URL before intercepting deterministic assets.
    await page.context().route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname.includes("/typeset/") && url.searchParams.has("export") && url.pathname.endsWith(".pdf")) {
        requests.push(url.href);
        if (failPdfs) return route.fulfill({ status: 503, body: "controlled typeset failure" });
        return route.fulfill({ status: 200, contentType: "application/pdf", headers: { "access-control-allow-origin": "*" }, body: pdf });
      }
      if (url.pathname.includes("/systems/") && url.searchParams.has("export") && url.pathname.endsWith(".png")) {
        requests.push(url.href);
        return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: png });
      }
      if (url.pathname.includes("/typeset/") && url.pathname.endsWith(".svg") && failSvgHash && url.pathname.includes(`/${failSvgHash}/`))
        return route.fulfill({ status: 503, body: "controlled image failure" });
      if (url.pathname.includes("/typeset/") && url.pathname.endsWith(".svg"))
        return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: { "access-control-allow-origin": "*" }, body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>' });
      if (url.pathname.includes("/systems/") && url.pathname.endsWith(".webp"))
        return route.fulfill({ status: 200, contentType: "image/png", body: png });
      if (url.origin !== new URL(page.url()).origin) return route.abort();
      return route.continue();
    });
    await page.goto("/ordinary-form/easter/?cycle=A&season=easter");
    const boxes = page.locator('input[name="export-part"]');
    await expect(boxes).toHaveCount(6);
    for (const box of await boxes.all()) await expect(box).toBeChecked();

    const doExport = async () => {
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /Export PDF/ }).click();
      const download = await downloadPromise;
      const bytes = await readFile((await download.path())!);
      expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
      await expect(page.locator("#export-status")).toContainText("PDF ready");
    };

    await doExport();
    expect(requests.filter(url => url.endsWith("letter.pdf?export=1"))).toHaveLength(6);
    requests.length = 0;
    await page.locator("#export-paper").selectOption("a4");
    await doExport();
    expect(requests.filter(url => url.endsWith("a4.pdf?export=1"))).toHaveLength(6);

    requests.length = 0;
    await page.getByRole("button", { name: "Show the scans" }).click();
    await doExport();
    expect(requests.filter(url => url.endsWith(".png?export=1"))).toHaveLength(43);
    expect(requests.some(url => url.endsWith(".pdf?export=1"))).toBe(false);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-view", "scans");
    requests.length = 0;
    await doExport();
    expect(requests.filter(url => url.endsWith(".png?export=1"))).toHaveLength(43);

    requests.length = 0;
    await page.getByRole("button", { name: "Show the typeset music" }).click();
    const firstSegment = page.locator(".typeset-segment").first();
    const firstKey = await firstSegment.getAttribute("data-typeset-key");
    await firstSegment.evaluate(segment => segment.insertAdjacentElement("afterend", segment.cloneNode(true) as HTMLElement));
    const repeated = page.locator(`[data-typeset-key="${firstKey}"]`);
    await expect(repeated).toHaveCount(2);
    await repeated.first().locator(".show-scan").click();
    await expect(repeated.nth(1)).toHaveAttribute("data-show", "scan");
    await doExport();
    expect(requests.filter(url => url.endsWith(".pdf?export=1"))).toHaveLength(5);
    expect(requests.filter(url => url.endsWith(".png?export=1"))).toHaveLength(10);

    failPdfs = true;
    requests.length = 0;
    await doExport();
    await expect(page.locator("#export-status")).toContainText("could not be fetched, so its scans are in the PDF");
    expect(requests.filter(url => url.endsWith(".pdf?export=1"))).toHaveLength(5);
    expect(requests.filter(url => url.endsWith(".png?export=1"))).toHaveLength(43);

    failPdfs = false;
    failSvgHash = new URL(JSON.parse((await boxes.first().getAttribute("data-runs")) ?? "[]")[0].letter).pathname.split("/").at(-2)!;
    await page.reload();
    const failedSource = new URL(JSON.parse((await boxes.first().getAttribute("data-runs")) ?? "[]")[0].letter).pathname.replace(/letter\.pdf$/, "narrow.svg");
    await page.evaluate((src) => {
      const original = document.querySelector<HTMLElement>(".typeset-segment");
      if (!original) throw new Error("missing source segment");
      const clone = original.cloneNode(true) as HTMLElement;
      original.insertAdjacentElement("afterend", clone);
      const image = original.querySelector<HTMLImageElement>("img.typeset-music");
      if (!image) throw new Error("missing typeset image");
      image.src = `${src}?retry=1`;
    }, failedSource);
    await expect(page.locator(".typeset-segment").first()).toHaveAttribute("data-state", "error");
    await expect(page.locator(".typeset-segment").nth(1)).toHaveAttribute("data-state", "error");
    await expect(page.locator(".typeset-segment").first().locator(".scans")).toBeVisible();
  });

  test("keeps unmapped and weekday notices explicit and supports date-bound navigation", async ({ page }) => {
    await page.goto("/ordinary-form/st-joseph/");
    await expect(page.getByText("chants not yet mapped").first()).toBeVisible();
    await page.goto("/calendar/ordinary-form/?date=2026-01-19");
    await expect(page.getByText("the chants of the preceding Sunday may be used")).toBeVisible();
    await page.goto("/calendar/ordinary-form/?date=2026-04-06");
    await expect(page.getByText("weekday chants are not yet covered")).toBeVisible();
    await page.goto("/calendar/ordinary-form/?date=2051-01-01");
    await expect(page.locator("#date-feedback")).toContainText("covers 2024–2050");
    await expect(page.getByRole("button", { name: "Next day" })).toBeDisabled();
  });

  test("shows the provisional 2038 Corpus Christi and Nativity transfer notice", async ({ page }) => {
    await page.goto("/calendar/ordinary-form/?date=2038-06-24&epiphany=jan6&ascension=thursday&corpusChristi=thursday");
    await expect(page.getByRole("heading", { name: "The Most Holy Body and Blood of Christ" })).toBeVisible();
    await expect(page.getByText(/Provisional:.*Nativity of John the Baptist.*June 25/)).toBeVisible();
    await page.goto("/calendar/ordinary-form/?date=2038-06-25&epiphany=jan6&ascension=thursday&corpusChristi=thursday");
    await expect(page.getByRole("heading", { name: "The Nativity of Saint John the Baptist" })).toBeVisible();
    await expect(page.getByText(/Provisional:.*Corpus Christi.*June 24/)).toBeVisible();
  });

  test("keyboard radio navigation changes settings and reset focus stays on its control", async ({ page }) => {
    await page.goto("/calendar/ordinary-form/?date=2026-04-05");
    const generalRoman = page.getByLabel("General Roman", { exact: true });
    await generalRoman.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByLabel("Sunday transfers", { exact: true })).toBeChecked();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const reset = page.getByRole("button", { name: "Reset to General Roman" });
    await reset.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("General Roman", { exact: true })).toBeChecked();
    await expect(reset).toBeFocused();
  });

  test("a shared default URL overrides another context's saved transfers", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => localStorage.setItem("cantusorgani.ordinary-form.settings.v1", JSON.stringify({
      epiphany: "sunday", ascension: "sunday", corpusChristi: "sunday",
    })));
    const page = await context.newPage();
    await page.goto("/calendar/ordinary-form/?date=2026-04-05&epiphany=jan6&ascension=thursday&corpusChristi=thursday");
    await expect(page.getByLabel("6 January", { exact: true })).toBeChecked();
    await expect(page.getByLabel("Thursday", { exact: true }).first()).toBeChecked();
    await context.close();
  });

  test("handles invalid dates and blocked settings storage without losing the calendar", async ({ browser }) => {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      Object.defineProperty(Storage.prototype, "getItem", { value() { throw new DOMException("Blocked", "SecurityError"); } });
      Object.defineProperty(Storage.prototype, "setItem", { value() { throw new DOMException("Blocked", "SecurityError"); } });
    });
    const page = await context.newPage();
    await page.goto("/calendar/ordinary-form/?date=2026-04-05&epiphany=broken");
    await expect(page.getByLabel("General Roman", { exact: true })).toBeChecked();
    await page.goto("/calendar/ordinary-form/?date=2026-02-30");
    await expect(page.locator("#date-feedback")).toContainText("valid date");
    await page.goto("/calendar/ordinary-form/?date=2026-04-05");
    await expect(page.getByRole("heading", { name: "Easter Sunday" })).toBeVisible();
    await page.getByLabel("Sunday", { exact: true }).first().check();
    await expect(page.locator("#settings-changed")).toContainText("Calendar settings changed");
    await context.close();
  });
});
