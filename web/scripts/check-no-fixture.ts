// Fails when a build output contains anything that exists only in the experimental fixture manifest
// (web/src/lib/export-layout/__fixtures__/manifest.fixture.json): a production build must never resolve it.
//
//   node scripts/check-no-fixture.ts [dir]      (default: dist)
//
// `pnpm build` runs this on dist/. dist-e2e/ is built WITH the fixture and is not checked.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import fixture from "../src/lib/export-layout/__fixtures__/manifest.fixture.json" with { type: "json" };

interface FixturePart { readonly meiSha256: string; readonly digest: string; readonly meiUrl: string; readonly profile: string }

/** Strings that appear only in the fixture: its MEI digest, its URL and its unapproved profile name. */
export function fixtureMarkers(): string[] {
  const markers = new Set<string>(["accompaniment-v1-unapproved", "__fixtures__/kyrie-ix", "experimental, unapproved, never published"]);
  for (const part of fixture.parts as readonly FixturePart[]) { markers.add(part.meiSha256); markers.add(part.digest); markers.add(part.meiUrl); }
  return [...markers];
}

const TEXT = /\.(js|mjs|html|json|css|txt|xml|map)$/;

export function findFixtureMarkers(dir: string, markers: readonly string[] = fixtureMarkers()): { file: string; marker: string }[] {
  const hits: { file: string; marker: string }[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const path = join(d, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (TEXT.test(name) && stat.size < 64 * 1024 * 1024) {
        const text = readFileSync(path, "utf8");
        for (const marker of markers) if (text.includes(marker)) hits.push({ file: path, marker });
      }
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] ?? "dist";
  const hits = findFixtureMarkers(dir);
  if (hits.length > 0) {
    console.error(`check-no-fixture: ${dir}/ contains fixture-only content (a production build must never resolve the fixture manifest):`);
    for (const h of hits.slice(0, 10)) console.error(`  ${h.file}: ${h.marker}`);
    process.exit(1);
  }
  console.log(`check-no-fixture: ${dir}/ has no fixture-only content`);
}
