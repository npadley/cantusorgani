import type { APIRoute } from "astro";

import { allPieces, systemUrlStem } from "../../lib/catalog";
import { pieceHref } from "../../lib/indexes";
import type { TargetPiece, Targets } from "../../lib/admin/targets";

// Every correctable piece with its current values and first system: what the
// admin screen shows beside a correction, and what the admin API checks one
// against. Static and public: it holds nothing the piece pages do not.
export const GET: APIRoute = () => {
  const pieces: Record<string, TargetPiece> = {};
  for (const p of allPieces()) {
    const aspect = p.systemAspect[0];
    pieces[p.slug] = {
      id: p.id, slug: p.slug, volume: p.volume, label: p.label, href: pieceHref(p),
      title: p.title, incipit: p.incipit, mode: p.mode, genre: p.genre, printed_pages: p.printedPages,
      stem: p.systems.length > 0 ? systemUrlStem(p, 0) : null,
      aspect: aspect ? [aspect[0], aspect[1]] : null,
    };
  }
  const genres = [...new Set(allPieces().map((p) => p.genre))].sort();
  const body: Targets = { pieces, genres };
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
};
