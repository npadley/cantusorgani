# Chant fixtures: source

Made by `web/scripts/render-chant-fixtures.ts` (chant SVG and line bounds) and
`web/scripts/find-chant-fixture-pages.ts` (`pages.json`). Both are deterministic: no timestamps,
and a second run gives byte-identical files.

## Renderer

- Exsurge: `bbloomf/exsurge` at commit `16c626f986532edbb4cf33e88a56dd30bf592d6d`, vendored as
  `web/public/vendor/exsurge/exsurge.min.js` (sha256 `ebc53ca8cc84ef364f92a1099843ab1679affa9148e03cb3e0bc6d70b4f1e5da`).
- Fonts: Liberation Serif Regular, Italic and Bold from `web/public/fonts/export/`, embedded as
  `@font-face` data URIs in the page.
- Chromium: Playwright's headless shell. Set `CHROME_EXECUTABLE` to use another build.
- GABC: `data/chants.json`, through `cleanGabc` from `web/src/lib/gabc.ts`.
- Settings: `ChantContext` with glyph scaling 1/16, `setFont("'Liberation Serif'", 19.2 / 0.9)`,
  `setRubricColor('#d00')`, black lines and text, white negative fill, drop cap on.
- Annotation: the part abbreviation from `PART_ABBREVIATIONS` in `web/src/lib/chants.ts`
  (al: `Allel.`, gr: `Grad.`, tr: `Tract.`), with the chant's own mode from `data/chants.json`
  (al 1, gr 3, tr 2). The spike used `%Grad.%` and `%5%` for every chant; this uses each chant's
  own annotation and mode, as `annotationFor` does on the site.
- Output: `{svg, lines}`, where `lines[i]` is `score.lines[i].bounds` `{y, height}` rounded to
  two decimals. The JSON is pretty-printed with a trailing newline.

## Fixtures

| File | Chant | Part | Mode | Width (units) | Use |
|---|---|---|---|---|---|
| `al-1-749.json` | #1 *Laudem Domini* (Alleluia) | al | 1 | 749 | iPad mini |
| `gr-277-1333.json` | #277 *Exaltabo te* (Gradual) | gr | 3 | 1333 | Letter, Medium |
| `tr-889-749.json` | #889 *Qui habitat* (Tract) | tr | 2 | 749 | iPad mini, longest chant |

Command (from `web/`):

```
node scripts/render-chant-fixtures.ts
```

## pages.json

Built with `pnpm build` (`web/dist`), then:

```
node scripts/find-chant-fixture-pages.ts
```

The query reads every `web/dist/**/index.html` and collects the `data-chant-id` values of
`.chant-notation` boxes (1136 pages carry one). Chant lengths come from `data/chants.json`.

- `kyrie`: the first `kyriale/*` page that links chant #2976 (Kyrie IX). It is `kyriale/ix/index.html`.
- `longest`: the page whose linked chant has the most GABC characters. That is #889 (4156 characters),
  first found on `ordinary-form/lent-1/index.html`.
