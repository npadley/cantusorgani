/**
 * The Review page's buttons (and "Parts to check"'s): **Looks right**, **Skip**
 * with a note, and taking a skip back. Items are drawn with the site; this marks
 * the ones an editor has already acted on (/admin/api/review-state) and sends
 * new actions to the admin API. Everything shown is built with DOM calls.
 *
 * Each item is an element with `data-review-target` and `data-review-seen` (its
 * fingerprint), holding a `.review-actions` group and a `.review-state` line.
 */
import { api, h, say, signInAgain } from "./client";

interface State {
  readonly reviews: readonly { id: number; target: string; status: string; editor_email: string | null }[];
  readonly skips: readonly { target: string; note: string; editor_email: string; at: string }[];
}

function items(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("[data-review-target]")];
}

function stateLine(item: HTMLElement): HTMLElement | null {
  return item.querySelector<HTMLElement>(".review-state");
}

/** What the buttons' outcomes are called: the Review page's words by default. */
export interface Words {
  /** A review recorded ("Looks right", "Proofread"). */
  readonly reviewed: string;
  /** Said when a review is recorded: "<item>: marked as looking right." */
  readonly marked: string;
  /** A skip recorded ("Skipped", "Problem"). */
  readonly skipped: string;
  /** A skip, as a noun ("skip", "problem note"). */
  readonly skip: string;
  /** The question a skip's note answers. */
  readonly why: string;
  /** Said when a skip is saved. */
  readonly saved: string;
}
export const REVIEW_WORDS: Words = {
  reviewed: "Looks right", marked: "marked as looking right", skipped: "Skipped", skip: "skip",
  why: "Why skip it? (for the next editor)", saved: "Skipped, with your note.",
};

/** An item reviewed and waiting to be published: its buttons go. */
function markReviewed(item: HTMLElement, by: string | null, queued: boolean, words: Words = REVIEW_WORDS): void {
  item.dataset["done"] = "reviewed";
  item.querySelector(".review-actions")?.setAttribute("hidden", "");
  stateLine(item)?.replaceChildren(h("strong", {}, words.reviewed),
    ` · marked by ${by ?? "an editor"}; ${queued ? "publishing now" : "goes with the next Publish on the Corrections page"}.`);
}

function markSkipped(item: HTMLElement, note: string, by: string, onUnskip: () => void, words: Words = REVIEW_WORDS): void {
  item.dataset["done"] = "skipped";
  const undo = h("button", { type: "button", class: "link" }, `Take back the ${words.skip}`);
  undo.addEventListener("click", onUnskip);
  stateLine(item)?.replaceChildren(h("strong", {}, words.skipped), ` by ${by}: “${note}” `, undo);
}

function clearState(item: HTMLElement): void {
  delete item.dataset["done"];
  item.querySelector(".review-actions")?.removeAttribute("hidden");
  stateLine(item)?.replaceChildren();
}

/** Focus the next item still to do, so a run of reviews needs no mouse. */
function focusNext(root: ParentNode, from: HTMLElement): void {
  const all = items(root);
  const after = all.slice(all.indexOf(from) + 1);
  const next = after.find((el) => !el.hidden && !el.dataset["done"] && el.closest("[hidden]") === null);
  next?.querySelector<HTMLElement>("h3")?.focus();
}

export async function wireReviews(root: HTMLElement, status: HTMLElement | null,
                                  onChange: () => void = () => undefined, words: Words = REVIEW_WORDS,
                                  onState: (state: unknown) => void = () => undefined): Promise<void> {
  const fail = (result: { status: number; error: string }): void => {
    if (result.status === 401) signInAgain(status);
    else say(status, result.error, "error");
  };
  const byTarget = new Map(items(root).map((el) => [el.dataset["reviewTarget"] ?? "", el]));

  async function unskip(item: HTMLElement): Promise<void> {
    const result = await api<{ ok: true }>("/skips/remove", { target: item.dataset["reviewTarget"] });
    if (!result.ok) return fail(result);
    clearState(item);
    say(status, `${words.skip[0]?.toUpperCase() ?? ""}${words.skip.slice(1)} taken back.`, "ok");
    onChange();
  }

  const state = await api<State>("/review-state");
  if (!state.ok) {
    fail(state);
  } else {
    for (const r of state.data.reviews) {
      const item = byTarget.get(r.target);
      if (item) markReviewed(item, r.editor_email, r.status === "queued", words);
    }
    for (const s of state.data.skips) {
      const item = byTarget.get(s.target);
      if (item && !item.dataset["done"]) markSkipped(item, s.note, s.editor_email, () => void unskip(item), words);
    }
    onState(state.data);
    onChange();
  }

  root.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-act]");
    const item = button?.closest<HTMLElement>("[data-review-target]");
    if (!button || !item) return;
    const target = item.dataset["reviewTarget"] ?? "";
    if (button.dataset["act"] === "looks-right") {
      button.disabled = true;
      void api<{ ok: true }>("/reviews", { target, seen: item.dataset["reviewSeen"] ?? "" }).then((result) => {
        button.disabled = false;
        if (!result.ok) return fail(result);
        markReviewed(item, "you", false, words);
        say(status, `${item.querySelector("h3")?.textContent ?? "Item"}: ${words.marked}.`, "ok");
        onChange();
        focusNext(root, item);
      });
    }
    if (button.dataset["act"] === "skip") {
      const id = `skip-${Math.random().toString(36).slice(2, 8)}`;
      const note = h("input", { type: "text", id, maxlength: "300", autocomplete: "off" }) as HTMLInputElement;
      const save = h("button", { type: "button" }, `Save the ${words.skip}`);
      const form = h("div", { class: "reason" }, h("label", { for: id }, words.why), note, save);
      stateLine(item)?.replaceChildren(form);
      note.focus();
      const submit = (): void => {
        const text = note.value.trim();
        if (!text) {
          say(status, "Say briefly why it is skipped, for the next editor.", "error");
          note.focus();
          return;
        }
        save.setAttribute("disabled", "");
        void api<{ ok: true }>("/skips", { target, note: text }).then((result) => {
          save.removeAttribute("disabled");
          if (!result.ok) return fail(result);
          markSkipped(item, text, "you", () => void unskip(item), words);
          say(status, words.saved, "ok");
          onChange();
          focusNext(root, item);
        });
      };
      save.addEventListener("click", submit);
      note.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    }
  });
}
