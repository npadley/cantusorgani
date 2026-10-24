import { expect, test } from "@playwright/test";

const themes = [
  { name: "Light", colorScheme: "light", inverted: false,
    ink: "rgb(32, 37, 34)", rubric: "rgb(160, 0, 0)" },
  { name: "Dark", colorScheme: "dark", inverted: false,
    ink: "rgb(238, 239, 233)", rubric: "rgb(240, 170, 162)" },
  { name: "Invert", colorScheme: "light", inverted: true,
    ink: "rgb(238, 239, 233)", rubric: "rgb(240, 170, 162)" },
] as const;

for (const theme of themes) {
  test(`${theme.name}: chant neumes follow ink and rubrics keep their colour`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme.colorScheme });
    await page.addInitScript((inverted) => {
      localStorage.removeItem("scan-polarity");
      if (inverted) localStorage.setItem("scan-polarity", "inverted");
    }, theme.inverted);
    await page.goto("/piece/dominica-i-adventus/");
    await page.locator("[data-chant-toggle]").check();

    const chant = page.locator(".chant-notation").first();
    await chant.scrollIntoViewIfNeeded();
    const drawing = chant.locator(".chant-drawing svg");
    await expect(drawing).toBeVisible({ timeout: 15_000 });

    // Exsurge's use.note instances are rendered notes, unlike the glyph
    // definitions in <defs>; rubric signs use the page's rubric colour.
    const neume = drawing.locator("use.note").first();
    const rubric = drawing.locator('[style*="--rubric"], [fill*="--rubric"]').first();
    await expect(neume).toBeVisible();
    await expect(rubric).toBeVisible();

    // Resolve the page tokens through SVG fill so both sides use the browser's
    // computed rgb() representation, rather than comparing hex with rgb().
    const tokens = await drawing.evaluate((svg) => {
      const probe = document.createElementNS("http://www.w3.org/2000/svg", "g");
      svg.appendChild(probe);
      probe.style.fill = "var(--ink)";
      const ink = getComputedStyle(probe).fill;
      probe.style.fill = "var(--rubric)";
      const rubric = getComputedStyle(probe).fill;
      probe.remove();
      return { ink, rubric };
    });

    expect(tokens).toEqual({ ink: theme.ink, rubric: theme.rubric });
    expect(await neume.evaluate((glyph) => getComputedStyle(glyph).fill)).toBe(tokens.ink);
    expect(await rubric.evaluate((glyph) => getComputedStyle(glyph).fill)).toBe(tokens.rubric);
  });
}
