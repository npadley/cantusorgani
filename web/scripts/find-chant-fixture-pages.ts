// Finds the two built pages the chant export tests use, and writes pages.json.
//
//   pnpm build            (produces web/dist)
//   node scripts/find-chant-fixture-pages.ts
//
// Query over web/dist/**/index.html. A page links a chant when it carries a
// `.chant-notation[data-chant-id]` box (the markup chantNotation.ts draws).
// Chant ids are looked up in data/chants.json for their GABC length.
//
//   kyrie:    the Kyriale page (kyriale/*) whose linked chant is Kyrie IX, #2976.
//             The script fails if no Kyriale page links that chant.
//   longest:  the page whose linked chant has the most GABC characters
//             (ties: first in path order). Must differ from `kyrie`.
//
// The output has dist-relative paths, e.g. "kyriale/ix/index.html".
import { readFile, readdir, stat, writeFile } from "node:fs/promises";

const REPO = new URL("../../", import.meta.url);
const DIST = new URL("web/dist/", REPO);
const OUT = new URL("web/src/lib/export-layout/__fixtures__/chant/pages.json", REPO);
const KYRIE_IX_CHANT_ID = "2976";

interface ChantRecord { readonly gabc: string }

async function listIndexPages(): Promise<string[]> {
  const entries = await readdir(DIST, { recursive: true });
  return entries
    .filter((p) => p === "index.html" || p.endsWith("/index.html"))
    .sort();
}

async function main(): Promise<void> {
  const chants = (JSON.parse(await readFile(new URL("data/chants.json", REPO), "utf8")) as
    { chants: Record<string, ChantRecord> }).chants;
  const pages = await listIndexPages();
  if (pages.length === 0) throw new Error("web/dist has no pages; run pnpm build first");

  const linked = new Map<string, string[]>();
  for (const page of pages) {
    const html = await readFile(new URL(page, DIST), "utf8");
    const ids = [...html.matchAll(/<[^>]*class="chant-notation"[^>]*data-chant-id="(\d+)"/g)].map((m) => m[1] ?? "");
    const unique = [...new Set(ids)];
    if (unique.length > 0) linked.set(page, unique);
  }

  const kyriale = [...linked.keys()].filter((p) => p.startsWith("kyriale/"));
  const kyrie = kyriale.find((p) => linked.get(p)?.includes(KYRIE_IX_CHANT_ID));
  if (!kyrie) throw new Error(`no kyriale page links chant #${KYRIE_IX_CHANT_ID}`);

  let longest: { page: string; length: number } | null = null;
  for (const [page, ids] of linked) {
    if (page === kyrie) continue;
    for (const id of ids) {
      const gabc = chants[id]?.gabc;
      if (gabc === undefined) continue;
      if (longest === null || gabc.length > longest.length) longest = { page, length: gabc.length };
    }
  }
  if (longest === null) throw new Error("no page links a chant with GABC");

  for (const page of [kyrie, longest.page]) {
    await stat(new URL(page, DIST));
  }
  const out = { kyrie, longest: longest.page };
  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`kyrie: ${kyrie} (chant #${KYRIE_IX_CHANT_ID})`);
  console.log(`longest: ${longest.page} (${longest.length} GABC characters)`);
}

await main();
