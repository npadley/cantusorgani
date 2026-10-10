// Spike S4 (optional size cut for route (ii)): present upstream fontkit 2.0.4
// (235 KB minified; the one pdfkit uses) through the fontkit 1.x surface that
// pdf-lib 1.17.1 calls, instead of @pdf-lib/fontkit 1.1.1 (939 KB minified).
// pdf-lib needs: create(bytes), font.layout/glyphForCodePoint/characterSet/...,
// and font.createSubset().encodeStream() with on('data'|'end'|'error').
import * as fontkit2 from "fontkit";
import type { Fontkit } from "./routeLib.ts";

interface Subset2 { includeGlyph(g: unknown): number; encode(): Uint8Array }
interface Font2 { createSubset(): Subset2 }

type Listener = (arg?: unknown) => void;
function onceStream(produce: () => Uint8Array): { on(ev: string, fn: Listener): ReturnType<typeof onceStream> } {
  const listeners = new Map<string, Listener>();
  const s = {
    on(ev: string, fn: Listener) {
      listeners.set(ev, fn);
      if (listeners.has("data") && listeners.has("end") && listeners.has("error")) {
        queueMicrotask(() => {
          try { listeners.get("data")?.(produce()); listeners.get("end")?.(); } catch (e) { listeners.get("error")?.(e); }
        });
      }
      return s;
    },
  };
  return s;
}

export const fontkit2Adapter: Fontkit = {
  create(bytes: Uint8Array) {
    const font = fontkit2.create(bytes) as unknown as Font2;
    const createSubset = font.createSubset.bind(font);
    return Object.assign(font, {
      createSubset: () => {
        const sub = createSubset();
        return Object.assign(sub, { encodeStream: () => onceStream(() => sub.encode()) });
      },
    }) as unknown as ReturnType<Fontkit["create"]>;
  },
};
