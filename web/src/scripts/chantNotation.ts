import type { ExsurgeContext, ExsurgeLib } from "../lib/exsurge";
import { cleanGabc, readChantDisplay, writeChantDisplay } from "../lib/gabc";
import type { ChantDisplay, PrefStore } from "../lib/gabc";

/**
 * Chant notation beside each part (or Vespers item), drawn in the browser by
 * Exsurge when the reader asks for it: the switch `[data-chant-toggle]` and the
 * boxes `.chant-notation[data-chant-id]`. Off by default: the page is the organ
 * score. Shared by MovementNav and the Vespers page.
 */
export function initChantNotation(): void {
  const toggle = document.querySelector<HTMLInputElement>("[data-chant-toggle]");
  const boxes = [...document.querySelectorAll<HTMLElement>(".chant-notation")];

  function store(): PrefStore | null {
    try { return window.localStorage; } catch { return null; }
  }

  interface ChantJson { readonly gabc: string; readonly incipit: string }
  const cache = new Map<string, Promise<ChantJson>>();
  let library: Promise<ExsurgeLib> | null = null;

  function loadExsurge(): Promise<ExsurgeLib> {
    library ??= new Promise((resolve, reject) => {
      if (window.exsurge) { resolve(window.exsurge); return; }
      const script = document.createElement("script");
      script.src = "/vendor/exsurge/exsurge.min.js";
      script.onload = () => (window.exsurge ? resolve(window.exsurge) : reject(new Error("no exsurge")));
      script.onerror = () => reject(new Error("exsurge did not load"));
      document.head.appendChild(script);
    });
    return library;
  }

  function context(lib: ExsurgeLib, box: HTMLElement): ExsurgeContext {
    const ctxt = new lib.ChantContext(lib.TextMeasuringStrategy.Canvas);
    ctxt.setGlyphScaling(1 / 16);
    ctxt.textColor = ctxt.staffLineColor = ctxt.neumeLineColor = ctxt.dividerLineColor = "currentColor";
    ctxt.negativeFillColor = "var(--exsurge-negative-fill, #fff)";
    ctxt.setFont(getComputedStyle(box).fontFamily || "serif", 19.2 / 0.9);
    ctxt.spaceBetweenSystems = 0;
    return ctxt;
  }

  function fail(box: HTMLElement): void {
    box.dataset["state"] = "error";
    box.querySelector(".chant-drawing")?.remove();
    if (!box.querySelector(".chant-error")) {
      const p = document.createElement("p");
      p.className = "chant-error small muted";
      p.textContent = "The chant could not be drawn here; the Chant link beside the heading opens it on GregoBase.";
      box.prepend(p);
    }
  }

  async function draw(box: HTMLElement): Promise<void> {
    const width = Math.min(box.clientWidth, 900);
    if (width <= 0 || box.dataset["width"] === String(width)) return;
    box.dataset["width"] = String(width);
    const id = box.dataset["chantId"] ?? "";
    try {
      const [lib, chant] = await Promise.all([loadExsurge(), fetchChant(id)]);
      const ctxt = context(lib, box);
      const score = new lib.ChantScore(ctxt, lib.Gabc.createMappingsFromSource(ctxt, cleanGabc(chant.gabc)), true);
      score.annotation = new lib.Annotations(ctxt, `%${box.dataset["annotation"] ?? ""}%`, `%${box.dataset["mode"] ?? ""}%`);
      score.performLayoutAsync(ctxt, () => score.layoutChantLines(ctxt, width, () => {
        const svg = score.createSvgNode(ctxt);
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", `Chant notation: ${chant.incipit}`);
        const holder = document.createElement("div");
        holder.className = "chant-drawing";
        holder.appendChild(svg);
        box.querySelector(".chant-drawing")?.remove();
        box.prepend(holder);
      }));
    } catch {
      fail(box);
    }
  }

  function fetchChant(id: string): Promise<ChantJson> {
    if (!/^\d+$/.test(id)) return Promise.reject(new Error("bad id"));
    let pending = cache.get(id);
    if (!pending) {
      pending = fetch(`/chant/${id}.json`).then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json() as Promise<ChantJson>;
      });
      cache.set(id, pending);
    }
    return pending;
  }

  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) void draw(entry.target as HTMLElement);
    }
  }, { rootMargin: "800px 0px" });

  function apply(display: ChantDisplay): void {
    const show = display === "show";
    if (toggle) toggle.checked = show;
    for (const box of boxes) {
      box.hidden = !show;
      if (show) seen.observe(box); else seen.unobserve(box);
    }
    if (show) {
      // The observer's first report can come before layout settles (the
      // preference applied while the page loads): draw what is already near
      // the screen directly, once layout has happened.
      requestAnimationFrame(() => {
        for (const box of boxes) {
          const r = box.getBoundingClientRect();
          if (r.bottom > -800 && r.top < window.innerHeight + 800) void draw(box);
        }
      });
    }
  }

  if (toggle && boxes.length > 0) {
    apply(readChantDisplay(store()));
    toggle.addEventListener("change", () => {
      const display: ChantDisplay = toggle.checked ? "show" : "link";
      writeChantDisplay(store(), display);
      apply(display);
    });
    let resizing: number | undefined;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizing);
      resizing = window.setTimeout(() => {
        for (const box of boxes) if (!box.hidden && box.dataset["width"]) void draw(box);
      }, 250);
    });
  }
}
