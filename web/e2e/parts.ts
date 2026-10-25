// Ticks export parts the way the page offers them: the "Choose parts" disclosure of the default export bar
// (day, OF, Vespers pages), the service rail's list at 62rem and wider, or the rail's sheet below 62rem.
import type { Page } from "@playwright/test";

export async function setParts(page: Page, wanted: (label: string | null) => boolean): Promise<void> {
  const details = page.locator("details.parts");
  const opener = page.locator("[data-choose-parts]");
  const sheet = (await opener.count()) > 0 && await opener.isVisible() ? page.locator("#choose-parts-sheet") : null;
  if (await details.count()) await details.evaluate((d) => { (d as HTMLDetailsElement).open = true; });
  if (sheet) await opener.click();
  for (const box of await page.locator('input[name="export-part"]').all()) {
    if (wanted(await box.getAttribute("data-label")) !== (await box.isChecked())) await box.locator("xpath=..").click();
  }
  if (sheet) await sheet.getByRole("button", { name: "Done", exact: true }).click();
  if (await details.count()) await details.evaluate((d) => { (d as HTMLDetailsElement).open = false; });
}
