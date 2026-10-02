import { githubClient } from "./github";
import type { GithubEnv } from "./github";
import { checkSource, validSourceSize } from "./sourceCheck";
import { sourceContentHash } from "./typesetStore";
import type { SourceSnapshot } from "./typesetStore";
import { isTypesetFile } from "../../../../workers/corrections/src/schema";
export class SourceConflict extends Error {
  constructor(readonly conflicts:readonly {file:string;current:{text:string;blobSha:string};approved:SourceSnapshot}[]) {super("Source changed on main. Withdraw the approved edit and reconcile both versions before approving again.");}
}
const sha=(value:unknown):string=>{if(typeof value!=="string" || !/^[a-f0-9]{40}$/.test(value))throw Error("Invalid Git revision");return value;};
export async function prepareSourceBatch(env:GithubEnv,batch:string,snapshots:readonly SourceSnapshot[],fetcher:(input:string,init?:RequestInit)=>Promise<Response>=fetch):Promise<{branch:string;commitSha:string}> {
  if(!/^b-[0-9a-z-]{6,40}$/.test(batch) || !snapshots.length || snapshots.length>100)throw Error("Invalid source batch");
  if(new Set(snapshots.map(s=>s.file)).size!==snapshots.length)throw Error("Duplicate source files in batch");
  for(const s of snapshots)if(!isTypesetFile(s.file) || !validSourceSize(s.text) || checkSource(s.text).length || await sourceContentHash(s.text)!==s.contentHash)throw Error("Invalid approved source snapshot");
  const api=await githubClient(env,fetcher),branch=`corrections/${batch}`;
  const ref=await api('git/ref/heads/main') as {object:{sha:string}}, main=sha(ref.object?.sha);
  const commit=await api(`git/commits/${main}`) as {tree:{sha:string}},tree=sha(commit.tree?.sha);
  const contents=async(file:string,at:string)=>{
    const body=await api(`contents/data/typeset/src/${file.split('/').map(encodeURIComponent).join('/')}?ref=${at}`) as {type:string;encoding:string;sha:string;content:string;size:number};
    if(body.type!=='file' || body.encoding!=='base64' || body.size>61440 || typeof body.content!=='string')throw Error('Invalid repository source');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(body.content.replace(/\s/g,'')),c=>c.charCodeAt(0)));
    if(!validSourceSize(text))throw Error('Oversized repository source');
    return {text,blobSha:sha(body.sha)};
  };
  const conflicts=[];
  for(const s of snapshots){const current=await contents(s.file,main);if(current.blobSha!==s.baseBlobSha)conflicts.push({file:s.file,current,approved:s});}
  if(conflicts.length)throw new SourceConflict(conflicts);
  let existing:string|null=null;
  try {const r=await api(`git/ref/heads/${branch}`) as {object:{sha:string}};existing=sha(r.object?.sha);}
  catch(error){if(!(error instanceof Error) || !error.message.includes('HTTP 404'))throw error;}
  if(existing){
    for(const s of snapshots)if(await sourceContentHash((await contents(s.file,existing)).text)!==s.contentHash)throw Error(`Existing ${branch} differs from the approved snapshots; owner review required`);
    return {branch,commitSha:existing};
  }
  const changes=[];
  for(const s of snapshots){
    const bytes=new TextEncoder().encode(s.text), content=btoa(String.fromCharCode(...bytes));
    const blob=await api('git/blobs',{method:'POST',body:JSON.stringify({content,encoding:'base64'})}) as {sha:string};
    changes.push({path:`data/typeset/src/${s.file}`,mode:'100644',type:'blob',sha:sha(blob.sha)});
  }
  const built=await api('git/trees',{method:'POST',body:JSON.stringify({base_tree:tree,tree:changes})}) as {sha:string};
  const saved=await api('git/commits',{method:'POST',body:JSON.stringify({message:`data: source snapshots ${batch}`,tree:sha(built.sha),parents:[main]})}) as {sha:string};
  const commitSha=sha(saved.sha);
  await api('git/refs',{method:'POST',body:JSON.stringify({ref:`refs/heads/${branch}`,sha:commitSha})});
  return {branch,commitSha};
}
