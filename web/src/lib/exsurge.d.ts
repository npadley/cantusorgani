// The slice of Exsurge (bbloomf/exsurge, vendored at /vendor/exsurge/) the site uses.
export interface ExsurgeContext {
  setGlyphScaling(scale: number): void;
  setFont(family: string, size: number): void;
  setRubricColor(color: string): void;
  textColor: string;
  staffLineColor: string;
  neumeLineColor: string;
  dividerLineColor: string;
  negativeFillColor: string;
  spaceBetweenSystems: number;
}

export interface ExsurgeScore {
  annotation: unknown;
  /** One entry per chant line, with its bounds in Exsurge units (after layoutChantLines). */
  lines: readonly { readonly bounds: { readonly y: number; readonly height: number } }[];
  performLayoutAsync(ctxt: ExsurgeContext, done: () => void): void;
  layoutChantLines(ctxt: ExsurgeContext, width: number, done: () => void): void;
  createSvgNode(ctxt: ExsurgeContext): SVGSVGElement;
}

export interface ExsurgeLib {
  ChantContext: new (strategy?: unknown) => ExsurgeContext;
  TextMeasuringStrategy: { readonly Canvas: unknown };
  ChantScore: new (ctxt: ExsurgeContext, mappings: unknown, dropCap: boolean) => ExsurgeScore;
  Annotations: new (ctxt: ExsurgeContext, first: string, second?: string) => unknown;
  Gabc: { createMappingsFromSource(ctxt: ExsurgeContext, gabc: string): unknown };
}

declare global {
  interface Window { exsurge?: ExsurgeLib }
}
