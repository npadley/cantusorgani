/** The local hint only decides whether to ask; /me decides what to reveal. */
export async function checkEditorLinks(): Promise<void> {
  try {
    if (localStorage.getItem("editor") !== "1") return;
  } catch { return; }

  try {
    const response = await fetch("/admin/api/me", { redirect: "manual", cache: "no-store" });
    if (response.type !== "opaqueredirect" && response.status === 200
        && (response.headers.get("content-type") ?? "").includes("application/json")) {
      const data: unknown = await response.json();
      if (typeof data === "object" && data !== null && "email" in data
          && typeof data.email === "string" && data.email.trim() !== "") {
        document.querySelectorAll<HTMLElement>("[data-editor-only]").forEach(link => { link.hidden = false; });
        return;
      }
    }
  } catch { /* A failed check leaves Edit hidden. */ }
  try { localStorage.removeItem("editor"); } catch { /* storage unavailable */ }
}
