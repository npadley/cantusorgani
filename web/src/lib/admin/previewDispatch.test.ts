import { beforeAll, expect, it } from 'vitest';
import { dispatchPreview } from './typesetPreview';
import { keyPair } from './testing';
import type { GithubEnv } from './github';
let env:GithubEnv;beforeAll(async()=>{env={GITHUB_REPO:'org/repo',GITHUB_APP_ID:'1',GITHUB_INSTALLATION_ID:'2',GITHUB_APP_PRIVATE_KEY:(await keyPair()).pem};});
it('transports the full valid source limit even when JSON escaping exceeds dispatch limits',async()=>{
  const text="\\relative c' { c4 }\n".repeat(3000),calls:{path:string;body:any}[]=[];
  const fetcher=async(url:string,init?:RequestInit)=>{
    const path=url.split('/repos/org/repo/')[1] ?? 'token',body=JSON.parse(String(init?.body ?? '{}'));calls.push({path,body});
    if(path==='token')return Response.json({token:'private'});
    if(path==='git/blobs')return Response.json({sha:'c'.repeat(40)});
    expect(new TextEncoder().encode(JSON.stringify(body.client_payload)).length).toBeLessThan(65535);
    return new Response(null,{status:204});
  };
  await dispatchPreview(env,{file:'vol-5/x.ly',text,commitSha:'a'.repeat(40),key:'b'.repeat(64),leaseId:7},fetcher);
  expect(calls.find(c=>c.path==='git/blobs')?.body).toEqual({content:Buffer.from(text).toString('base64'),encoding:'base64'});
  expect(calls.at(-1)?.body.client_payload).toMatchObject({sourceBlobSha:'c'.repeat(40),leaseId:7});
  expect(calls.at(-1)?.body.client_payload).not.toHaveProperty('text');
});
