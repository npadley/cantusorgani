// Spike S4 (not shipped): inputs shared by both routes.
export const MM_TO_PT = 72 / 25.4;
export const PAGE_MM = { widthMm: 157.8, heightMm: 227.1 } as const;
export const pagePt = (mm: { widthMm: number; heightMm: number }): { width: number; height: number } => ({
  width: mm.widthMm * MM_TO_PT,
  height: mm.heightMm * MM_TO_PT,
});
/** A heading line exercising every accent the card names, drawn by our own code (B6b headings). */
export const HEADING_TEST = "Kýrie eléison — cǽlum, cœli: á é í ó ú ǽ œ";
export interface TextFaces {
  readonly regular: Uint8Array;
  readonly italic: Uint8Array;
  readonly bold: Uint8Array;
  readonly boldItalic: Uint8Array;
}
