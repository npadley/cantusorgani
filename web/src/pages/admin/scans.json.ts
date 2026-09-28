import type { APIRoute } from "astro";

import { buildScans } from "../../lib/admin/targetIndex";

// Every catalogued system's image key and size, for the pictures beside each
// correction on the admin screens. Under /admin/, so Access serves it only to
// editors; it holds nothing the public pages do not.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(buildScans()), { headers: { "content-type": "application/json" } });
