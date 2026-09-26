import { PDFDocument } from "pdf-lib";

/**
 * PDF assembly, kept out of the Worker so it can be tested in Node against real
 * slice files. The Worker is a thin message-passing wrapper around this.
 *
 * Systems are packed down each page rather than one per sheet: a single Mass is
 * ~34 systems, and one-per-page would produce a 34-page download that is
 * unusable at an organ bench.
 */

export const A4 = { width: 595.28, height: 841.89 } as const;
export const MARGIN = 24;
export const GAP = 14;
export const MAX_SYSTEMS = 60;

export interface BuildOptions {
  readonly refs: readonly string[];
  readonly title: string;
  /** Returns the PNG bytes for a system ref. Injected so tests can read files. */
  readonly fetchPng: (ref: string) => Promise<ArrayBuffer>;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface BuildResult {
  readonly bytes: Uint8Array;
  readonly pages: number;
}

export function validateSelection(count: number): string | null {
  if (count === 0) return "Select at least one piece to export.";
  if (count > MAX_SYSTEMS) {
    return (
      `You have selected ${count} systems. Export is limited to ${MAX_SYSTEMS} ` +
      `so it can be built on a tablet. Remove ${count - MAX_SYSTEMS}, or export ` +
      `this Mass in two parts.`
    );
  }
  return null;
}

export async function buildPdf(options: BuildOptions): Promise<BuildResult> {
  const { refs, title, fetchPng, onProgress } = options;

  const problem = validateSelection(refs.length);
  if (problem) throw new Error(problem);

  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setSubject("Nova Organi Harmonia (Mechelen, 1942) — public domain");
  doc.setCreator("Cantus Organi — cantusorgani.org");

  const usableWidth = A4.width - MARGIN * 2;
  let page = doc.addPage([A4.width, A4.height]);
  let cursor = A4.height - MARGIN;
  let pages = 1;

  for (const [index, ref] of refs.entries()) {
    const image = await doc.embedPng(await fetchPng(ref));
    const scale = usableWidth / image.width;
    const height = image.height * scale;

    if (cursor - height < MARGIN) {
      page = doc.addPage([A4.width, A4.height]);
      cursor = A4.height - MARGIN;
      pages += 1;
    }
    page.drawImage(image, { x: MARGIN, y: cursor - height, width: usableWidth, height });
    cursor -= height + GAP;

    onProgress?.(index + 1, refs.length);
  }

  // Never emit a partial PDF: a silently incomplete export at a console is the
  // worst outcome available here. Any throw above propagates instead.
  return { bytes: await doc.save(), pages };
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
