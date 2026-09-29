import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { EXPORT_CEILING } from "./config";

/**
 * PDF assembly, kept out of the Worker so it can be tested in Node against real
 * slice files. The Worker is a thin message-passing wrapper around this.
 *
 * Systems are packed down each page rather than one per sheet: a single Mass is
 * ~34 systems, and one-per-page would produce a 34-page download that is
 * unusable at an organ bench.
 */

export const A4 = { width: 595.28, height: 841.89 } as const;
export const LETTER = { width: 612, height: 792 } as const;
export type Paper = "letter" | "a4";
export const PAPERS: Readonly<Record<Paper, { readonly width: number; readonly height: number }>> = { letter: LETTER, a4: A4 };
export const MARGIN = 24;
export const GAP = 14;
/** The typeset pages' own top margin (12 mm: pipeline/typeset/render.py). */
export const TYPESET_TOP = 12 * 72 / 25.4;
/** Systems average a little under a quarter of a page at export width. */
export const SYSTEMS_PER_PAGE = 4.5;

export interface BuildOptions {
  readonly refs: readonly string[];
  readonly title: string;
  /** Returns the PNG bytes for a system ref. Injected so tests can read files. */
  readonly fetchPng: (ref: string) => Promise<ArrayBuffer>;
  readonly onProgress?: (done: number, total: number) => void;
  /** A heading printed above the system at `index` (a part's first system). */
  readonly headings?: readonly { readonly index: number; readonly label: string }[];
  /** Letter (the default) or A4. */
  readonly paper?: Paper;
  /** Typeset music in place of scans: the `count` systems from `index` are
   * replaced by the pages of the PDF at `pdf` (LilyPond's, at this paper size),
   * each part starting on a new page. When it cannot be fetched, the scans are
   * used and the part is named in the result's `fallbacks`. */
  readonly typeset?: readonly TypesetInsert[];
  /** Returns a typeset PDF's bytes. Injected so tests can read files. */
  readonly fetchPdf?: (url: string) => Promise<ArrayBuffer>;
}

export interface TypesetInsert {
  readonly index: number;
  readonly count: number;
  readonly pdf: string;
  readonly label: string;
}

export const HEADING_SIZE = 11;

/**
 * Text Helvetica's WinAnsi encoding can show: accents it lacks are dropped to
 * the bare letter ("ǽ" -> "æ"), anything else outside Latin-1 and the dashes
 * is removed. pdf-lib throws on an unencodable character, and a thrown export
 * at the console is worse than an unaccented heading.
 */
export function pdfSafe(text: string): string {
  return [...text].map((ch) => {
    if (/^[\u0020-\u007e\u00a0-\u00ff\u2013\u2014\u2018\u2019\u201c\u201d]$/.test(ch)) return ch;
    const bare = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
    if (bare === "\u00e6" || ch === "\u01fd") return "\u00e6";
    if (ch === "\u01fc") return "\u00c6";
    return /^[\u0020-\u007e\u00a0-\u00ff]$/.test(bare) ? bare : "";
  }).join("");
}

export interface BuildResult {
  readonly bytes: Uint8Array;
  readonly pages: number;
  /** Typeset parts whose PDF could not be fetched, exported as scans instead. */
  readonly fallbacks: readonly string[];
}

export function estimatePages(systems: number): number {
  return Math.max(1, Math.ceil(systems / SYSTEMS_PER_PAGE));
}

/** A ticked part and its size, so an over-ceiling message can name what to untick. */
export interface PartSize {
  readonly label: string;
  readonly systems: number;
}

export function validateSelection(count: number, ticked: readonly PartSize[] = []): string | null {
  if (count === 0) return "Tick at least one part to export.";
  if (count <= EXPORT_CEILING) return null;
  const message =
    `This selection is ${count} systems (about ${estimatePages(count)} pages); ` +
    `the limit is ${EXPORT_CEILING}.`;
  // The fewest largest parts that bring it under the ceiling.
  const over = count - EXPORT_CEILING;
  const drop: PartSize[] = [];
  let removed = 0;
  for (const part of [...ticked].sort((a, b) => b.systems - a.systems)) {
    if (removed >= over) break;
    drop.push(part);
    removed += part.systems;
  }
  if (drop.length === 0 || removed < over) return `${message} Untick some parts to fit.`;
  const names = drop.map((p) => `the ${p.label} (${p.systems} systems)`).join(" and ");
  return `${message} Untick ${names} to fit.`;
}

