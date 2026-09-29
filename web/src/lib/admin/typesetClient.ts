/**
 * The Typeset page's match buttons: **This part** (one of the candidates, or a
 * part the editor names), **Not in the catalogue** and **A different
 * setting**. Each is a `match` correction on typeset:<file>, approved at once
 * like any edit an editor makes, and published with the next batch. Items an
 * editor has already answered are marked from /admin/api/review-state.
 * Everything shown is built with DOM calls.
 */
import { api, h, say, signInAgain } from "./client";

export interface Choice { readonly target: string | null; readonly value: string; readonly editor_email: string | null;
                          readonly status: string }

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

export function markChosen(item: HTMLElement, value: string, by: string | null, queued: boolean): void {
  item.dataset["done"] = "chosen";
  for (const el of item.querySelectorAll(".review-actions, .match-actions")) el.setAttribute("hidden", "");
  item.querySelector<HTMLElement>(".review-state")?.replaceChildren(
    h("strong", {}, `Chosen: ${choiceWords(value, labelsOf(item))}`),
    ` · by ${by ?? "an editor"}; ${queued ? "publishing now" : "goes with the next Publish on the Corrections page"}.`);
}

/** Marks the items already answered; returns how many. */
export function applyChoices(root: ParentNode, choices: readonly Choice[]): number {
  let n = 0;
  for (const c of choices) {
    const item = [...root.querySelectorAll<HTMLElement>("[data-review-target]")]
      .find((el) => el.dataset["reviewTarget"] === c.target);
    if (item) {
      markChosen(item, c.value, c.editor_email, c.status === "queued");
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
    void api<{ ok: true }>("/edits", { target: item.dataset["reviewTarget"], field: "match", value }).then((result) => {
      button.disabled = false;
      if (!result.ok) {
        if (result.status === 401) signInAgain(status);
        else say(status, result.error, "error");
        return;
      }
      markChosen(item, value, "you", false);
      say(status, `${item.querySelector("h3")?.textContent ?? "File"}: ${choiceWords(value, labelsOf(item))}.`, "ok");
      onChange();
    });
  });
}
