import type { APIRoute } from "astro";

import { buildTargets } from "../../lib/admin/targetIndex";

// Everything a correction can name, with its current values and a picture: what
// the Corrections form and the admin screen show, and what the admin API checks
// a correction against. Static and public: it holds nothing the pages do not.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildTargets()), { headers: { "content-type": "application/json" } });
