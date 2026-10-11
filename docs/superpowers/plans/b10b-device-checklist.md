# B10b: iPad device check

One sitting, about 30 minutes. You need the Mac and the iPad on the same Wi-Fi, forScore on the iPad, and a printer with Letter or A4 paper and a ruler.

## Start the server (on the Mac)

```bash
cd web
pnpm build:e2e        # once, or after the code changes: builds the test version of the site
pnpm serve:device     # leave it running; Ctrl-C stops it
```

It prints an address like `http://192.168.1.20:4330/kyriale/ix/`. That is the page to open on the iPad. The music images come from the live site, so the Mac needs internet.

If Safari can't reach it: check both devices are on the same Wi-Fi, and that the Mac's firewall allows `node` to accept connections.

## On the iPad

Open the address in Safari. Use the iPad in portrait first.

1. **Open.** The page is Missa IX. Under "Choose parts", the bar has **Customize export** next to Export PDF. Untick everything except Kyrie (Choose parts, then tick only Kyrie).
2. **Customize export.** The editor opens full screen. Wait for the page preview to appear (the first time can take up to a minute).
3. **Pick the iPad size.** Tap **Settings**, then **Page size: iPad**, then your model (**11-inch iPad**, or **iPad mini** if yours is a mini). Tap **Done**. The preview should show the iPad page.
4. **Download.** Tap **Download PDF**. Open the file from Safari's download list.
5. **Open in forScore.** In the share sheet choose **Open in forScore** (or Copy to forScore). Open it in forScore with its default **Best Fit** setting.
6. **Look at it.** The music should fill the screen. Only the page margin around it, with no extra white bars.

Then try each of these, downloading and opening in forScore each time:

7. **Large music.** Music size: Large. Is the staff comfortable to read at the music desk?
8. **Systems per page.** Use the minus button on "Systems per page" to ask for 2. Do the pages have at most 2 systems each?
9. **A page break.** Settings, Breaks, **Choose where systems break**. Tap a small square under a staff, then **Start new page here**. The page count should go up by one. Download: the PDF should break at the same place.
10. **Reading at the music desk.** Stand the iPad on the music desk at playing distance. Can you read the notes and the words?

## Print one copy (on the Mac or the iPad)

11. In the editor choose **Print: Letter** (or **A4**), music size **Medium**, and download.
12. Print it at **100% / Actual size** (not "Fit to page").
13. Measure one staff, from the top line to the bottom line, with the ruler. **Medium should be 7.2 mm, give or take 0.2 mm** (7.0 to 7.4). Large is 9.6 mm; Small is 5.6 mm.

## Things you will see that are expected

- A system cut in the middle of a measure inside an original line (A5 landscape, original lines) has tied notes and no closing barline at the cut. That is correct.
- In break mode on a wide screen, the label of the focused break point ("after 'Ky'") may touch the next square. Known, cosmetic.
- On the device you reach the Mac by its network address, not "localhost". The editor works there (it carries its own hashing code for this case).

## Results

Fill in one row each; "pass" or "fail" and a short note. Then give the table back to be recorded in the decision log.

| # | Check | Pass / fail | Notes |
|---|---|---|---|
| 1 | Customize export button appears on Missa IX | | |
| 2 | Editor opens; preview appears | | |
| 3 | iPad preset (model: ______) shows an iPad-shaped page | | |
| 4 | PDF downloads and opens | | |
| 5 | Opens in forScore | | |
| 6 | Fills the screen at Best Fit, no extra bars | | |
| 7 | Large music reads well | | |
| 8 | Systems per page = 2 is honoured | | |
| 9 | Page break added; PDF follows it | | |
| 10 | Legible at the music desk | | |
| 11 | Letter/A4 prints at 100% | | |
| 12 | Medium staff measures 7.2 mm ± 0.2 (measured: ____ mm) | | |
| 13 | Anything else odd (freezes, blank pages, wrong fonts) | | |

Device: iPad model ______, iOS ______, forScore version ______. Date ______.
