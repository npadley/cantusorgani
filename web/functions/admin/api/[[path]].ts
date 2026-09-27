// /admin/api/*: the admin screen's API. Cloudflare Access guards /admin/*, and
// handleAdmin checks the Access token and the EDITORS list again itself.
import { handleAdmin } from "../../../src/lib/admin/api";
import type { AdminEnv } from "../../../src/lib/admin/api";

export const onRequest = (context: { request: Request; env: AdminEnv }): Promise<Response> =>
  handleAdmin(context.request, context.env);
