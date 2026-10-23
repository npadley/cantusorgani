import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type RouteId = string;
type TemplateRoute = { id: RouteId; url: string };

// Known violations outside this check's scope must name the rule and explain why.
const ALLOWLIST: Record<RouteId, { rule: string; reason: string }[]> = {};

const routes: TemplateRoute[] = JSON.parse(
  readFileSync(resolve("e2e/routes.json"), "utf8"),
);
const seen = new Set<string>();
const templates = routes.filter(({ url }) => {
  if (seen.has(url)) return false;
  seen.add(url);
  return true;
});

test.describe("Accessibility of page templates", () => {
  for (const scheme of ["light", "dark"] as const) for (const { id, url } of templates) {
    test(`${id} (${scheme}) should have no serious or critical axe violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const violations = results.violations.filter((violation) =>
        (violation.impact === "serious" || violation.impact === "critical") &&
        !(ALLOWLIST[id] ?? []).some(({ rule }) => rule === violation.id),
      );
      const details = violations.map((violation) =>
        `${violation.id} (${violation.impact}): ${violation.nodes.map((node) => JSON.stringify(node.target)).join(", ")}`,
      ).join("\n");

      expect(violations, `${id} (${url}) accessibility violations:\n${details}`).toEqual([]);
    });
  }
});
