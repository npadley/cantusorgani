// Can a reader reach every page of the built site by following links?
//
//   node scripts/check-links.ts [dist]
//
// Run by `pnpm build` after Pagefind. Fails with each orphaned page, broken
// link or unlisted Vespers page, and what to do about it (src/lib/reach.ts).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, missingFrom, pathFor, reach } from "../src/lib/reach.ts";
import type { BuiltPage } from "../src/lib/reach.ts";

const dist = process.argv[2] ?? "dist";
const pages: BuiltPage[] = [];
const files = new Set<string>();

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full);
    } else if (name.endsWith(".html")) {
      pages.push({ path: pathFor(relative(dist, full)), html: readFileSync(full, "utf8") });
    } else {
      files.add(pathFor(relative(dist, full)));
    }
  }
}
walk(dist);

const report = reach(pages, files);
const unlisted = missingFrom(pages.find((p) => p.path === "/vespers/"), pages, /^\/vespers\/\d{4}-\d{2}-\d{2}\//);
const problems = describe(report, unlisted);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`check-links: all ${pages.length} pages reachable from /, no broken internal links`);
