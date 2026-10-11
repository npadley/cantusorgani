// Captures the editor mockup screenshots and runs its checks.
//
//   cd web && pnpm install --frozen-lockfile && pnpm exec playwright install chromium
//   node docs/superpowers/mockups/export-layout/capture.mjs
//
// Uses @playwright/test from web/node_modules. Prints PASS or FAIL per check and
// exits 1 when any check fails.
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, statSync } from "node:fs";

const require = createRequire(new URL("../../../../web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");

const here = fileURLToPath(new URL(".", import.meta.url));
const editor = pathToFileURL(fileURLToPath(new URL("./editor.html", import.meta.url))).href;
const outDir = fileURLToPath(new URL("./screens/", import.meta.url));
mkdirSync(outDir, { recursive: true });

const VP = { desktop: { width: 1280, height: 800 }, tablet: { width: 768, height: 1024 }, phone: { width: 390, height: 844 } };
const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
};

const browser = await chromium.launch();
const errors = [];

async function open(vp, scenario, extra = "") {
  const ctx = await browser.newContext({ viewport: VP[vp], reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`s${scenario}@${vp}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`s${scenario}@${vp}: ${m.text()}`); });
  page.on("request", (r) => { if (!r.url().startsWith("file:") && !r.url().startsWith("data:")) errors.push(`external request ${r.url()}`); });
  await page.goto(`${editor}?s=${scenario}${extra}`);
  await page.waitForTimeout(500);
  return { page, ctx };
}

// --- Screenshots -----------------------------------------------------------
const shots = [
  [1, "desktop", "s01-kyrie-ready"], [1, "tablet", "s01-kyrie-ready"], [1, "phone", "s01-kyrie-ready"],
  [2, "desktop", "s02-ipad-11"], [2, "tablet", "s02-ipad-11"], [2, "phone", "s02-ipad-11"],
  [4, "desktop", "s04-mixed-parts"], [4, "tablet", "s04-mixed-parts"], [4, "phone", "s04-mixed-parts"],
  [6, "desktop", "s06-break-editing"], [6, "tablet", "s06-break-editing"], [6, "phone", "s06-break-editing"],
  [7, "desktop", "s07-impossible-layout"], [7, "phone", "s07-impossible-layout"],
  [13, "phone", "s13-narrow-fit-strip"],
];
for (const [n, vp, name] of shots) {
  const { page, ctx } = await open(vp, n);
  await page.screenshot({ path: `${outDir}${name}-${VP[vp].width}.png` });
  if (n === 4 && vp === "desktop") {
    await page.evaluate(() => document.querySelector('[data-page="3"]').scrollIntoView());
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${outDir}${name}-scan-page-${VP[vp].width}.png` });
  }
  if (n === 6 && vp === "desktop") {
    // The same scenario with the page scrolled to the open menu.
    await page.evaluate(() => document.querySelector("#cx-menu").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${outDir}${name}-menu-${VP[vp].width}.png` });
  }
  await ctx.close();
}
{
  const { page, ctx } = await open("desktop", 1);
  await page.click("#z-minus"); await page.click("#z-minus");
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${outDir}s01-kyrie-ready-zoom50-1280.png` });
  await ctx.close();
}
for (const [n, vp, name] of [[2, "tablet", "s02-ipad-11-panel"], [2, "phone", "s02-ipad-11-panel"], [4, "phone", "s04-mixed-parts-panel"], [1, "tablet", "s01-kyrie-ready-panel"]]) {
  const { page, ctx } = await open(vp, n, "&panel=1");
  await page.screenshot({ path: `${outDir}${name}-${VP[vp].width}.png` });
  await ctx.close();
}
check("screenshots written", true, `${shots.length + 8} images in screens/`);
{
  const { readdirSync } = await import("node:fs");
  const big = readdirSync(outDir).filter((f) => statSync(outDir + f).size > 400 * 1024);
  check("each screenshot is under 400 KB", big.length === 0, big.join(", "));
}

// --- Scenarios render --------------------------------------------------------
for (let n = 1; n <= 14; n++) {
  const { page, ctx } = await open("desktop", n);
  const info = await page.evaluate(() => ({
    open: document.getElementById("cx").open,
    pages: document.querySelectorAll(".cx-pg").length,
    notices: document.querySelectorAll("#cx-pages .notice").length,
    live: document.querySelectorAll('#cx [aria-live="polite"], #cx [role="status"]').length,
  }));
  check(`scenario ${n} renders`, info.open && (info.pages > 0 || info.notices > 0), `pages=${info.pages} notices=${info.notices}`);
  check(`scenario ${n} has exactly one polite live region in the editor`, info.live === 1, `found ${info.live}`);
  await ctx.close();
}

