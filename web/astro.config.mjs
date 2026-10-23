import { defineConfig } from "astro/config";
import sources from "../data/identities/sources.json" with { type: "json" };
import { SITE_ORIGIN } from "./src/lib/seo.ts";

// Static output: the corpus is 2,445 immutable pages of public-domain music.
// Nothing about it is dynamic, so the dataset is the product and the site is a
// thin renderer over it.
export default defineConfig({
  site: SITE_ORIGIN,
  output: "static",
  build: { format: "directory" },
  vite: {
    // Project at build time so correction forms ship only scan keys and labels.
    define: {
      __SOURCE_KEYS__: JSON.stringify(Object.fromEntries(sources.editions
        .filter(e => e.scan_registry_key !== null)
        .map(({ adapter, short_label, scan_registry_key }) =>
          [scan_registry_key, { adapter, short_label, scan_registry_key }]))),
    },
    // Slices live outside web/ during development so the site can be built
    // before anything is uploaded to R2.
    server: { fs: { allow: [".."] } },
    // ES module workers, so a worker can import() a chunk on demand (the layout worker loads Verovio only for music that
    // reflows). The site already starts every worker with { type: "module" }.
    worker: { format: "es" },
  },
});
