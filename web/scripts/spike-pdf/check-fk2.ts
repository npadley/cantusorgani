// Spike S4: does route (ii) produce the same, extractable PDF with the fontkit 2 adapter?
import { readFileSync, writeFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { HEADING_TEST, pagePt } from "./common.ts";
import { fontkit2Adapter } from "./fontkit2Adapter.ts";
import { buildWithPdfLib } from "./routeLib.ts";
const dir = new URL("../../../build/s34-fonts/", import.meta.url);
const f = (n: string): Uint8Array => new Uint8Array(readFileSync(new URL(n, dir)));
const faces = { regular: f("LiberationSerif-Regular.ttf"), italic: f("LiberationSerif-Italic.ttf"), bold: f("LiberationSerif-Bold.ttf"), boldItalic: f("LiberationSerif-BoldItalic.ttf") };
const svgPath = process.argv[2];
const out = process.argv[3];
if (svgPath === undefined || out === undefined) throw new Error("usage: check-fk2.ts <svg> <out.pdf>");
const { bytes } = await buildWithPdfLib(readFileSync(svgPath, "utf8"), pagePt({ widthMm: 157.8, heightMm: 227.1 }), faces, fontkit2Adapter);
writeFileSync(out, bytes);
const doc = await pdfjs.getDocument({ data: bytes.slice(), disableFontFace: true }).promise;
const tc = await (await doc.getPage(1)).getTextContent();
const text = tc.items.map((i) => ("str" in i ? i.str : "")).join("|");
console.log(JSON.stringify({ bytes: bytes.length, heading: text.includes(HEADING_TEST), lae: text.includes("lǽ"), soen: text.includes("sœn.") }));
