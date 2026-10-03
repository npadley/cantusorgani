/**
 * The Typeset page's match buttons: **This part** (one of the candidates, or a
 * part the editor names), **Not in the catalogue** and **A different
 * setting**. Each is a `match` correction on typeset:<file>, approved at once
 * like any edit an editor makes, and published with the next batch. Items an
 * editor has already answered are marked from /admin/api/review-state.
 * Everything shown is built with DOM calls.
 */
import { api, h, offerUndo, say, signInAgain } from "./client";
import { keepInView } from "./reviewClient";

export interface Choice { readonly id?: number; readonly target: string | null; readonly value: string;
                          readonly editor_email: string | null; readonly status: string }

/** What a match value says, in words. */
export function choiceWords(value: string, labels: ReadonlyMap<string, string> = new Map()): string {
  if (value === "none") return "not in the catalogue";
  if (value === "other-setting") return "a different setting";
  return labels.get(value) ?? value;
}

function labelsOf(item: HTMLElement): Map<string, string> {
  return new Map([...item.querySelectorAll<HTMLElement>("[data-value][data-label]")]
    .map((el) => [el.dataset["value"] ?? "", el.dataset["label"] ?? ""]));
}

export function markChosen(item: HTMLElement, value: string, by: string | null, queued: boolean,
                           undo: (() => void) | null = null): void {
  item.dataset["done"] = "chosen";
  for (const el of item.querySelectorAll(".review-actions, .match-actions")) el.setAttribute("hidden", "");
  const back = undo && !queued ? h("button", { type: "button", class: "link" }, "Undo") : null;
  back?.addEventListener("click", undo!);
  item.querySelector<HTMLElement>(".review-state")?.replaceChildren(
    h("strong", {}, `Chosen: ${choiceWords(value, labelsOf(item))}`),
    ` · by ${by ?? "an editor"}; ${queued ? "publishing now" : "goes with the next Publish on the Admin page"}. `, ...(back ? [back] : []));
}

/** Puts an item back as it was before its part was chosen. */
function unmark(item: HTMLElement): void {
  delete item.dataset["done"];
  for (const el of item.querySelectorAll(".review-actions, .match-actions")) el.removeAttribute("hidden");
  item.querySelector<HTMLElement>(".review-state")?.replaceChildren();
}

/** Takes a choice back before it is published (the row is withdrawn). */
export async function unchoose(item: HTMLElement, id: number, status: HTMLElement | null,
                               onChange: () => void = () => undefined): Promise<boolean> {
  const result = await api<{ ok: true }>(`/rows/${id}/unapprove`, {});
  if (!result.ok) {
    if (result.status === 401) signInAgain(status); else say(status, result.error, "error");
    return false;
  }
  unmark(item);
  say(status, `${item.querySelector("h3")?.textContent ?? "File"}: choice undone.`, "ok");
  onChange();
  item.querySelector<HTMLElement>("h3")?.focus();
  return true;
}

/** Marks the items already answered; returns how many. */
export function applyChoices(root: ParentNode, choices: readonly Choice[], status: HTMLElement | null = null,
                             onChange: () => void = () => undefined): number {
  let n = 0;
  for (const c of choices) {
    const item = [...root.querySelectorAll<HTMLElement>("[data-review-target]")]
      .find((el) => el.dataset["reviewTarget"] === c.target);
    if (item) {
      const id = c.id;
      markChosen(item, c.value, c.editor_email, c.status === "queued",
                 id ? () => void unchoose(item, id, status, onChange) : null);
      n++;
    }
  }
  return n;
}

export function wireMatches(root: HTMLElement, status: HTMLElement | null, onChange: () => void = () => undefined): void {
  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-choose]");
    const item = button?.closest<HTMLElement>("[data-review-target]");
    if (!button || !item) return;
    let value = button.dataset["choose"] ?? "";
    if (value === "typed") {
      const input = item.querySelector<HTMLInputElement>("input[data-typed]");
      value = input?.value.trim() ?? "";
      if (!value) {
        say(status, "Type the part it is, e.g. part:dominica-i-adventus/gradual.", "error");
        input?.focus();
        return;
      }
    }
    button.disabled = true;
    void api<{ ok: true; id: number }>("/edits", { target: item.dataset["reviewTarget"], field: "match", value }).then((result) => {
      button.disabled = false;
      if (!result.ok) {
        if (result.status === 401) signInAgain(status);
        else say(status, result.error, "error");
        return;
      }
      const id = result.data.id;
      // Read the words before marking: marking hides the buttons that carry them.
      const words = choiceWords(value, labelsOf(item));
      markChosen(item, value, "you", false, () => void unchoose(item, id, status, onChange));
      say(status, `${item.querySelector("h3")?.textContent ?? "File"}: ${words}.`, "ok");
      offerUndo(() => unchoose(item, id, status, onChange));
      keepInView(item, onChange);
      onChange();
    });
  });
}
