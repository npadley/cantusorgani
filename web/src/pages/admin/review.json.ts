import type { APIRoute } from "astro";

import { reviewIndex } from "../../lib/admin/reviews";

// What can be reviewed, and what each review confirms: the admin API checks a
// review against this. Under /admin/, so Access serves it only to editors.
export const GET: APIRoute = () =>
  new Response(JSON.stringify(reviewIndex()), { headers: { "content-type": "application/json" } });
