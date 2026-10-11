// Bundle-size entry for route (i): pdfkit's browser ESM export
// (js/pdfkit.browser.mjs, what a Vite worker build resolves) + svg-to-pdfkit.
// pdfkit 0.18+ needs the default Helvetica metrics registered in the browser,
// because the constructor opens Helvetica before any custom font.
import * as pdfkit from "pdfkit";
import Helvetica from "pdfkit/standard-fonts/Helvetica";
import { buildWithPdfKit } from "./routeKit.ts";
// registerStdFonts exists at runtime in 0.20 but not in @types/pdfkit.
(pdfkit as unknown as { registerStdFonts(...fonts: object[]): void }).registerStdFonts(Helvetica);
export const build = (svg: string, page: { width: number; height: number }, faces: Parameters<typeof buildWithPdfKit>[3]): ReturnType<typeof buildWithPdfKit> =>
  buildWithPdfKit(pdfkit.default as unknown as Parameters<typeof buildWithPdfKit>[0], svg, page, faces);
