import { describe, expect, it } from "vitest";
import { scrollToClearBar } from "./focusClearance";

describe("focusClearance", () => {
  it("does not scroll when the element ends above the bar", () => {
    expect(scrollToClearBar({ top: 300, bottom: 340 }, { top: 405, bottom: 600 })).toBe(0);
  });
  it("scrolls by the overlap plus the gap when the bar covers the element", () => {
    expect(scrollToClearBar({ top: 390, bottom: 455 }, { top: 405, bottom: 600 })).toBe(66);
  });
  it("scrolls an element that sits wholly under the bar", () => {
    expect(scrollToClearBar({ top: 500, bottom: 530 }, { top: 405, bottom: 600 })).toBe(141);
  });
});
