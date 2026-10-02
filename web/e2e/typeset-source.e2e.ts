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
