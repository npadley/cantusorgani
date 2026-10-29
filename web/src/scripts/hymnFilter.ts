export function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
    .toLowerCase().replace(/æ/g, "ae").replace(/œ/g, "oe")
    .replace(/\s+/g, " ").trim();
}

export function matches(query: string, text: string): boolean {
  const normalized = normalize(text);
  return normalize(query).split(" ").every((word) => normalized.includes(word));
}

export function summary(shown: number, total: number, query: string): string {
  const all = `${total} ${total === 1 ? "hymn" : "hymns"}`;
  return query.trim() ? `${shown} of ${all}` : all;
}

export function noMatchText(query: string): string {
  return `No hymns match ‘${query.trim()}’.`;
}

export function initHymnFilter(root: HTMLElement): void {
  const controls = root.querySelector<HTMLElement>("[data-hymn-filter]");
  const input = root.querySelector<HTMLInputElement>("#hymn-filter");
  const count = root.querySelector<HTMLElement>("[data-hymn-count]");
  const empty = root.querySelector<HTMLElement>("[data-hymn-empty]");
  const message = root.querySelector<HTMLElement>("[data-hymn-message]");
  const clear = root.querySelector<HTMLButtonElement>("[data-hymn-clear]");
  const items = [...root.querySelectorAll<HTMLLIElement>(".hymns li")];
  if (!controls || !input || !count || !empty || !message || !clear) return;

  function update(): void {
    if (!input || !count || !empty || !message) return;
    let shown = 0;
    for (const item of items) {
      item.hidden = !matches(input.value, item.dataset.filter ?? "");
      if (!item.hidden) shown++;
    }
    count.textContent = summary(shown, items.length, input.value);
    empty.hidden = shown !== 0;
    message.textContent = shown === 0 ? noMatchText(input.value) : "";
  }

  function reset(): void {
    if (!input) return;
    input.value = "";
    update();
    input.focus();
  }

  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.value) {
      event.preventDefault();
      reset();
    }
  });
  clear.addEventListener("click", reset);
  update();
  controls.hidden = false;
}
