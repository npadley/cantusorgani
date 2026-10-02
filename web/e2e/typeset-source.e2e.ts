import { expect, test } from "@playwright/test";
const file = "vol-5/x.ly", baseBlobSha = "a".repeat(40);
test("edits, saves, reloads and approves source without publishing private report notes", async ({ page }) => {
  let draft: null | Record<string, unknown> = null;
  await page.route("**/admin/api/typeset/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: { file, current: { text: "c4", blobSha: baseBlobSha }, draft } });
    const body = request.postDataJSON();
    if (request.url().endsWith("/draft")) { draft = { ...body, revision: 1, contentHash: "b".repeat(64) }; return route.fulfill({ json: { draft } }); }
    expect(body).toMatchObject({ file, expectedRevision: 1, reportId: 7, note: "Checked printed scan" });
    return route.fulfill({ status: 201, json: { id: 9, status: "approved" } });
  });
  await page.goto(`/admin/typeset/edit/?file=${file}&report=7`);
  await page.locator(".cm-content").fill("d4");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Draft saved");
  await page.reload(); await expect(page.locator(".cm-content")).toContainText("d4");
  await page.getByLabel("Public reason").fill("Checked printed scan");
  await page.getByRole("button", { name: "Approve this edit" }).click();
  await expect(page.locator("#status")).toContainText("waiting to publish");
});
test("shows both versions on a stale-base conflict and retains the editor's text", async ({ page }) => {
  await page.route("**/admin/api/typeset/source?**", (route) => route.fulfill({ json: { file, current: { text: "c4", blobSha: baseBlobSha }, draft: null } }));
  await page.route("**/admin/api/typeset/draft", (route) => route.fulfill({ status: 409,
    json: { error: "The repository source changed.", current: { text: "e4", blobSha: "c".repeat(40) }, draft: null } }));
  await page.goto(`/admin/typeset/edit/?file=${file}`);
  await page.locator(".cm-content").fill("d4"); await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator("#conflict")).toBeVisible();
  await expect(page.locator("#latest-source")).toHaveValue("e4");
  await expect(page.locator(".cm-content")).toContainText("d4");
});
test("previews unsaved text and shows bounded rendering diagnostics",async({page})=>{
  await page.clock.install();
  await page.route('**/admin/api/typeset/source?**',r=>r.fulfill({json:{current:{text:'c4',blobSha:baseBlobSha},draft:null}}));
  await page.route('**/admin/api/typeset/preview',r=>r.fulfill({json:{draft:{file,text:r.request().postDataJSON().text,revision:1,baseBlobSha,contentHash:'a'.repeat(64)},key:'b'.repeat(64),resultUrl:'https://assets.example.test/typeset-preview/result.json'}}));
  await page.route('https://assets.example.test/**',r=>r.fulfill({json:{key:'b'.repeat(64),ok:false,problems:['line 2: invalid note'],warnings:[]}}));
  await page.goto(`/admin/typeset/edit/?file=${file}`);await page.locator('.cm-content').fill('d4');
  await page.getByRole('button',{name:'Preview draft',exact:true}).click({timeout:2000});
  await expect(page.locator("#preview")).toContainText("Drawing the preview");
  await page.clock.fastForward(5000);
  await expect(page.locator('#preview')).toContainText('line 2: invalid note');
  await expect(page.locator('.cm-content')).toContainText('d4');
});
for (const outcome of ['success','timeout','superseded'] as const) test(`preview ${outcome} preserves drafts on a phone`,async({page})=>{
  await page.setViewportSize({width:320,height:844});await page.clock.install();
  await page.route('**/admin/api/typeset/source?**',r=>r.fulfill({json:{current:{text:'c4',blobSha:baseBlobSha},draft:null}}));
  await page.route('**/admin/api/typeset/preview',r=>r.fulfill({json:{draft:{file,text:'d4',revision:1,baseBlobSha},key:'b'.repeat(64),resultUrl:'https://assets.example.test/result.json'}}));
  await page.route('https://assets.example.test/**',r=>outcome==='timeout' ? r.fulfill({status:404,body:'pending'}) : r.fulfill({json:{key:'b'.repeat(64),ok:true,problems:[],warnings:[]}}));
  await page.goto(`/admin/typeset/edit/?file=${file}`);await page.locator('.cm-content').fill('d4');
  await page.getByRole('button',{name:'Preview draft',exact:true}).click();
  await expect(page.locator('#preview')).toContainText('Drawing the preview');
  if(outcome==='superseded')await page.locator('.cm-content').fill('e4');
  await page.clock.fastForward(outcome==='timeout' ? 245000 : 5000);
  if(outcome==='success')await expect(page.locator('#preview img')).toHaveAttribute('src','https://assets.example.test/wide.svg');
  else if(outcome==='timeout')await expect(page.locator('#preview')).toContainText('timed out');
  else {await expect(page.getByRole('button',{name:'Save draft',exact:true})).toBeEnabled();await expect(page.locator('#preview img')).toHaveCount(0);}
  await expect(page.locator('.cm-content')).toContainText(outcome==='superseded' ? 'e4' : 'd4');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
test('shows immutable approved text and links an additional report',async({page})=>{
  await page.route('**/admin/api/typeset/source?**',r=>r.fulfill({json:{current:{text:'c4',blobSha:baseBlobSha},draft:null,approved:{correctionId:9,text:'d4',baseBlobSha,status:'approved'}}}));
  await page.route('**/admin/api/rows/7/resolve',r=>{expect(r.request().postDataJSON()).toEqual({correctionId:9});return r.fulfill({json:{ok:true}});});
  await page.goto(`/admin/typeset/edit/?file=${file}&report=7`);
  await expect(page.getByLabel('Approved source snapshot')).toHaveValue('d4');
  await page.getByRole('button',{name:'Link this report to the approved edit'}).click();
  await expect(page.locator('#status')).toContainText('It resolves when the edit publishes');
});
test('reader report to preview, approval, publication and resolved public status',async({page})=>{
  await page.route('**/challenges.cloudflare.com/**',r=>r.abort());
  let draft:Record<string,unknown>|null=null, approved=false, merged=false;
  const hash='a'.repeat(32),key='b'.repeat(64),privateNote='PRIVATE-READER-CONTEXT';
  await page.route('https://api.cantusorgani.org/**',r=>r.fulfill({status:r.request().method()==='POST'?201:200,json:r.request().method()==='POST'?{ok:true}:{corrections:merged?[{id:7,pieceId:'typeset',target:`typeset:${file}`,field:'issue',proposedValue:'lyrics',renderHash:hash,status:'resolved',resolvedBy:9,commitSha:'abc1234',createdAt:'2026-10-02',note:privateNote}]:[]}}));
  await page.route('**/admin/api/typeset/**',r=>{
    if(r.request().method()==='GET')return r.fulfill({json:{current:{text:'c4',blobSha:baseBlobSha},draft}});
    const body=r.request().postDataJSON();
    if(r.request().url().endsWith('/preview')){draft={file,text:body.text,baseBlobSha,revision:1};return r.fulfill({json:{draft,key,resultUrl:'https://assets.example.test/result.json'}});}
    expect(body).toMatchObject({reportId:7,expectedRevision:1,note:'Checked scan'});expect(JSON.stringify(body)).not.toContain(privateNote);approved=true;return r.fulfill({status:201,json:{id:9,status:'approved'}});
  });
  await page.route('https://assets.example.test/**',r=>r.request().url().endsWith('.svg')?r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg"/>'}):r.fulfill({json:{key,ok:true,problems:[],warnings:[]}}));
  await page.route('**/admin/api/me',r=>r.fulfill({json:{email:'editor@example.org',owner:true,publishing:true}}));
  await page.route('**/admin/api/queue',r=>r.fulfill({json:{pending:[],approved:approved?[{id:9,piece_id:'typeset',target:`typeset:${file}`,field:'source',proposed:key,note:'Checked scan',status:'approved',source:'editor',editor_email:'editor@example.org',reason:null,resolved_by:null,resolvedTarget:`typeset:${file}`,resolvedField:'source',kind:'typeset',label:file,fields:[],values:{},current:null,problem:null}]:[],batches:[],lastReviewed:null}}));
  // Simulate dispatch/merge only at the external boundary; migrated-D1 API tests check the signed webhook itself.
  await page.route('**/admin/api/publish',r=>{approved=false;merged=true;return r.fulfill({json:{ok:true,batch:'b-123456',count:1}});});
  await page.goto(`/corrections/?target=typeset:${file}&seen=${hash}`);
  await page.locator('#proposedValue').selectOption('lyrics');await page.locator('#note').fill(privateNote);
  await page.locator('#correction-form').evaluate(form=>{const input=document.createElement('input');input.name='cf-turnstile-response';input.value='test-token';input.type='hidden';form.append(input);});
  await page.locator('#submit').click();await expect(page.locator('#form-status')).toContainText('in the queue');
  await page.goto(`/admin/typeset/edit/?file=${file}&report=7`);await page.locator('.cm-content').fill('d4');
  await page.clock.install();await page.getByRole('button',{name:'Preview draft',exact:true}).click();
  await expect(page.locator('#preview')).toContainText('Drawing the preview');await page.clock.fastForward(5000);
  await expect(page.locator('#preview')).toContainText('Preview ready');await expect(page.locator('body')).not.toContainText(privateNote);
  await page.getByLabel('Public reason').fill('Checked scan');await page.getByRole('button',{name:'Approve this edit'}).click();
  await expect(page.locator('#status')).toContainText('waiting to publish');
  await page.goto('/admin/');await page.locator('#publish').click();await expect(page.locator('#status')).toContainText('Sent 1 correction');
  await page.goto('/corrections/');await expect(page.locator('#queue-list')).toContainText('resolved · fix #9');await expect(page.locator('#queue-list')).not.toContainText(privateNote);
});
