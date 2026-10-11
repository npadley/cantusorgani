// Bundle-size entry for route (ii) with upstream fontkit 2.0.4 via the adapter.
import { fontkit2Adapter } from "./fontkit2Adapter.ts";
import { buildWithPdfLib } from "./routeLib.ts";
export const build = (svg: string, page: { width: number; height: number }, faces: Parameters<typeof buildWithPdfLib>[2]): ReturnType<typeof buildWithPdfLib> =>
  buildWithPdfLib(svg, page, faces, fontkit2Adapter);
