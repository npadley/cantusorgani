# Design tokens and breakpoints

Status: baseline of the current system, measured 2026-10-22. It records what
the CSS does today, not what it should do. Line numbers refer to the tree at
this commit.

Sources:

- `web/src/styles/tokens.css` (75 lines): every token.
- `web/src/styles/base.css` (115 lines): resets, `.page`, buttons, `.notice`, print.
- `web/src/styles/exportEditor.css` (190 lines) and `exportPreview.css` (64 lines):
  loaded on first use of the export editor.
- Scoped `<style>` blocks in `web/src/pages/**/*.astro` and
  `web/src/components/*.astro`.

Plain CSS only. No framework, no Sass. Ratios below were computed with the
WCAG 2.x relative-luminance formula.

## 1. Colour tokens

### How the values are switched

There are three places that set colour tokens.

1. **Light (the default).** `tokens.css:10`, selector
   `:root, :root[data-scan-polarity="normal"]`. It also sets `color-scheme: light`
   and `--score-filter: none`.
2. **Dark by system setting.** `tokens.css:47-60`, inside
   `@media (prefers-color-scheme: dark)`, selector
   `:root:not([data-scan-polarity="normal"])`. So dark applies when the viewer
   has made no choice, or chose "inverted". An explicit "normal" keeps light
   even on a dark system.
3. **Dark by explicit choice.** `tokens.css:63-73`, selector
   `:root[data-scan-polarity="inverted"]`. It repeats the dark values, so
   inverted wins on a light system.

The attribute is set before first paint from `localStorage["scan-polarity"]`
(`Layout.astro:57-58`) and by the polarity button (`Layout.astro:105-107`).

Two gaps:

- Closed 2026-10-22: block 3 now sets `--control-border: #7a7363`, like block 2.
- `--print-paper`, `--print-ink`, `--font-*`, `--step-*` and the spacing tokens
  are never themed.

### Table

Contrast is the token against `--paper` of the same mode, unless the Use column
says otherwise. Light `--paper` is `#fdfcf9`. Dark `--paper` is `#14140f`.
"Text" means 4.5:1 (AA) and 7:1 (AAA). "Non-text" means 3:1 (WCAG 1.4.11).

