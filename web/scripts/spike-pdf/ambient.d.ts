// Ambient types for svg-to-pdfkit@0.1.8 (ships none). Spike only.
declare module "svg-to-pdfkit" {
  export interface SvgToPdfOptions {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
    precision?: number;
    fontCallback?: (family: string, bold: boolean, italic: boolean, options: { fauxBold?: boolean; fauxItalic?: boolean }) => string;
    warningCallback?: (message: string) => void;
  }
  export default function SVGtoPDF(doc: unknown, svg: string, x: number, y: number, options?: SvgToPdfOptions): void;
}

// pdfkit 0.20 browser API missing from @types/pdfkit (spike only).
declare module "pdfkit/standard-fonts/Helvetica" {
  const metrics: object;
  export default metrics;
}
declare module "fontkit" {
  export function create(buffer: Uint8Array, postscriptName?: string): object;
}