// --- Targets >= 44 px ---------------------------------------------------------
const measure = () => {
  const sel = 'button, select, summary, input:not([type=radio]):not([type=checkbox]), a[href], label.seg-o > span';
  const bad = [];
  for (const el of document.querySelectorAll("#cx " + sel.split(", ").join(", #cx "))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (getComputedStyle(el).visibility === "hidden") continue;
    if (r.width < 43.5 || r.height < 43.5) bad.push(`${el.id || el.className || el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return bad;
};
for (const vp of ["desktop", "tablet", "phone"]) {
  const bad = [];
  for (let n = 1; n <= 14; n++) {
    const { page, ctx } = await open(vp, n);
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => { d.open = true; }));
    await page.waitForTimeout(100);
    (await page.evaluate(measure)).forEach((b) => bad.push(`s${n} ${b}`));
    await ctx.close();
  }
  check(`every visible interactive element is at least 44x44 CSS px at ${VP[vp].width}px (all 14 scenarios)`, bad.length === 0, [...new Set(bad)].slice(0, 8).join("; "));
}

for (const vp of ["tablet", "phone"]) {
  const bad = [];
  for (let n = 1; n <= 14; n++) {
    const { page, ctx } = await open(vp, n, "&panel=1");
    const inPanel = await page.evaluate(() => document.getElementById("cx").dataset.panel === "open" && document.getElementById("cx-settings").getBoundingClientRect().height > 0);
    if (!inPanel) bad.push(`s${n} panel not open`);
    await page.evaluate(() => { document.getElementById("g-more").open = true; });
    (await page.evaluate(measure)).forEach((b) => bad.push(`s${n} ${b}`));
    await ctx.close();
  }
  check(`Settings panel: every control is at least 44x44 CSS px at ${VP[vp].width}px (all 14 scenarios, panel open)`, bad.length === 0, [...new Set(bad)].slice(0, 8).join("; "));
}

// --- Preview first below 62rem ----------------------------------------------------
for (const vp of ["tablet", "phone"]) {
  for (const n of [1, 2]) {
    const { page, ctx } = await open(vp, n);
    const m = await page.evaluate(() => {
      const pg = document.querySelector(".cx-page").getBoundingClientRect();
      const foot = document.getElementById("cx-foot").getBoundingClientRect();
      const strip = document.getElementById("cx-fitstrip").getBoundingClientRect();
      const body = document.querySelector(".cx-body").scrollTop;
      return { top: Math.round(pg.top), footTop: Math.round(foot.top), strip: Math.round(strip.height), vh: innerHeight, scrolled: body };
    });
    const lim = vp === "tablet" ? 120 : 170;
    check(`first page top is visible without scrolling at ${VP[vp].width}x${VP[vp].height}, scenario ${n}`, m.top > 0 && m.top < m.footTop - 40 && m.scrolled === 0, JSON.stringify(m));
    check(`FIT strip is at most ${lim} px tall at ${VP[vp].width}px, scenario ${n}`, m.strip <= lim, `${m.strip}px`);
    await ctx.close();
  }
}

// --- Settings panel behaviour ---------------------------------------------------------
for (const vp of ["tablet", "phone"]) {
  const { page, ctx } = await open(vp, 1);
  const st = () => page.evaluate(() => ({ open: document.getElementById("cx").dataset.panel === "open", dlg: document.getElementById("cx").open, focus: document.activeElement && document.activeElement.id, inPanel: !!document.activeElement.closest("#cx-settings"), expanded: document.getElementById("open-settings").getAttribute("aria-expanded") }));
  await page.click("#open-settings");
  const a = await st();
  check(`Settings button opens the panel and moves focus into it at ${VP[vp].width}px`, a.open && a.inPanel && a.expanded === "true", JSON.stringify(a));
  if (vp === "tablet") {
    const g = await page.evaluate(() => { const p = document.getElementById("cx-settings").getBoundingClientRect(), pg = document.querySelector(".cx-page").getBoundingClientRect(); return { panelLeft: Math.round(p.left), panelW: Math.round(p.width), panelH: Math.round(p.height), pageRight: Math.round(pg.right), pageW: Math.round(pg.width), pageTop: Math.round(pg.top), vh: innerHeight }; });
    check("at 768 the panel is 22rem wide from the right and the preview is visible beside it", g.panelW === 352 && g.pageRight <= g.panelLeft + 1 && g.pageW > 250 && g.pageTop < g.vh, JSON.stringify(g));
    // The preview keeps updating while the panel is open.
    await page.click('label.seg-o:has(input[name="orient"][value="landscape"])');
    await page.waitForTimeout(1000);
    const asp = await page.evaluate(() => { const r = document.querySelector(".cx-page").getBoundingClientRect(); return r.width / r.height; });
    check("preview updates live while the panel is open", asp > 1, asp.toFixed(2));
  } else {
    const g = await page.evaluate(() => { const p = document.getElementById("cx-settings").getBoundingClientRect(); return { w: Math.round(p.width), h: Math.round(p.height), vh: innerHeight }; });
    check("at 390 the panel is a full-width bottom sheet of at most 85% height", g.w === 390 && g.h <= Math.round(0.85 * g.vh) + 1, JSON.stringify(g));
  }
  await page.keyboard.press("Escape");
  const b = await st();
  check(`Esc closes the panel first and the dialog stays open at ${VP[vp].width}px`, !b.open && b.dlg && b.focus === "open-settings", JSON.stringify(b));
  await page.keyboard.press("Escape");
  const c = await st();
  check(`a second Esc closes the dialog at ${VP[vp].width}px`, !c.dlg, JSON.stringify(c));
  await ctx.close();
}
{
  const { page, ctx } = await open("phone", 1);
  await page.click("#open-settings");
  await page.click("#panel-done");
  const r = await page.evaluate(() => ({ open: document.getElementById("cx").dataset.panel === "open", focus: document.activeElement.id }));
  check("Done closes the panel and returns focus to the Settings button", !r.open && r.focus === "open-settings", JSON.stringify(r));
  await page.click("#open-settings");
  await page.click("#break-mode");
  const k = await page.evaluate(() => ({ open: document.getElementById("cx").dataset.panel === "open", handles: document.querySelectorAll(".cx-bp").length, pressed: document.getElementById("break-mode").getAttribute("aria-pressed") }));
  check("turning on break editing closes the panel so the handles are usable", !k.open && k.handles > 0 && k.pressed === "true", JSON.stringify(k));
  await ctx.close();
}

// --- Tab order (UI section 5), scenario 1 --------------------------------------
{
  const { page, ctx } = await open("desktop", 1);
  const expected = ["cx-close", "radio:staff", "cap-minus", "radio:tier", "radio:preset-print", "radio:orient", "m-minus", "margin", "m-plus",
    "radio:lines", "break-mode", "summary:g-more", "radio:view", "z-minus", "z-plus", "z-fit", "cx-reset", "cx-download"];
  const seen = [];
  await page.focus("#cx-title");
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Tab");
    const key = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a) return "none";
      if (a.type === "radio") return "radio:" + a.name;
      if (a.tagName === "SUMMARY") return "summary:" + a.parentElement.id;
      return a.id || a.tagName;
    });
    if (key === "proto-sel") break;
    seen.push(key);
  }
  check("tab order follows UI section 5 (scenario 1)", JSON.stringify(seen) === JSON.stringify(expected), JSON.stringify(seen) === JSON.stringify(expected) ? "" : `got ${seen.join(" > ")}`);
  const first = await (async () => { const c = await browser.newContext({ viewport: VP.desktop }); const p = await c.newPage(); await p.goto(`${editor}?s=1`); await p.waitForTimeout(300); const id = await p.evaluate(() => document.activeElement && document.activeElement.id); await c.close(); return id; })();
  check("focus lands on the dialog title on open", first === "cx-title", first);
  await ctx.close();
}

{
  const { page, ctx } = await open("tablet", 1);
  const expected = ["cx-close", "radio:staff", "cap-minus", "open-settings", "radio:view", "z-minus", "z-plus", "z-fit", "cx-reset", "cx-download"];
  const seen = [];
  await page.focus("#cx-title");
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const key = await page.evaluate(() => { const a = document.activeElement; return a.type === "radio" ? "radio:" + a.name : a.id || a.tagName; });
    if (key === "proto-sel") break;
    seen.push(key);
  }
  check("tab order below 62rem: Close, FIT strip, Settings, toolbar, footer (scenario 1 at 768)", JSON.stringify(seen) === JSON.stringify(expected), JSON.stringify(seen) === JSON.stringify(expected) ? "" : `got ${seen.join(" > ")}`);
  await ctx.close();
}

// --- No horizontal scroll at 390 ------------------------------------------------
{
  const bad = [];
  for (let n = 1; n <= 14; n++) {
    const { page, ctx } = await open("phone", n);
    const r = await page.evaluate(() => {
      const d = document.getElementById("cx"), b = document.querySelector(".cx-body");
      return { doc: document.documentElement.scrollWidth - innerWidth, dlg: d.scrollWidth - d.clientWidth, body: b.scrollWidth - b.clientWidth };
    });
    if (r.doc > 0 || r.dlg > 0 || r.body > 0) bad.push(`s${n} ${JSON.stringify(r)}`);
    await ctx.close();
  }
  check("no horizontal scroll at 390 px (all 14 scenarios)", bad.length === 0, bad.join("; "));
}

// --- Controls visibly work ------------------------------------------------------
{
  const { page, ctx } = await open("desktop", 1);
  const aspect = () => page.evaluate(() => { const r = document.querySelector(".cx-page").getBoundingClientRect(); return r.width / r.height; });
  const a0 = await aspect();
  await page.click('label.seg-o:has(input[name="staff"][value="large"])');
  check("segmented control selects", await page.isChecked('input[name="staff"][value="large"]'));
  await page.click('label.seg-o:has(input[name="tier"][value="ipad"])');
  check("page tier swaps: iPad shows iPad sizes and hides Print sizes", await page.isVisible("#seg-ipad") && !(await page.isVisible("#seg-print")));
  await page.click('label.seg-o:has(input[name="preset-ipad"][value="ipad-mini"])');
  await page.waitForTimeout(1000);
  const a1 = await aspect();
  check("page aspect ratio follows the preset (Letter 0.773 to iPad mini 0.656)", Math.abs(a0 - 215.9 / 279.4) < 0.01 && Math.abs(a1 - 115.9 / 176.6) < 0.01, `${a0.toFixed(3)} -> ${a1.toFixed(3)}`);
  await page.click('label.seg-o:has(input[name="tier"][value="custom"])');
  check("Custom tier shows width and height inputs", await page.isVisible("#cw") && await page.isVisible("#ch"));
  await page.fill("#cw", "500"); await page.press("#cw", "Enter");
  check("custom size out of range shows inline copy", (await page.textContent("#e-custom")).startsWith("Use a width between 90 and 450 mm"));
  await ctx.close();
}
{
  const { page, ctx } = await open("desktop", 1);
  const v0 = await page.textContent("#cap-val");
  await page.click("#cap-minus");
  await page.waitForTimeout(1200);
  const v1 = await page.textContent("#cap-val");
  check('stepper changes "As many as fit (now 4)" to a number', v0 === "As many as fit (now 4)" && v1 === "3", `${v0} -> ${v1}`);
  await ctx.close();
}
{
  const { page, ctx } = await open("desktop", 6);
  const m = await page.evaluate(() => ({ menu: !!document.getElementById("cx-menu"), pressed: document.getElementById("break-mode").getAttribute("aria-pressed"), tab0: document.querySelectorAll('.cx-bp[tabindex="0"]').length, pages: document.querySelectorAll(".cx-overlay").length }));
  check("break editing: menu open, mode pressed, one roving tab stop per page", m.menu && m.pressed === "true" && m.tab0 === m.pages, JSON.stringify(m));
  await ctx.close();
}
{
  const { page, ctx } = await open("desktop", 1);
  const txt = await page.evaluate(() => document.getElementById("cx").innerText);
  check("no Lettering or Music symbols controls (D3)", !/lettering|music symbols/i.test(txt));
  await ctx.close();
}
check("no page errors, console errors or external requests", errors.length === 0, errors.slice(0, 3).join("; "));

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed === 0 ? `\nALL ${results.length} CHECKS PASS` : `\n${failed} of ${results.length} CHECKS FAIL`);
process.exit(failed === 0 ? 0 : 1);