| Token | Light | Dark (block 2 and 3) | Use (from the file's comments) | Light ratio | Dark ratio | Verdict |
|---|---|---|---|---|---|---|
| `--paper` | `#fdfcf9` | `#14140f` | Page ground. "Warm off-white, 1942 letterpress reference." Scans are pure #000 on #FFF, so the ground behind them is never tinted. | n/a | n/a | n/a |
| `--ink` | `#14120e` | `#ece7da` | Body text. | 18.23 | 14.96 | Text AAA |
| `--ink-muted` | `#524e45` | `#b3ac9c` | Secondary text, disabled text. | 8.08 | 8.18 | Text AAA |
| `--rule` | `#c9c2b4` | `#3c382f` | "Hairlines and table rules; never used for text." In practice also the border of many controls (see section 6). | 1.73 | 1.58 | Fails non-text 3:1. Fine for decoration only. |
| `--control-border` | `#8a8272` | `#7a7363` (blocks 2 and 3) | "Edges of inputs and buttons." Used in the export editor and preview, and for admin controls through `AdminNav.astro:38-40`. | 3.71 | 3.92 | Non-text pass (3:1). Fails AAA/AA text, not meant for text. |
| `--accent` | `#6b2318` | `#e0a08c` | "Rubric red, from the source edition." Links, focus ring, markers, selected state. The only accent. | 10.89 | 8.42 | Text AAA, non-text pass |
| `--warn-bg` | `#fbf3e2` | `#2a2318` | Ground of `.notice`, admin error bar, "current char" highlight. | 1.08 | 1.19 | Background only. No non-text meaning, so no requirement. |
| `--warn-ink` | `#5a4409` | `#e8c87a` | Text on `--warn-bg`, error status text, error borders. | 9.03 on paper; 8.40 on `--warn-bg` | 11.41 on paper; 9.60 on `--warn-bg` | Text AAA both |
| `--print-paper` | `#ffffff` | same | "The physical sheet in export previews: a proof of what prints. Never themed." | vs `--print-ink` 21.0 | same | Text AAA |
| `--print-ink` | `#000000` | same | Text on the sheet. | 21.0 on `--print-paper` | same | Text AAA |
| `--score-filter` | `none` | `invert(1)` | Applied to `.system, .typeset-music` at `tokens.css:75`. Inverts music images and typeset music. | n/a | n/a | n/a, see note |

Other contrast facts:

- `--ink-muted` on `--warn-bg`: 7.50 light, 6.88 dark. Dark is AA, not AAA.
- `--accent` on `--warn-bg`: 10.12 light, 7.08 dark.
- `.primary` button (`base.css:71`) is `--paper` on `--ink`: 18.23 light, 14.96 dark.
- The print override (`base.css:95`) sets `--paper:#fff; --ink:#000; --ink-muted:#333; --rule:#999`.
  `#333` on white is 12.63. `#999` on white is 2.85, still a hairline only.

### Differences from the file's own comments

`tokens.css` states ratios in comments. Only one matches my calculation.

| Token | Comment says | Computed |
|---|---|---|
| `--ink` | 15.8:1 | 18.23:1 |
| `--ink-muted` | 7.4:1 | 8.08:1 |
| `--control-border` | 3.7:1 | 3.71:1 (matches) |
| `--accent` | 8.9:1 | 10.89:1 |
| `--warn-ink` | 7.1:1 | 8.40:1 |

Every comment is lower than the computed value, so each still passes at the
level it claims. I do not know how the comments were measured. Treat my numbers
as the ones to use, and update the comments in any redesign.

### Notes for a redesign

- Inverting the music (`invert(1)`) turns the scan's white ground into pure
  `#000`, while the dark page ground is `#14140f`. The file comment says the
  ground behind scans is never tinted. In dark mode the music sits on a black
  block slightly darker than the page.
- There is no token for hover or placeholder fills. Seven rules build a hover
  tint inline with `color-mix(in srgb, var(--rule) 20%, transparent)` (and 22% for
  loading slots). One highlight uses `color-mix(... var(--accent) 20% ...)`
  (`search.astro:52`).
- No status colours other than the warn pair. Errors and warnings share it.

## 2. Type

### Font stacks

| Token | Value | Line |
|---|---|---|
| `--font-text` | `"Source Serif 4", Georgia, "Times New Roman", serif` | `tokens.css:25` |
| `--font-ui` | `system-ui, -apple-system, "Segoe UI", sans-serif` | `tokens.css:26` |

The comment at `tokens.css:24` says "one serif for text, one UI face. No third
family." There is no mono token (see section 6).

**Closed 2026-10-22: Source Serif 4 is now self-hosted** (latin 400, 400 italic, 600 and latin-ext 400 woff2 in `public/fonts/source-serif-4/`, `font-display: swap`, `@font-face` at the top of `tokens.css`, preload of the regular latin file in `Layout.astro`). The paragraph below is the earlier finding, kept for the record: **Source Serif 4 was never loaded.** I searched `web/src` and `web/public` for
`@font-face`, `font-display`, `fonts.googleapis`, and the name "Source Serif".
The only hit for the name is the token itself (`tokens.css:25`). The only
`@font-face` rules are three for "Liberation Serif" in `exportPreview.css:5-7`,
which load `public/fonts/export/LiberationSerif-{Regular,Italic,Bold}.ttf` for the
export preview only (`exportPreview.css:54,58`). So unless a reader has Source
Serif 4 installed, they get **Georgia** (macOS, iOS, Windows). Where Georgia and
Times New Roman are both missing (many Android and Linux setups) they get the
browser's default serif.

### Fluid scale

Each step is `clamp(min, base + slope*vw, max)`, defined at `tokens.css:28-31`.
Pixel values assume a 16px root and are computed, with the clamp bounds applied.

| Token | `clamp()` | min px | 390 px viewport | 768 px | 1024 px | max px |
|---|---|---|---|---|---|---|
| `--step--1` | `clamp(0.94rem, 0.9rem + 0.2vw, 1rem)` | 15.04 | 15.18 | 15.94 | 16.00 | 16 |
| `--step-0` | `clamp(1.06rem, 1rem + 0.3vw, 1.19rem)` | 16.96 | 17.17 | 18.30 | 19.04 | 19.04 |
| `--step-1` | `clamp(1.33rem, 1.2rem + 0.6vw, 1.6rem)` | 21.28 | 21.54 | 23.81 | 25.34 | 25.6 |
| `--step-2` | `clamp(1.66rem, 1.4rem + 1.2vw, 2.25rem)` | 26.56 | 27.08 | 31.62 | 34.69 | 36 |

At 1024 px, `--step-0` is capped at its max. The comment on `--step-0` says
">=17px on tablet"; it is 17.17 at 390 px and above.

Where the steps are used (`base.css`):

- `body`: `--step-0` (line 12).
- `h1`: `--step-2` (18). `h2`: `--step-1` (19). `h3`: `--step-0` (20).
- `.small` and `.notice`: `--step--1` (42, 87).
- Headings are weight 600, `line-height: 1.2`, `margin: 0 0 var(--s-2)` (17).

There are 77 `font-size` declarations in the CSS and `.astro` files. 75 use a
`--step-*` token. The 2 exceptions are in section 6.

### Line heights

| Value | Where | Line |
|---|---|---|
| 1.55 | `body` | `base.css:13` |
| 1.2 | `h1, h2, h3` | `base.css:17` |
| 1.6 | footer `.page` | `Layout.astro:179` |
| 1.5 | lineup note text | `LineupStack.astro:135` |
| 1.2 | export editor step output | `exportEditor.css:159` |
| 1 | breakpoint marker button | `exportEditor.css:109` |

No `line-height` token exists.

### Measure

`--measure: 62ch` (`tokens.css:42`), used by `.prose` (`base.css:40`) and four
other rules. The same number as the page width, but in `ch`, so it tracks the
font.

### Other type rules in `base.css`

- `text-rendering: optimizeLegibility` (14). `-webkit-text-size-adjust: 100%` (5).
- Links are `--accent` with underline offset 0.15em; hover thickens to 2px (22-23).
- `.ui` switches to `--font-ui` (43). Buttons and `.notice` use `--font-ui` (61, 86).
- Print body is `11pt` (96).

## 3. Spacing, radius, tap target, page width

| Token | Value | px at 16px root | Line | Notes |
|---|---|---|---|---|
| `--s-1` | `0.25rem` | 4 | `tokens.css:33` | |
| `--s-2` | `0.5rem` | 8 | 33 | |
| `--s-3` | `1rem` | 16 | 33 | Page side gutter. Button padding. |
| `--s-4` | `1.5rem` | 24 | 34 | Page top padding. |
| `--s-5` | `2.5rem` | 40 | 34 | Section top margins. `hr` margin. |
| `--s-6` | `4rem` | 64 | 34 | Page bottom padding. Footer margin. |
| `--tap-min` | `44px` | 44 | 36 | "Every interactive target, no exceptions." Used 73 times. Like `--radius`, it uses `px` and does not scale with root font size. |
| `--radius` | `2px` | 2 | 43 | "Print-shop square, not app-store round." |
| `--page-max` | `62rem` | 992 | 44 | Used by `.page` (`base.css:39`). |
| `--measure` | `62ch` | about 620 at 19px Georgia | 42 | |

The scale is irregular: 4, 8, 16, 24, 40, 64. It skips 32 and 48.

`.page` (`base.css:39`): `max-width: var(--page-max); margin: 0 auto;
padding: var(--s-4) var(--s-3) var(--s-6)`. Content width at full size is
992 - 2 x 16 = 960 px. The side gutter is 16 px at every viewport width.

## 4. House rules stated in `tokens.css`

Quoted from the header comment and the nearby ones.

| Rule | Quote | Line |
|---|---|---|
| Tokens only | "Every component consumes these; none may introduce a raw hex, a px font size, or an ad-hoc shadow." | 1-2 |
| Reference | "a printed liturgical edition — rules, generous margins, small caps — not a SaaS landing page." | 4-5 |
| Forbidden | "gradients, glassmorphism, drop shadows on cards, decorative radius above 2px, more than one accent colour." | 5-6 |
| Contrast | "Contrast ratios below were measured against --paper / --warn-bg." | 8 |
| Ground | "The scans are pure #000 on #FFF; never tint the ground behind them." | 14 |
| Rules | `--rule`: "never used for text" | 18 |
| Controls | `--control-border`: "asks 3:1" (WCAG 1.4.11) | 19 |
| Type | "one serif for text, one UI face. No third family." | 24 |
| Tap | "every interactive target, no exceptions" | 36 |
| Print sheet | "Never themed" | 37-38 |
| Radius | "print-shop square, not app-store round" | 43 |

`AGENTS.md` repeats the list: no gradients, no card shadows, radius at most
2px, one accent colour, 44px tap targets, tokens rather than raw colours or
sizes. Mark Latin text `lang="la"`.

## 5. Breakpoints and media queries

All width queries use `rem`, so they move with the user's root font size.
There are no container queries, no `orientation`, `pointer`, `hover`,
`forced-colors` or `prefers-contrast` queries. The viewport meta is
`width=device-width, initial-scale=1` (`Layout.astro:32`).

### Width queries in CSS and `.astro`

| Value | px at 16px root | File:line | What changes |
|---|---|---|---|
| `max-width: 34rem` | 544 | `components/PieceList.astro:53` | Hides the page-count column (`.pages`). |
| `max-width: 39.99rem` | 639.8 | `styles/exportEditor.css:141` | While choosing breaks, hides the FIT strip and toolbar and shows the compact `.cx-breakbar`. The `.cx-menu` becomes a full-width bottom sheet. |
| `max-width: 39.99rem` | 639.8 | `styles/exportEditor.css:168` | Settings panel becomes a bottom sheet (`max-height: 85dvh`). The segmented controls narrow to 9rem and show abbreviations. Selection and footer rows stack. |
| `max-width: 40rem` | 640 | `pages/admin/index.astro:152` | The "waiting" table turns into stacked grid rows. |
| `max-width: 40rem` | 640 | `pages/calendar/ordinary-form/index.astro:91` | Occasion directory goes from 2 columns to 1. |
| `max-width: 42rem` | 672 | `pages/index.astro:89` | Calendar cards go to one column. |
| `max-width: 44rem` | 704 | `components/Layout.astro:170` | Both form links swap `.form-full` for `.form-short`: "EF (1962)" and "OF". |
| `max-width: 50rem` | 800 | `pages/admin/typeset/edit.astro:42` | `.panels` grid becomes one column. |
| `min-width: 60rem` | 960 | `pages/admin/index.astro:165` | `.item.has-scan` becomes two columns (text and scan). |
| `min-width: 60rem` | 960 | `pages/admin/typeset/index.astro:205` | `.item.matches` and `.item.proofreading` become two columns. |
| `min-width: 60rem` | 960 | `pages/admin/sections/index.astro:63` | Two-column layout with a sticky list. |
| `min-width: 60rem` | 960 | `pages/admin/review/index.astro:159` | `.item.has-scan` becomes two columns. |
| `max-width: 61.99rem` | 991.8 | `styles/exportEditor.css:149` | Below two-column: FIT strip across the top, settings become a 22rem right slide-over panel with a toggle button. |
| `max-width: 62rem` | 992 | `components/ExportBar.astro:117` | Export bar becomes sticky at the bottom ("reachable one-handed on a console-mounted tablet"). |
| `min-width: 62rem` | 992 | `styles/exportEditor.css:180` | Editor becomes two columns: 20rem settings and the preview. The panel toggle is hidden. |

Query strings in script, which must match the CSS:

| Query | File:line | Purpose |
|---|---|---|
| `(min-width: 62rem)` | `scripts/exportLayout.ts:57`, used at `:132` | "wide" mode of the editor. |
| `(max-width: 39.99rem)` | `scripts/exportLayout.ts:465` | "compact" mode. |
| `(max-width: 39.99rem)` | `scripts/exportBreakEditor.ts:385` | Skips break-editing hooks on compact. |

`ExportLayoutEditor.test.ts:114-116` pins the three `exportEditor.css` queries
as exact strings, so a redesign must change that test as well.

### De facto breakpoints

- **40rem (640 px)**: the real "phone" edge. Four rules sit at 39.99 or 40rem
  (export editor compact mode, admin waiting table, OF directory columns).
  Neighbours at 34, 42, 44 and 50rem are one-off tweaks of the same edge.
- **60rem (960 px)**: admin pages go two-column. Four admin pages use it.
- **62rem (992 px)**: editor and export bar. This equals `--page-max`. Note the
  export bar uses `max-width: 62rem` (inclusive) while the editor uses
  `61.99rem` and `min-width: 62rem`, so at exactly 992 px the bar is sticky
  while the editor is in its wide layout.
- **Public reading pages are mostly fluid.** Day, piece, Vespers, Kyriale and
  hymn pages are fluid: `.page` is a centred 62rem column with a 16 px gutter,
  and type size comes from `clamp()`. Typeset music in `SystemStack.astro:107` switches from narrow to wide SVG sources at 40rem. The home page (42rem), the OF
  calendar (40rem), the header (44rem) and the piece list (34rem) also respond to width.

### Other queries

| Query | File:line | Effect |
|---|---|---|
| `@media (prefers-color-scheme: dark)` | `styles/tokens.css:47` | Dark token set (section 1). |
| `matchMedia("(prefers-color-scheme: dark)")` | `components/Layout.astro:109` | Syncs the polarity button's `aria-pressed` with the system. |
| `@media print` | `styles/base.css:94-102` | Forces light, `--ink:#000`, `--ink-muted:#333`, `--rule:#999`; body 11pt; hides `nav`, `.no-print`, `.skip-link` and all `button`; `.page` loses max-width and padding; music is `break-inside: avoid` with `filter: none`. It is the only `@media print` in the source. |
| `@media (prefers-reduced-motion: reduce)` | `styles/base.css:115` | Removes the disclosure-cue rotation (`transition` at 112). |

Motion that the reduced-motion query does **not** cover: the skip-link
`transition: top 0.15s` (`base.css:54`). Those are the only three
`transition` declarations in the source. There are no animations and no
`scroll-behavior`.

## 6. Where the system is bypassed (design debt)

Counted with a Python scan over every `.css` and `.astro` file under
`web/src`, excluding `tokens.css` and test files. The commands were of this
form (zsh needs `setopt no_nomatch` or quoted globs):

```bash
cd web
python3 - <<'PY'   # walks src/, regex per line
#   hex      #[0-9a-fA-F]{3,8}\b
#   shadow   box-shadow\s*:
#   gradient gradient\(
#   radius   border-radius\s*:
#   font-size  font-size\s*:\s*(value not starting var(--step)
#   px       (?<![\w.#-])\d*\.?\d+px\b
PY
```

(`grep -c` with `ugrep` as the system `grep` and the paths with brackets was
unreliable here, so the scan was done in Python.)

### Summary

| Check | Count | Verdict |
|---|---|---|
| Raw hex colours | 3 lines in 3 files | Near clean |
| `rgb()` / `rgba()` | 2 (`AdminNav.astro:49`, `e2e/[page].astro:200`) | 1 in a style, 1 in a test page script |
| `box-shadow` | 1 | One violation of the "no shadows" rule |
| Gradients | 0 | Clean |
| `border-radius` | 25 declarations, all `var(--radius)` | Clean, none above 2px |
| `font-size` outside `--step-*` | 2 of 77 | Near clean |
| Raw `px` values | 150 occurrences in 30 files | Mostly 1-3px borders and outlines |
| Controls bordered with `--rule` | 15 control rules (plus 3 disabled-button rules) | Contrast debt |
| Undefined custom property | 1 (`--line`) | Bug |
| Font family outside the two tokens | 1 (`monospace`) plus export-only Liberation Serif | Minor |

Overall the CSS follows its own rules well. The real debt is control-border
contrast and a few leftovers.

### Raw hex

| File:line | Value | Note |
|---|---|---|
| `pages/calendar/index.astro:93` | `#f6f3ea #9b1c1c #5b2a86 #2e6b30 #111111 #d98aa6` | Six liturgical-colour swatches (white, red, violet, green, black, rose). Not themed; the same in dark mode. These are data, not UI colour. |
| `pages/admin/typeset/index.astro:213` | `#fff` | `.drawing` background for typeset music. Should be `--print-paper`. |
| `styles/base.css:95` | `#fff #000 #333 #999` | Print overrides. Acceptable, but could use `--print-*`. |

### Shadow

| File:line | Value |
|---|---|
| `components/AdminNav.astro:49` | `box-shadow: 0 2px 8px rgb(0 0 0 / 0.25)` on the fixed `.admin-notice` bar. Admin only. |

### Font size outside the scale

| File:line | Value | Note |
|---|---|---|
| `styles/exportEditor.css:109` | `0.6875rem` (11px) | Breakpoint marker button label. Below `--step--1` (about 15px). |
| `styles/base.css:96` | `11pt` | Print body. Intended. |

### Raw `px` outside borders and outlines

| File:line | Value | Note |
|---|---|---|
| `styles/exportEditor.css:63, 73` | `56px` | Tall segmented option and big step buttons. Larger than `--tap-min`. |
| `styles/exportEditor.css:110` | `14px` box | Breakpoint marker box. The 44px tap target is the parent button (109). |
| `styles/exportEditor.css:109, 118, 120` | `12px` | Marker offsets. |
| `pages/admin/sections/index.astro:73` | `margin-bottom: 2px` | Should be a spacing token. |
| `styles/base.css:46`, `exportEditor.css:151, 171` | `1px` sr-only boxes | Intended. |

Most of the other 140 are `1px solid` rules and `2px` focus outlines, which
have no token.

### Spacing off the scale

- `pages/good-friday/index.astro:90`: `var(--s-5, 2.5rem)` has a fallback that
  duplicates the token. Harmless.
- `exportEditor.css` uses fixed `rem` widths (`20rem`, `22rem`, `14rem`, `8.5rem`)
  and `calc(var(--s-1) ...)` for padding. These are layout sizes, not tokens.

### Undefined or off-system references

- `pages/admin/typeset/edit.astro:39` uses `var(--line)`, which does not exist
  (the rule border colour token is `--rule`). The declaration is invalid, so the
  source editor has no visible border colour from the token. This is an
  unstyled admin page: it also uses `padding`/`margin` in `rem` and
  `font-family: monospace` (line 40) with no token.
- `--z` (`exportPreview.css:37`) is a local custom property set on `.cx-pages`
  for zoom. It is defined where it is used. Not a bug.

### Controls bordered with `--rule` (contrast 1.73:1 light, 1.58:1 dark)

`--rule` fails the 3:1 non-text test (WCAG 1.4.11). `--control-border` exists
for this, but it is only applied in the export editor and preview, and to
admin pages through `AdminNav.astro:38-40`. **Public controls used `--rule` until 2026-10-22, when they moved to `--control-border`:**

| File:line | Selector | Public? |
|---|---|---|
| `styles/base.css:66` | `button, .button` (every default button on the site) | Yes |
| `pages/search.astro:39` | `input` (search box) | Yes |
| `pages/calendar/index.astro:59` | `.picker input` (date picker) | Yes |
| `pages/calendar/ordinary-form/index.astro:81` | `.picker input` | Yes |
| `pages/corrections/index.astro:125` | `input, select, textarea` (reader corrections form) | Yes |

The remaining 10 are admin pages, where `AdminNav.astro:38-40` overrides the
border colour to `--control-border` under `.admin.ui`. Those rules are
`admin/index.astro:178`, `admin/sections/index.astro:76`, `admin/edit/index.astro:80`,
`admin/review/index.astro:147, 152, 169, 177` and `admin/typeset/index.astro:188, 226, 235`.
The override has higher specificity than these rules, but a page that lacks the
`.admin.ui` classes would show the weak border.

The three `.primary:disabled` rules also use `--rule`
(`base.css:72`, `AdminNav.astro:42`, `admin/index.astro:162`). Disabled controls
are exempt from 1.4.11.

Total `var(--rule)` uses are 85 border-style lines in 29 files. All of those
other than the controls above are dividers, table rules and card edges, which is
the intended use.

### Per-file counts (descending)

Counts of lines using `border` with `var(--rule)`, `border-radius`, and raw
`px`:

| File | `--rule` borders | `border-radius` | raw `px` |
|---|---|---|---|
| `styles/exportEditor.css` | 7 | 3 | 40 |
| `pages/admin/review/index.astro` | 9 | 4 | 13 |
| `pages/admin/typeset/index.astro` | 7 | 4 | 11 |
| `pages/admin/index.astro` | 8 | 1 | 9 |
| `styles/base.css` | 4 | 2 | 10 |
| `styles/exportPreview.css` | 3 | 0 | 9 |
| `pages/calendar/ordinary-form/index.astro` | 5 | 2 | 6 |
| `components/AdminNav.astro` | 2 | 2 | 6 |
| `pages/index.astro` | 2 | 1 | 5 |
| `pages/admin/sections/index.astro` | 3 | 2 | 5 |
| All other files (19) | 35 | 6 | 36 |

### Redesign checklist from this section

1. Done 2026-10-22: apply `--control-border` to `base.css:66` (and the four public input rules),
   or raise `--rule` so it passes. This fixes every public control at once.
2. Done 2026-10-22: load Source Serif 4 or change the token to the font actually shown (Georgia).
3. Update the contrast comments in `tokens.css`.
4. Replace `--line` at `admin/typeset/edit.astro:39`.
5. Replace `#fff` at `admin/typeset/index.astro:213` with `--print-paper`.
6. Decide whether the admin toast shadow stays (`AdminNav.astro:49`).
7. Pick breakpoints: the code uses 34, 39.99, 40, 42, 44, 50, 60, 61.99 and 62rem.
   Three are enough (40, 60, 62), and the 62 pair should agree on inclusive or
   exclusive.
