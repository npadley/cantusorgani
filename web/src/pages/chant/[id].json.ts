import type { APIRoute, GetStaticPaths } from "astro";

import { chantEntry, chantIds } from "../../lib/chants";

// One small static file per chant, fetched only when a viewer shows the chant.
export const getStaticPaths: GetStaticPaths = () =>
  chantIds().map((id) => ({ params: { id: String(id) } }));

export const GET: APIRoute = ({ params }) => {
  const entry = chantEntry(Number(params["id"]));
  if (!entry) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(entry), { headers: { "Content-Type": "application/json" } });
};
