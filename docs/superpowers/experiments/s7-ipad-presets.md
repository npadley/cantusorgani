# S7 — iPad page presets

Date: 2026-10-08. Spike S7 of the [execution packet](../plans/2026-10-08-export-execution-packet.md). Decision context: DL D2 (iPad/forScore use case) and D4 (Print / iPad / Custom page sizes).

**Goal:** an iPad preset produces a PDF page with the same physical size and aspect ratio as the iPad screen. forScore then shows it full screen, and the staff appears at its true physical size.

**Method:** the native resolution and ppi come from Apple's tech-spec pages (sources below). Portrait size is `px / ppi × 25.4`, rounded to 0.1 mm. Aspect is height ÷ width.

## 1. Models, 2021–2026

| Class | Model, year | Native px (W×H portrait) | ppi | Portrait mm (W × H) | Aspect H/W | Source |
|---|---|---|---|---|---|---|
| mini | iPad mini (6th gen), 2021 | 1488×2266 | 326 | 115.9 × 176.6 | 1.5228 | [111886](https://support.apple.com/en-us/111886) |
| mini | iPad mini (A17 Pro), 2024 — current | 1488×2266 | 326 | 115.9 × 176.6 | 1.5228 | [121456](https://support.apple.com/en-us/121456), [ipad-mini/specs](https://www.apple.com/ipad-mini/specs/) |
| 11 | iPad Pro 11 (3rd gen), 2021 | 1668×2388 | 264 | 160.5 × 229.8 | 1.4317 | [111897](https://support.apple.com/en-us/111897) |
| 11 | iPad Pro 11 (4th gen), 2022 | 1668×2388 | 264 | 160.5 × 229.8 | 1.4317 | [111842](https://support.apple.com/en-us/111842) |
| 11 | iPad Pro 11 (M4), 2024 | 1668×2420 | 264 | 160.5 × 232.8 | 1.4508 | [119892](https://support.apple.com/en-us/119892) |
| 11 | iPad Pro 11 (M5), 2025 — current | 1668×2420 | 264 | 160.5 × 232.8 | 1.4508 | [ipad-pro/specs](https://www.apple.com/ipad-pro/specs/) |
| 11 | iPad Air (5th gen), 2022 | 1640×2360 | 264 | 157.8 × 227.1 | 1.4390 | [111887](https://support.apple.com/en-us/111887) |
| 11 | iPad Air 11 (M2), 2024 | 1640×2360 | 264 | 157.8 × 227.1 | 1.4390 | [119894](https://support.apple.com/en-us/119894) |
| 11 | iPad Air 11 (M3), 2025 | 1640×2360 | 264 | 157.8 × 227.1 | 1.4390 | [122241](https://support.apple.com/en-us/122241) |
| 11 | iPad Air 11 (M4), 2026 — current | 1640×2360 | 264 | 157.8 × 227.1 | 1.4390 | [ipad-air/specs](https://www.apple.com/ipad-air/specs/) |
| 11 | iPad (10th gen), 2022 | 1640×2360 | 264 | 157.8 × 227.1 | 1.4390 | [111840](https://support.apple.com/en-us/111840) |
| 11 | iPad (A16), 2025 — current | 1640×2360 | 264 | 157.8 × 227.1 | 1.4390 | [122240](https://support.apple.com/en-us/122240), [ipad-11/specs](https://www.apple.com/ipad-11/specs/) |
| (10.2) | iPad (9th gen), 2021 — 10.2-in., outside every class | 1620×2160 | 264 | 155.9 × 207.8 | 1.3333 | [apple.com/ipad/compare](https://www.apple.com/ipad/compare/) |
| 13 | iPad Pro 12.9 (5th gen), 2021 | 2048×2732 | 264 | 197.0 × 262.9 | 1.3340 | [111896](https://support.apple.com/en-us/111896) |
| 13 | iPad Pro 12.9 (6th gen), 2022 | 2048×2732 | 264 | 197.0 × 262.9 | 1.3340 | [111841](https://support.apple.com/en-us/111841) |
| 13 | iPad Pro 13 (M4), 2024 | 2064×2752 | 264 | 198.6 × 264.8 | 1.3333 | [119891](https://support.apple.com/en-us/119891) |
| 13 | iPad Pro 13 (M5), 2025 — current | 2064×2752 | 264 | 198.6 × 264.8 | 1.3333 | [ipad-pro/specs](https://www.apple.com/ipad-pro/specs/) |
| 13 | iPad Air 13 (M2), 2024 | 2048×2732 | 264 | 197.0 × 262.9 | 1.3340 | [119893](https://support.apple.com/en-us/119893) |
| 13 | iPad Air 13 (M3), 2025 | 2048×2732 | 264 | 197.0 × 262.9 | 1.3340 | [122242](https://support.apple.com/en-us/122242) |
| 13 | iPad Air 13 (M4), 2026 — current | 2048×2732 | 264 | 197.0 × 262.9 | 1.3340 | [ipad-air/specs](https://www.apple.com/ipad-air/specs/) |

The current line-up was cross-checked on [apple.com/ipad/compare](https://www.apple.com/ipad/compare/), which lists the same resolutions and ppi for every model above.

There are only **six distinct geometries**: mini 1488×2266@326, Air/base 1640×2360@264, Pro 11 (2021–22) 1668×2388@264, Pro 11 (M4/M5) 1668×2420@264, 12.9/Air 13 2048×2732@264, and Pro 13 (M4/M5) 2064×2752@264.

### Precision of `px / ppi`

Apple quotes ppi as a rounded nominal value. The diagonal computed from px/ppi exceeds Apple's stated diagonal by 0.19–0.30 % on every current model: mini 8.316 vs 8.3 in, Air 11 10.886 vs 10.86, Pro 11 11.133 vs 11.1, Air 13 12.933 vs 12.9, Pro 13 13.03 vs 13. Treat the presets as accurate to about ±0.3 % (±0.7 mm on a 230 mm side, ±0.03 mm on a 9.6 mm staff). That is well below the differences between classes, so it does not affect the choice. Displays also have rounded corners; the 4 mm iPad default margin (D4) keeps music clear of them.

## 2. Chosen values and error against the rest of the class

*Fit scale* is how much a reader must scale the preset page to fit another model's screen without clipping (forScore "Best Fit"). A value above 1 means the music appears larger than intended, and below 1 smaller. *Unused* is the strip of screen left blank along the slack axis.

| Preset | Chosen geometry | Portrait mm | Covers exactly | Worst case in class | Aspect error | Fit scale | Unused strip |
|---|---|---|---|---|---|---|---|
| `ipad-mini` | 1488×2266 @326 | **115.9 × 176.6** | all mini 2021–2026 | — | 0 % | 1.000 | 0 |
| `ipad-11` | 1640×2360 @264 | **157.8 × 227.1** | Air 5/M2/M3/M4, iPad 10th gen, iPad (A16) | Pro 11 (M4/M5) | 0.81 % | 1.017 (+1.7 %) | 1.9 mm (height) |
| | | | | Pro 11 (3rd/4th gen) | 0.51 % | 1.012 (+1.2 %) | 0.8 mm (width) |
| `ipad-13` | 2048×2732 @264 | **197.0 × 262.9** | Air 13 M2/M3/M4, Pro 12.9 5th/6th gen | Pro 13 (M4/M5) | 0.05 % | 1.007 (+0.7 %) | 0.1 mm |

**Alternatives considered:**
- *`ipad-11` = Pro 11 M5 (160.5 × 232.8).* This would be exact on the newest Pro but shrinks music 2.5 % on all six Air/base models, leaving 1.3 mm unused width. Rejected: the Air and base iPad are the majority of current and recent 11-inch devices (two of the three models on sale now), and the error is larger and in the worse direction (smaller music).
- *`ipad-13` = Pro 13 M4/M5 (198.6 × 264.8).* This is −0.78 % on the Air 13 and the 12.9-inch models. That is symmetric with the chosen value, but the chosen value is exact on five of seven models, including the current Air 13 (M4). Either is acceptable.

On "prefer the current generation": each class has two current geometries (the current Pro and the current Air/base). The choice follows the current Air/base geometry, which also covers older models.

**Split?** No class needs splitting. The largest in-class physical error is 1.7 %, which is +0.12 mm on the 7.2 mm "medium" staff (D8). The aspect error is ≤ 0.81 %, which leaves at most a 2 mm blank strip. Both are below what an organist would notice, and splitting would add two more presets to the picker for no visible gain. The 13-inch split suggested in the brief is the smallest error of all (0.05 % aspect, 0.7 % scale). Revisit this only if B0 analytics (D11) show heavy Pro 11 use and users report it.

**Out of class:** the 10.2-inch iPad (9th gen, sold until 2024) is 4:3. On it the `ipad-11` page fits at scale 0.915 (−8.5 %, letterboxed). Those users should use Custom 155.9 × 207.8 mm. See the open questions.

## 3. Comparison with current `PAGE_PRESETS`

| Preset | Contracts today | S7 value | Δ | Action |
|---|---|---|---|---|
| `ipad-mini` | 115.9 × 176.5 (1488×2266 @326) | 115.9 × 176.6 | 0.05 mm (contract truncated 176.553) | none (< 0.5 mm) |
| `ipad-11` | 157.8 × 227.1 (1640×2360 @264) | 157.8 × 227.1 | 0 | none |
| `ipad-13` | 197.0 × 262.8 (2048×2732 @264) | 197.0 × 262.9 | 0.05 mm (contract truncated 262.852) | none (< 0.5 mm) |

The contracts are unchanged. The two heights in the contract are truncated, not rounded. The difference is 0.05 mm, within the ±0.3 % uncertainty in §1. The coordinator may correct them to 176.6 and 262.9 at the next contract edit, but no rule requires it.

## 4. forScore page fitting (official documentation only)

Source: forScore, "Understanding Display Modes", <https://forscore.co/?p=1792> (no date on page); "Using Margin Adjustment", <https://forscore.co/kb/margin-adjustment/>; "Cropping pages", <https://forscore.co/kb/cropping/>.

- **Portrait has three modes.** Best Fit makes each page "as big as possible without clipping it". Standard Fit uses "a common aspect ratio across all devices", which can leave gaps at the sides or bottom. Zoomed fits the page height to the screen and may clip the left and right edges.
  - Under **Best Fit**, a page with the screen's aspect ratio fills the screen. That is the mode these presets assume.
  - Under **Standard Fit**, the page is letterboxed whatever its size. The UI's "fills the screen in forScore" claim holds only under Best Fit.
- **Landscape** offers Best Fit and Scroll; Scroll fits page width to screen width.
- **Margins:** none of the documentation describes automatic white-margin trimming. Margin Adjustment is a manual, per-score slider that "zoom[s] in equally towards the center of every page". Crop is a manual, per-page tool. Neither changes the PDF.
- **Not documented:** which portrait mode is the default; whether forScore's toolbar or status bar overlaps the page in performance view. Overlap would make the visible area smaller than the screen and break "true physical size". This needs a real-device check ([U]).

## 5. Open questions for the user

1. **Real-device check:** open an `ipad-11` export in forScore on your iPad in Best Fit. Does the page fill the screen edge to edge? Measure a staff with a ruler; it should be 7.2 mm for medium. Also note which display mode forScore was in by default.
2. **Should the "fills the screen in forScore" subtitle say "in Best Fit mode"?** This would cover Standard Fit users.
3. **10.2-inch iPad (9th gen) owners:** add a fourth preset, or rely on Custom? The recommendation is Custom.
4. **Next iPad mini:** an OLED iPad mini is widely rumoured for 2026, but no Apple spec exists yet. If it changes the 1488×2266@326 geometry, `ipad-mini` needs a re-check.
