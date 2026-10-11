// Spike S4: run each route's browser bundle inside a module Worker in
// Playwright Chromium (no DOM in workers) and check it yields a PDF.
//   node scripts/spike-pdf/browser-check.ts <bundleDir> <svg>
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";
import { pagePt } from "./common.ts";

const [bundleDir, svgPath] = process.argv.slice(2);
if (bundleDir === undefined || svgPath === undefined) throw new Error("usage: browser-check.ts <bundleDir> <svg>");
const fontDir = new URL("../../../build/s34-fonts/", import.meta.url);
const fontB64 = (f: string): string => readFileSync(new URL(f, fontDir)).toString("base64");
const faces = { regular: fontB64("LiberationSerif-Regular.ttf"), italic: fontB64("LiberationSerif-Italic.ttf"), bold: fontB64("LiberationSerif-Bold.ttf"), boldItalic: fontB64("LiberationSerif-BoldItalic.ttf") };
const svg = readFileSync(svgPath, "utf8");
const page = pagePt({ widthMm: 157.8, heightMm: 227.1 });

const browser = await chromium.launch();
const tab = await browser.newPage();
// Serve the bundles from a fake same-origin host so module workers can import them.
await tab.route("http://spike.test/**", async (route) => {
  const path = new URL(route.request().url()).pathname.slice(1);
  if (path === "index.html") return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>spike</title>" });
  if (path.startsWith("w-")) {
    const file = ({ "w-lib.js": "route-pdflib.js", "w-fk2.js": "route-pdflib-fontkit2.js", "w-esm.js": "route-pdfkit-esm.js", "w-std.js": "route-pdfkit-standalone.js" } as Record<string, string>)[path] ?? "missing.js";
    const call = "(await m.build(d.svg, d.page, f)).bytes";
    const body = `import * as m from "./${file}";
self.onmessage = async (e) => { try { const d = e.data;
  const b = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const f = { regular: b(d.faces.regular), italic: b(d.faces.italic), bold: b(d.faces.bold), boldItalic: b(d.faces.boldItalic) };
  const t0 = performance.now(); const bytes = ${call}; const ms = Math.round(performance.now() - t0);
  self.postMessage({ ok: true, size: bytes.length, head: String.fromCharCode(...bytes.slice(0, 5)), ms });
} catch (err) { self.postMessage({ ok: false, error: String((err && err.stack) || err) }); } };`;
    return route.fulfill({ contentType: "text/javascript", body });
  }
  return route.fulfill({ contentType: "text/javascript", body: readFileSync(`${bundleDir}/${path}`, "utf8") });
});
await tab.goto("http://spike.test/index.html");
for (const [name, worker] of [["pdf-lib", "w-lib.js"], ["pdf-lib+fontkit2", "w-fk2.js"], ["pdfkit-esm", "w-esm.js"], ["pdfkit-standalone", "w-std.js"]] as const) {
  const result = await tab.evaluate(async ({ worker, svg, page, faces }) => {
    const w = new Worker(`/${worker}`, { type: "module" });
    return await new Promise((resolve) => {
      w.onmessage = (e) => resolve(e.data);
      w.onerror = (e) => resolve({ ok: false, error: `worker error: ${e.message ?? "load failed"}` });
      w.postMessage({ svg, page, faces });
    });
  }, { worker, svg, page, faces });
  console.log(name, JSON.stringify(result));
}
await browser.close();
