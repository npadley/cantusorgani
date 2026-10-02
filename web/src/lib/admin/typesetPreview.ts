import type { D1Like } from "./store";
import type { GithubEnv } from "./github";
import { githubClient } from "./github";
import { sourceContentHash } from "./typesetStore";
export interface PreviewPayload { file:string; text:string; commitSha:string; key:string }
/** The captured main commit covers includes, renderer code/settings and the LilyPond pin. */
export async function previewKey(file:string,text:string,commitSha:string):Promise<string> {
  return sourceContentHash(["typeset-preview-v1",file,text,commitSha].map(s=>`${new TextEncoder().encode(s).length}:${s}`).join(""));
}
export async function dispatchPreview(env:GithubEnv,payload:PreviewPayload):Promise<void> {
  const api=await githubClient(env);
  await api("dispatches",{method:"POST",body:JSON.stringify({event_type:"typeset-preview",client_payload:payload})});
}
export function previewStore(db:D1Like) {
  return {
    async acquirePreview(email:string,key:string,now:number):Promise<{ok:true;leaseId:number}|{ok:false;reason:"active"|"rate"}> {
      const result=await db.batch<{id?:number;active?:number}>([
        db.prepare("UPDATE typeset_previews SET released=1 WHERE released=0 AND expires_at<=?1").bind(now),
        db.prepare(`INSERT INTO typeset_previews(editor_email,preview_key,admitted_at,expires_at)
          SELECT ?1,?2,?3,?3+300000 WHERE NOT EXISTS(SELECT 1 FROM typeset_previews WHERE editor_email=?1 AND released=0)
          AND (SELECT COUNT(*) FROM typeset_previews WHERE editor_email=?1 AND admitted_at>?3-3600000)<20 RETURNING id`).bind(email,key,now),
        db.prepare("SELECT COUNT(*) AS active FROM typeset_previews WHERE editor_email=?1 AND released=0").bind(email),
      ]);
      const id=result[1]?.results?.[0]?.id;
      return id ? {ok:true,leaseId:id} : {ok:false,reason:result[2]?.results?.[0]?.active ? "active" : "rate"};
    },
    async releasePreview(key:string):Promise<number> {
      const result=await db.prepare("UPDATE typeset_previews SET released=1 WHERE preview_key=?1 AND released=0").bind(key).run();
      return result.meta?.changes ?? 0;
    },
  };
}
