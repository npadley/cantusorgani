// Bundle-size entry for route (ii) with @pdf-lib/fontkit 1.1.1: what a PDF worker would import.
import fontkit from "@pdf-lib/fontkit";
import { buildWithPdfLib } from "./routeLib.ts";
export const build = (svg: string, page: { width: number; height: number }, faces: Parameters<typeof buildWithPdfLib>[2]): ReturnType<typeof buildWithPdfLib> =>
  buildWithPdfLib(svg, page, faces, fontkit);
