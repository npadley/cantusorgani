import { defineConfig, devices } from "@playwright/test";

// Browser tests of the built site (dist/) on Cloudflare's own runtime
// (`wrangler pages dev`), with the admin Functions and a throwaway corrections
// database: migrated from workers/corrections/migrations and seeded from
// e2e/seed.sql on every run. The admin screen signs in the test editor through
// its localhost-only development address. Build first: `pnpm build` (or `pnpm build:e2e` for the export specs).
const PORT = 8799;
// The export specs need the fixture manifest and the gated test pages: `pnpm build:e2e` writes dist-e2e/, and
// `pnpm test:e2e:export` points the server at it. Everything else runs against the normal dist/.
const DIST = process.env["E2E_DIST"] ?? "dist";
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
  projects: [
    { name: "chromium", testIgnore: /export-device\.e2e\.ts/, use: { ...devices["Desktop Chrome"] } },
    // The iPad-over-LAN check (e2e/export-device.e2e.ts): an iPad Pro 11 viewport reaching the device-test server by its
    // LAN address, which Safari and Chrome both treat as an insecure context. It runs in WebKit, Safari's engine, when
    // E2E_WEBKIT=1 (after `pnpm exec playwright install webkit`); without it the same checks run in Chromium.
    {
      name: "ipad-lan",
      testMatch: /export-device\.e2e\.ts/,
      use: process.env["E2E_WEBKIT"] === "1"
        ? { ...devices["iPad Pro 11"] }
        : (() => { const { defaultBrowserType: _ignored, ...ipad } = devices["iPad Pro 11"]; return { ...ipad, browserName: "chromium" as const }; })(),
    },
  ],
  webServer: {
    command: [
      `${wrangler} d1 migrations apply cantusorgani-corrections --local --persist-to ${STATE}`,
      `${wrangler} d1 execute cantusorgani-corrections --local --persist-to ${STATE} --file e2e/seed.sql`,
      `${wrangler} pages dev ${DIST} --port ${PORT} --persist-to ${STATE} --show-interactive-dev-session=false ` +
        "--binding EDITORS=editor@example.org --binding ADMIN_DEV_EMAIL=editor@example.org",
    ].join(" && "),
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
