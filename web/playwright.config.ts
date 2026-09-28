import { defineConfig, devices } from "@playwright/test";

// Browser tests of the built site (dist/) on Cloudflare's own runtime
// (`wrangler pages dev`), with the admin Functions and a throwaway corrections
// database: migrated from workers/corrections/migrations and seeded from
// e2e/seed.sql on every run. The admin screen signs in the test editor through
// its localhost-only development address. Build first: `pnpm build`.
const PORT = 8799;
const STATE = "e2e/.state";
const wrangler = "pnpm exec wrangler";

export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: [
      `${wrangler} d1 migrations apply cantusorgani-corrections --local --persist-to ${STATE}`,
      `${wrangler} d1 execute cantusorgani-corrections --local --persist-to ${STATE} --file e2e/seed.sql`,
      `${wrangler} pages dev dist --port ${PORT} --persist-to ${STATE} --show-interactive-dev-session=false ` +
        "--binding EDITORS=editor@example.org --binding ADMIN_DEV_EMAIL=editor@example.org",
    ].join(" && "),
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
