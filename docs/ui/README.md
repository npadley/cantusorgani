# UI baseline

What the site looks like and does today, recorded before any redesign so that
nothing is lost by accident. This folder describes the **current** state.
Product direction lives in
[the 10-20 reading-edition correction](../reports/2026-10-20-reading-edition-design-correction.md)
and decisions in [DECISIONS.md](../DECISIONS.md).

Baseline taken 2026-10-22 from `main` at #139.

| Doc | What it holds |
|---|---|
| [templates.md](templates.md) | Every page template: route, file, page count, regions and components, interactivity, states, screenshots |
| [tokens.md](tokens.md) | Colour tokens with computed contrast, type scale, spacing, house rules, every breakpoint in use, and where the system is bypassed |
| [journeys.md](journeys.md) | How organists, readers and editors use the site today, step by step, with the friction visible in the code |
| [must-keep.md](must-keep.md) | No-regression checklist: every capability a redesign must keep, where it lives and how to verify it |
| [accessibility.md](accessibility.md) | What is in place, the known gaps, and the agreed WCAG target |
| [screenshots/](screenshots/) | 21 templates × (390 light, 1024 light, 1024 dark), from a production build with the published images |

## Accessibility target

WCAG 2.2 AA site-wide, with AAA (7:1) contrast for body text and music,
decided 2026-10-22 in [DECISIONS.md, P12](../DECISIONS.md). See
[accessibility.md](accessibility.md) for the agreed criteria and current gaps.

## What a redesign should know first

- **Readers never see the declared text font.** `--font-text` names Source
  Serif 4, but no `@font-face` loads it, so pages render in Georgia.
- **Controls fail non-text contrast.** Buttons and public form fields are
  bordered with `--rule` (about 1.7:1). `--control-border` (3.7:1) exists but
  is used mainly in admin and the export editor.
- **There are no breakpoint tokens.** Nine raw widths are in use; 40, 60 and
  62rem are the de facto ones.
- **A piece page puts three control blocks before the first note**: jump
  links, the export bar and the typeset switch. A day page shows no music.
- **No automated accessibility checks** (axe or similar) run in the tests.

The detail and evidence for each are in the docs above.

## Refreshing the screenshots

```bash
cd web
pnpm build                      # with PUBLIC_ASSET_BASE set, so the scans load
pnpm exec astro preview --port 4325
pnpm ui:screenshots --base http://localhost:4325          # the committed set
pnpm ui:screenshots --base http://localhost:4325 --all    # adds 768px and every dark view, for local review
```

The routes are in [routes.json](routes.json), one real URL per template plus
the actions that open the export dialog and show the chant. Screenshots are
viewport-only JPEGs (quality 70), so the set stays under 4 MB. Commit a
refresh only when the UI has changed.