export async function buildPdf(options: BuildOptions): Promise<BuildResult> {
  const { refs, title, fetchPng, onProgress } = options;
  const headings = new Map((options.headings ?? []).map((h) => [h.index, pdfSafe(h.label)]));
  const size = PAPERS[options.paper ?? "letter"];
  const inserts = new Map((options.typeset ?? []).map((t) => [t.index, t]));

  const problem = validateSelection(refs.length);
  if (problem) throw new Error(problem);

  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setSubject("Nova Organi Harmonia (Mechelen, 1942) — public domain");
  doc.setCreator("Cantus Organi — cantusorgani.org");

  const font = headings.size > 0 ? await doc.embedFont(StandardFonts.HelveticaBold) : null;
  const usableWidth = size.width - MARGIN * 2;
  let page = doc.addPage([size.width, size.height]);
  let cursor = size.height - MARGIN;
  let pages = 1;
  let fresh = true;            // nothing drawn on `page` yet
  const fallbacks: string[] = [];

  function newPage(): void {
    if (fresh) return;
    page = doc.addPage([size.width, size.height]);
    cursor = size.height - MARGIN;
    pages += 1;
    fresh = true;
  }

  /** A typeset part's own pages, each drawn whole onto one of ours; false if it cannot be had. */
  async function typeset(insert: TypesetInsert, heading: string | undefined): Promise<boolean> {
    if (!options.fetchPdf) return false;
    let embedded: Awaited<ReturnType<PDFDocument["embedPdf"]>>;
    try {
      const source = await PDFDocument.load(await options.fetchPdf(insert.pdf));
      // pdf-lib embeds at save(), and a page with nothing on it would fail the
      // whole export there: refuse it here instead.
      if (source.getPages().some((p) => !p.node.Contents())) return false;
      embedded = await doc.embedPdf(source, source.getPageIndices());
    } catch {
      return false;             // not fetched, or not a PDF pdf-lib can use: the scans instead
    }
    if (embedded.length === 0) return false;
    newPage();
    embedded.forEach((art, k) => {
      if (k > 0) newPage();
      // Drawn to fit the page (they are made at this paper size, so 1:1),
      // lowered on the first page just enough to clear the part's heading.
      const drop = k === 0 && heading && font ? Math.max(0, MARGIN + HEADING_SIZE + 6 - TYPESET_TOP) : 0;
      const scale = Math.min(size.width / art.width, (size.height - drop) / art.height);
      page.drawPage(art, { x: 0, y: size.height - drop - art.height * scale, width: art.width * scale,
                           height: art.height * scale });
      if (k === 0 && heading && font) {
        page.drawText(heading, { x: MARGIN, y: size.height - MARGIN - HEADING_SIZE, size: HEADING_SIZE, font,
                                 color: rgb(0, 0, 0) });
      }
      fresh = false;
      cursor = MARGIN;          // a part after typeset music starts on a new page
    });
    return true;
  }

  for (let index = 0; index < refs.length; index++) {
    const insert = inserts.get(index);
    if (insert && insert.count > 0) {
      if (await typeset(insert, headings.get(index))) {
        index += insert.count - 1;
        onProgress?.(index + 1, refs.length);
        continue;
      }
      fallbacks.push(insert.label);
    }
    const ref = refs[index] as string;
    const image = await doc.embedPng(await fetchPng(ref));
    const scale = usableWidth / image.width;
    const height = image.height * scale;

    const heading = headings.get(index);
    const headingRoom = heading && font ? HEADING_SIZE + 6 : 0;
    // A heading never ends a page on its own: it moves with its system.
    if (cursor - headingRoom - height < MARGIN) {
      fresh = false;
      newPage();
    }
    if (heading && font) {
      page.drawText(heading, { x: MARGIN, y: cursor - HEADING_SIZE, size: HEADING_SIZE, font,
                               color: rgb(0, 0, 0) });
      cursor -= headingRoom;
    }
    page.drawImage(image, { x: MARGIN, y: cursor - height, width: usableWidth, height });
    cursor -= height + GAP;
    fresh = false;

    onProgress?.(index + 1, refs.length);
  }

  // Never emit a partial PDF: a silently incomplete export at a console is the
  // worst outcome available here. Any throw above propagates instead.
  return { bytes: await doc.save(), pages, fallbacks };
}

/** Fetches a typeset PDF from R2 (under its own cache key, like the slices). */
export async function httpPdfFetcher(url: string): Promise<ArrayBuffer> {
  const response = await fetch(/^https?:/.test(url) ? `${url}?export=1` : url);
  if (!response.ok) throw new Error(`typeset PDF ${response.status}`);
  return response.arrayBuffer();
}

/** Fetches the @2x.png variant. pdf-lib cannot embed WebP, and decoding WebP via
 *  canvas fails silently on older Safari on iPad — the exact device this is for. */
export function httpPngFetcher(base: string): (ref: string) => Promise<ArrayBuffer> {
  // `ref` is a full URL stem carrying the content hash, because published keys
  // cannot be derived from a system reference. `base` is retained only for
  // callers that still pass bare refs (the Node tests read local files).
  return async (ref: string): Promise<ArrayBuffer> => {
    const path = base.length > 0 ? `${base}/${ref}@2x.png` : `${ref}@2x.png`;
    // A cache key of its own: the CDN keeps copies of each slice fetched by <img>
    // tags, which carry no CORS header, and would serve them to this cross-origin
    // fetch. Copies under ?export=1 are only ever fetched with CORS.
    const url = /^https?:/.test(path) ? `${path}?export=1` : path;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Could not fetch system ${ref} (${response.status}). Nothing was downloaded.`,
      );
    }
    return response.arrayBuffer();
  };
}
