import type { OfSeason } from "./ordinaryForm";

/** Suggestions follow the Kyriale's headings, retained in the Graduale Romanum (1974). */
export function ofKyrialeSuggestion(season: OfSeason, rank: string, weekday: number, isMarian: boolean): string {
  if (season === "easter") return "I";
  if (season === "advent" || season === "lent") return weekday === 0 ? "XVII" : "XVIII";
  if (rank === "solemnity" || rank === "privileged") return isMarian ? "IX" : "II";
  if (rank === "feast" || rank === "feast-of-the-lord") return isMarian ? "IX" : "IV";
  if (rank === "memorial" || rank === "optional-memorial") return isMarian ? "X" : "VII";
  if (weekday === 0 && (season === "ordinary" || season === "christmas")) return "XI";
  return "XVI";
}

/** Marian occasions name Mary in the catalogue's Latin title. */
export function ofMarianTitle(titleLa: string): boolean {
  return /\bMariae\b|\bB\.\s*M\.\s*V\./i.test(titleLa);
}

/** Stable seasonal occasion keys supply context when there is no calendar date. */
export function ofOccasionKyrialeContext(key: string, rank: string): { season: OfSeason; weekday: number } {
  const season: OfSeason = /^(easter|pentecost|ascension)(-|$)/.test(key) ? "easter"
    : key.startsWith("advent-") ? "advent"
    : /^(lent-|ash-|holy-(monday|tuesday|wednesday)$|palm-sunday$)/.test(key) ? "lent"
    : /^(christmas-|second-christmas$|epiphany$|baptism$|holy-family$|mary-mother-of-god$|st-stephen$|st-john$|holy-innocents$)/.test(key) ? "christmas"
    : /^(holy-thursday|good-friday)$/.test(key) ? "triduum" : "ordinary";
  const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const namedDay = weekdayNames.findIndex(day => key.includes(day));
  const sunday = rank === "sunday" || /^(advent|lent|easter)-\d+$/.test(key) || key === "easter";
  return { season, weekday: sunday ? 0 : namedDay > 0 ? namedDay : 1 };
}

/** Uses the day page's ordinary-option sections and export boxes. */
export async function mountOfKyriale(root: HTMLElement): Promise<void> {
  const layout = root.closest<HTMLElement>(".reader-layout") ?? root;
  const select = root.querySelector<HTMLSelectElement>("[data-of-mass]");
  const bar = layout.querySelector<HTMLElement>(".export");
  if (!select || !bar) return;
  const params = new URLSearchParams(location.search);
  const { ofDay } = await import("./ordinaryForm");
  const { parseIso, weekday } = await import("./liturgy");
  const { readOfSettings } = await import("./ordinaryFormSettings");
  const date = parseIso(params.get("date") ?? "");
  const season = date ? ofDay(date, readOfSettings(params)).season : root.dataset["ofSeason"] as OfSeason;
  const suggestion = ofKyrialeSuggestion(season, root.dataset["ofRank"] ?? "weekday",
    date ? weekday(date) : Number(root.dataset["ofWeekday"]), root.dataset["ofMarian"] === "true");
  for (const option of select.options) {
    option.textContent = (option.textContent ?? "").replace(" (suggested)", "") + (option.value === suggestion ? " (suggested)" : "");
  }
  const requested = params.get("mass");
  select.value = [...select.options].some(option => option.value === requested) ? requested! : suggestion;
  function choose(label: string, replace: boolean): void {
    layout.querySelectorAll<HTMLElement>("[data-ordinary-option]").forEach(node => {
      const active = node.dataset["ordinaryOption"] === label;
      if (node instanceof HTMLInputElement) { node.disabled = !active; node.checked = active; }
      else node.hidden = !active;
    });
    document.querySelectorAll<HTMLSelectElement>("[data-of-mass]").forEach(choice => { choice.value = label; });
    bar!.dataset["title"] = `${root.querySelector("h1")?.textContent ?? ""} with Missa ${label} — Nova Organi Harmonia`;
    bar!.querySelectorAll("[data-total-parts]").forEach(node => {
      node.textContent = String(bar!.querySelectorAll('input[name="export-part"]:not(:disabled)').length);
    });
    if (replace) {
      const url = new URL(location.href);
      url.searchParams.set("mass", label);
      history.replaceState(history.state, "", url);
      root.querySelectorAll<HTMLAnchorElement>("[data-cycle]").forEach(link => {
        const href = new URL(link.href); href.searchParams.set("mass", label); link.href = href.href;
      });
    }
    bar!.querySelector<HTMLInputElement>('input[name="export-part"]')?.dispatchEvent(new Event("change", { bubbles: true }));
  }
  layout.addEventListener("selectionchange", () => {
    const summary = layout.querySelector<HTMLElement>("#selection-summary");
    if (!summary) return;
    const available = [...bar.querySelectorAll<HTMLInputElement>('input[name="export-part"]:not(:disabled)')];
    summary.textContent = (summary.textContent ?? "").replace(/\d+ of \d+ parts/,
      `${available.filter(box => box.checked).length} of ${available.length} parts`);
  });
  select.addEventListener("change", () => choose(select.value, true));
  // The rail and its phone sheet share this list.
  const choice = root.querySelector<HTMLElement>("[data-of-mass-choice]");
  const list = bar.querySelector<HTMLElement>("[data-part-list]");
  if (choice && list) {
    const copy = choice.cloneNode(true) as HTMLElement;
    const label = copy.querySelector<HTMLElement>("[data-of-mass-label]");
    if (label) label.textContent = "Mass setting in export";
    const exportSelect = copy.querySelector<HTMLSelectElement>("[data-of-mass]");
    if (exportSelect) exportSelect.id = "of-mass-export";
    label?.setAttribute("for", "of-mass-export");
    exportSelect?.addEventListener("change", () => choose(exportSelect.value, true));
    // After the parts, so the part rows keep their place in the rail.
    list.append(copy);
  }
  choose(select.value, false);
}
