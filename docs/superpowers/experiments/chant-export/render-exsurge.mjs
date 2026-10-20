// Spike (2026-10-19): render GABC with the vendored Exsurge in headless Chromium and save its SVG.
// usage: node render-exsurge.mjs <web/node_modules> <repo root> <out dir containing spike/chants.json>
import { createRequire } from 'node:module';
import fs from 'node:fs';
const [,, M, W, S] = process.argv;
const require = createRequire(M + '/');
const { chromium } = require('@playwright/test');
const lib = fs.readFileSync(W + '/web/public/vendor/exsurge/exsurge.min.js', 'utf8');
const chants = JSON.parse(fs.readFileSync(S + '/spike/chants.json', 'utf8'));
const b = await chromium.launch(); const p = await b.newPage();
await p.setContent('<html><body style="font-family: serif"></body></html>');
await p.addScriptTag({ content: lib });
for (const [k, c] of Object.entries(chants)) for (const width of [430, 690]) {
  const t0 = Date.now();
  const svg = await p.evaluate(({ gabc, width }) => new Promise((res) => {
    const lib = window.exsurge;
    const ctxt = new lib.ChantContext(lib.TextMeasuringStrategy.Canvas);
    ctxt.setGlyphScaling(1 / 16);
    ctxt.textColor = ctxt.staffLineColor = ctxt.neumeLineColor = ctxt.dividerLineColor = '#000';
    ctxt.negativeFillColor = '#fff';
    ctxt.setFont("'Liberation Serif', serif", 19.2 / 0.9);
    ctxt.spaceBetweenSystems = 0;
    const g = gabc.replace(/<\/?(?:eu|clear|nlba)>/g, '').trim();
    const score = new lib.ChantScore(ctxt, lib.Gabc.createMappingsFromSource(ctxt, g), true);
    score.annotation = new lib.Annotations(ctxt, '%Grad.%', '%5%');
    score.performLayoutAsync(ctxt, () => score.layoutChantLines(ctxt, width, () => {
      const n = score.createSvgNode(ctxt);
      res({ svg: n.outerHTML, lines: score.lines?.length, h: n.getAttribute('height'), w: n.getAttribute('width'),
            lineY: (score.lines||[]).map(l => [Math.round(l.bounds.y), Math.round(l.bounds.height)]) });
    }));
  }), { gabc: c.gabc, width });
  fs.writeFileSync(`${S}/spike/${k}-${width}.svg`, svg.svg);
  console.log(k, c.incipit, 'width', width, 'lines', svg.lines, 'svg', svg.w, 'x', svg.h, 'bytes', svg.svg.length, 'ms', Date.now()-t0, JSON.stringify(svg.lineY.slice(0,3)));
}
await b.close();
