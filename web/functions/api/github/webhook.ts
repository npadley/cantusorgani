// /api/github/webhook: GitHub reports what became of each published batch.
// Outside /admin/ (GitHub cannot pass Access); every request must carry the
// webhook secret's HMAC signature, or it is refused.
import { handleWebhook } from "../../../src/lib/admin/api";
import type { AdminEnv } from "../../../src/lib/admin/api";

export const onRequest = (context: { request: Request; env: AdminEnv }): Promise<Response> =>
  handleWebhook(context.request, context.env);
