// Bundle-size entry for route (i): pdfkit standalone UMD build (js/pdfkit.standalone.js)
// + svg-to-pdfkit, as the card names it.
// @ts-expect-error -- UMD standalone build, not in the exports map, no types (spike only)
import PDFDocument from "../../node_modules/pdfkit/js/pdfkit.standalone.js";
import { buildWithPdfKit } from "./routeKit.ts";
export const build = (svg: string, page: { width: number; height: number }, faces: Parameters<typeof buildWithPdfKit>[3]): ReturnType<typeof buildWithPdfKit> =>
  buildWithPdfKit(PDFDocument as unknown as Parameters<typeof buildWithPdfKit>[0], svg, page, faces);
