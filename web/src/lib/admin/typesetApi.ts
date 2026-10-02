import type { AdminEnv, Deps } from "./api";
import type { Editor } from "./auth";
import { githubConfigured, readMain, readSource } from "./github";
import { checkSource, validSourceSize } from "./sourceCheck";
import { sourceContentHash, typesetStore } from "./typesetStore";
import { isTypesetFile } from "../../../../workers/corrections/src/schema";
export interface SourceRepository {
  readMain(): Promise<{commitSha:string;treeSha:string}>;
  readSource(file:string,ref:string): Promise<{text:string;blobSha:string}>;
}
const json = (body: unknown, status=200) => Response.json(body,{status});
const fail = (status:number,error:string,extra:Record<string,unknown>={}) => json({error,...extra},status);
export async function typesetApi(request: Request, env: AdminEnv, deps: Deps, editor: Editor, path: string, input?: Record<string,unknown>): Promise<Response> {
  const file = input?.["file"] ?? new URL(request.url).searchParams.get("file");
  const targets = await deps.targets();
  if (typeof file !== "string" || !isTypesetFile(file) || !Object.hasOwn(targets.typeset ?? {},file)) return fail(422,"Choose a known transcription file.");
  if (!deps.source && !githubConfigured(env)) return fail(503,"Source editing needs the GitHub App configuration.");
  const repository = deps.source ?? { readMain: () => readMain(env), readSource: (file:string,ref:string) => readSource(env,file,ref) };
  const store = typesetStore(env.DB);
  const draft = await store.getDraft(editor.email,file);
  if (path !== "/typeset/source" && path !== "/typeset/draft" && path !== "/typeset/approve") return fail(404,"Not found.");
  if (path === "/typeset/draft") {
    if (typeof input?.["text"] !== "string" || !validSourceSize(input["text"])) return fail(413,"Source must be text of at most 60 KiB in UTF-8.");
    const problems = checkSource(input["text"]);
    if (problems.length) return fail(422,"Source check failed.",{problems});
  }
  const main = await repository.readMain();
  const current = await repository.readSource(file,main.commitSha);
  if (path === "/typeset/source") return json({file,current,draft,renderHash:targets.typeset?.[file]?.hash ?? null});
  const revision = input?.["expectedRevision"];
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return fail(400,"Supply the draft revision shown by the editor.");
  const base = path === "/typeset/draft" ? input?.["baseBlobSha"] : draft?.baseBlobSha;
  if (base !== current.blobSha) return fail(409,"The repository source changed. Compare both versions before saving or approving.",{current,draft});
  if (path === "/typeset/draft") {
    const text = input!["text"] as string;
    const saved = await store.saveDraft(editor.email,{file,text,baseBlobSha:current.blobSha,contentHash:await sourceContentHash(text)},revision);
    if (!saved) return fail(409,"This draft changed in another tab. Reload before saving.",{current,draft:await store.getDraft(editor.email,file)});
    await deps.store.log(editor.email,"source-save",null,file);
    return json({draft:saved});
  }
  const note = input?.["note"] ?? "";
  const reportId = input?.["reportId"];
  if (typeof note !== "string" || note.length > 200 || (reportId !== undefined && (typeof reportId !== "number" || !Number.isSafeInteger(reportId) || reportId <= 0))) return fail(400,"Supply a public reason of at most 200 characters and a valid report id.");
  if (!draft || draft.revision !== revision) return fail(409,"The draft changed. Reload before approving.",{current,draft});
  if (!validSourceSize(draft.text) || checkSource(draft.text).length) return fail(422,"The saved draft fails the source check.");
  const id = await store.approveDraft(editor.email,file,revision,note,reportId as number | undefined);
  if (!id) return fail(409,"Another source edit is already approved, or the draft/report changed. Check the corrections queue.");
  await deps.store.log(editor.email,"source-approve",id,file);
  return json({id,status:"approved"},201);
}
