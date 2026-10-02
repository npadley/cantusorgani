import type { D1Like } from "./store";
import type { GithubEnv } from "./github";
import { githubClient } from "./github";
import { sourceContentHash } from "./typesetStore";
export interface PreviewPayload { file:string; text:string; commitSha:string; key:string; leaseId:number }
/** The captured main commit covers includes, renderer code/settings and the LilyPond pin. */
export async function previewKey(file:string,text:string,commitSha:string):Promise<string> {
  return sourceContentHash(["typeset-preview-v1",file,text,commitSha].map(s=>`${new TextEncoder().encode(s).length}:${s}`).join(""));
}
export async function dispatchPreview(env:GithubEnv,payload:PreviewPayload,fetcher:(input:string,init?:RequestInit)=>Promise<Response>=fetch):Promise<void> {
  const api=await githubClient(env,fetcher);
  let wire:Omit<PreviewPayload,"text"> & {text?:string;sourceBlobSha?:string}=payload;
  // JSON escaping can exceed repository_dispatch's limit even for valid UTF-8 source.
  if(new TextEncoder().encode(JSON.stringify(payload)).length>60000) {
    const bytes=new TextEncoder().encode(payload.text);
    const blob=await api("git/blobs",{method:"POST",body:JSON.stringify({content:btoa(String.fromCharCode(...bytes)),encoding:"base64"})}) as {sha?:string};
    if(!/^[a-f0-9]{40}$/.test(blob.sha ?? ""))throw Error("Invalid preview source blob");
    const {text:_text,...identity}=payload;
    wire={...identity,sourceBlobSha:blob.sha!};
  }
  if(new TextEncoder().encode(JSON.stringify(wire)).length>60000)throw Error("Preview descriptor exceeds dispatch limit");
  await api("dispatches",{method:"POST",body:JSON.stringify({event_type:"typeset-preview",client_payload:wire})});
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
    async releaseLease(id:number):Promise<number> {
      const result=await db.prepare("UPDATE typeset_previews SET released=1 WHERE id=?1 AND released=0").bind(id).run();
      return result.meta?.changes ?? 0;
    },
    async releasePreview(key:string,leaseId:number):Promise<number> {
      const result=await db.prepare("UPDATE typeset_previews SET released=1 WHERE preview_key=?1 AND id=?2 AND released=0").bind(key,leaseId).run();
      return result.meta?.changes ?? 0;
    },
  };
}
