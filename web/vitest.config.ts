/// <reference types="vitest" />
import { getViteConfig } from "astro/config";

// getViteConfig lets tests render .astro components (see *.astro.test.ts).
export default getViteConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts", "src/workers/**", "src/env.d.ts"],
      thresholds: { lines: 95, functions: 95, statements: 95, branches: 85 },
    },
  },
});
