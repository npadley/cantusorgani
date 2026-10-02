import { beforeAll, expect, it } from "vitest";
import { prepareSourceBatch } from "./typesetPublish";
import { sourceContentHash } from "./typesetStore";
import { keyPair } from "./testing";
import type { GithubEnv } from "./github";
let env:GithubEnv;beforeAll(async()=>{env={GITHUB_REPO:'org/repo',GITHUB_APP_ID:'1',GITHUB_INSTALLATION_ID:'2',GITHUB_APP_PRIVATE_KEY:(await keyPair()).pem};});
const base='a'.repeat(40),main='b'.repeat(40),tree='c'.repeat(40),commit='d'.repeat(40);
const snapshot=async()=>({correctionId:1,file:'vol-5/x.ly',text:'Kýrie 🎵',baseBlobSha:base,contentHash:await sourceContentHash('Kýrie 🎵')});
function stub(stale=false,existing=false){
  const calls:{path:string;method:string;body:any}[]=[];
  const fetcher=async(url:string,init?:RequestInit)=>{
    const path=url.split('/repos/org/repo/')[1] ?? 'token';const method=init?.method ?? 'GET',body=init?.body ? JSON.parse(String(init.body)):null;calls.push({path,method,body});
    if(path==='token')return Response.json({token:'secret'});
    if(path==='git/ref/heads/main')return Response.json({object:{sha:main}});
    if(path.startsWith('git/ref/heads/corrections/'))return existing ? Response.json({object:{sha:commit}}):Response.json({}, {status:404});
    if(path===`git/commits/${main}`)return Response.json({tree:{sha:tree}});
    if(path.startsWith('contents/'))return Response.json({type:'file',encoding:'base64',sha:stale?'e'.repeat(40):base,content:Buffer.from(existing && path.endsWith(commit)?'Kýrie 🎵':'old').toString('base64')});
    return Response.json({sha:commit});
  };return {calls,fetcher};
}
it('checks one captured main and creates exact immutable source branch',async()=>{
  const s=stub();expect(await prepareSourceBatch(env,'b-123456', [await snapshot()],s.fetcher)).toEqual({branch:'corrections/b-123456',commitSha:commit});
  expect(s.calls.filter(c=>c.method==='POST').map(c=>c.path)).toEqual(['token','git/blobs','git/trees','git/commits','git/refs']);
  expect(s.calls.find(c=>c.path==='git/blobs')?.body).toEqual({content:Buffer.from('Kýrie 🎵').toString('base64'),encoding:'base64'});
  expect(s.calls.find(c=>c.path==='git/commits')?.body.parents).toEqual([main]);
});
it('stale bases and duplicate files cause zero repository mutation',async()=>{
  const s=stub(true);await expect(prepareSourceBatch(env,'b-123456',[await snapshot()],s.fetcher)).rejects.toMatchObject({conflicts:[{file:'vol-5/x.ly',current:{text:'old'},approved:{text:'Kýrie 🎵'}}]});
  expect(s.calls.filter(c=>c.method==='POST' && c.path!=='token')).toHaveLength(0);
  const d=stub();await expect(prepareSourceBatch(env,'b-123456',[await snapshot(),await snapshot()],d.fetcher)).rejects.toThrow(/duplicate/i);expect(d.calls).toHaveLength(0);
});
it('validates an existing retry branch without overwriting any ref',async()=>{
  const s=stub(false,true);expect((await prepareSourceBatch(env,'b-123456',[await snapshot()],s.fetcher)).branch).toBe('corrections/b-123456');
  expect(s.calls.filter(c=>c.method==='POST' && c.path!=='token')).toHaveLength(0);
});
it('preserves branch identity on partial failure and refuses a changed retry ref',async()=>{
  const s=stub();let writes=0;
  const fail=async(url:string,init?:RequestInit)=>{if(url.endsWith('/git/refs')){writes++;return Response.json({}, {status:500});}return s.fetcher(url,init);};
  await expect(prepareSourceBatch(env,'b-123456',[await snapshot()],fail)).rejects.toThrow(/500/);expect(writes).toBe(1);
  const changed=stub(false,true);
  const wrong=async(url:string,init?:RequestInit)=>url.includes(`?ref=${commit}`)?Response.json({type:'file',encoding:'base64',sha:base,content:Buffer.from('different').toString('base64')}):changed.fetcher(url,init);
  await expect(prepareSourceBatch(env,'b-123456',[await snapshot()],wrong)).rejects.toThrow(/differs/);
  expect(changed.calls.some(c=>c.method==='PATCH')).toBe(false);
});
