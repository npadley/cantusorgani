import { describe, expect, it } from "vitest";
import { captionOf, glyphOf, handleLabel, kindOf, menuModel, navigate, nowText, statusAfter, thin } from "./exportBreaks";

describe("break kinds and labels", () => {
  it("should map effective breaks to kinds by origin", () => {
    expect(kindOf(undefined)).toBe("none");
    expect(kindOf({ boundaryId: "b1", kind: "page", origin: "user" })).toBe("page");
    expect(kindOf({ boundaryId: "b1", kind: "system", origin: "user" })).toBe("system");
    expect(kindOf({ boundaryId: "b1", kind: "system", origin: "source" })).toBe("orig");
    expect(kindOf({ boundaryId: "b1", kind: "system", origin: "automatic" })).toBe("auto");
    expect(["none", "system", "page", "orig", "auto"].map((k) => nowText(k as never))).toEqual(["no break", "your new system", "your new page", "original line break", "automatic line break"]);
    expect(glyphOf("page")).toBe("⤓");
    expect(glyphOf("system")).toBe("↵");
    expect(glyphOf("none")).toBe("");
  });

  it("should build the spec's handle label from afterText", () => {
    expect(handleLabel({ index: 3, total: 23, part: "Kyrie", afterText: "eléison", page: 1, kind: "none" }))
      .toBe("Break point 4 of 23 in Kyrie, after 'eléison', page 1. Now: no break.");
    expect(handleLabel({ index: 0, total: 2, part: "Kyrie", afterText: null, page: 2, kind: "page" })).toContain("after this point, page 2. Now: your new page.");
    expect(captionOf("Ky")).toBe("after 'Ky'");
  });

  it("should give the action panel the spec's exact wording and disable the current action", () => {
    const none = menuModel({ index: 3, total: 23, afterText: "eléison", kind: "none" });
    expect(none.title).toBe('After "eléison" · break point 4 of 23');
    expect(none.now).toBe("Now: no break");
    expect(none.system).toEqual({ label: "Start new system here", disabled: false });
    expect(none.page).toEqual({ label: "Start new page here", disabled: false });
    expect(none.remove).toBe(false);
    const page = menuModel({ index: 3, total: 23, afterText: "eléison", kind: "page" });
    expect(page.page).toEqual({ label: "Start new page here (current)", disabled: true });
    expect(page.remove).toBe(true);
    const sys = menuModel({ index: 0, total: 2, afterText: "Ky", kind: "system" });
    expect(sys.system).toEqual({ label: "Start new system here (current)", disabled: true });
    const orig = menuModel({ index: 1, total: 2, afterText: "Ky", kind: "orig" });
    expect(orig.system).toBeNull();
    expect(orig.originalNote).toBe("Original line break. To remove it, choose Line breaks: Fit to page.");
    expect(orig.remove).toBe(false);
  });

  it("should announce each action with Undo", () => {
    expect(statusAfter("page", "eléison")).toBe("New page starts after 'eléison'. Undo is available.");
    expect(statusAfter("system", "Ky")).toBe("New system starts after 'Ky'. Undo is available.");
    expect(statusAfter("remove", null)).toBe("Break removed after this point. Undo is available.");
  });
});

describe("thinning and roving focus", () => {
  it("should keep every handle that is at least 44 px from the last kept one, per row", () => {
    const row = (xs: number[], r = "a") => xs.map((x) => ({ row: r, x }));
    expect(thin(row([0, 100, 200]))).toEqual([true, true, true]);
    expect(thin(row([0, 20, 44, 60, 90]))).toEqual([true, false, true, false, true]);
    expect(thin([...row([0, 10], "a"), ...row([5, 6], "b")])).toEqual([true, false, true, false]);
    // input order is preserved even when a row is unsorted
    expect(thin(row([90, 0, 20]))).toEqual([true, true, false]);
  });

  it("should move with arrows, Home and End and clamp at the ends", () => {
    expect(navigate(2, "ArrowRight", 5)).toBe(3);
    expect(navigate(2, "ArrowLeft", 5)).toBe(1);
    expect(navigate(0, "ArrowLeft", 5)).toBe(0);
    expect(navigate(4, "ArrowRight", 5)).toBe(4);
    expect(navigate(2, "Home", 5)).toBe(0);
    expect(navigate(2, "End", 5)).toBe(4);
    expect(navigate(0, "End", 0)).toBe(-1);
  });
});
