import { defineConfig } from "astro/config";
import { SITE_ORIGIN } from "./src/lib/seo.ts";

// Static output: the corpus is 2,445 immutable pages of public-domain music.
// Nothing about it is dynamic, so the dataset is the product and the site is a
// thin renderer over it.
export default defineConfig({
  site: SITE_ORIGIN,
  output: "static",
  build: { format: "directory" },
  vite: {
    // Slices live outside web/ during development so the site can be built
    // before anything is uploaded to R2.
    server: { fs: { allow: [".."] } },
  },
});
