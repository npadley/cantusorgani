import { describe, expect, it } from "vitest";
import { calendarAnnouncement, calendarDayHref } from "./calendarLinks";
import { dayHref } from "./indexes";

describe("calendar day links", () => {
  it("carries the chosen date for the day's own Proper", () => {
    expect(calendarDayHref({ key: "tempora:advent1", borrowed: false }, "2026-11-29"))
      .toBe(`${dayHref("tempora:advent1")}?date=2026-11-29`);
  });
  it("omits the date for borrowed music and undated links", () => {
    expect(calendarDayHref({ key: "tempora:advent1", borrowed: true }, "2026-11-30")).toBe(dayHref("tempora:advent1"));
    expect(calendarDayHref({ key: "tempora:advent1", borrowed: false })).toBe(dayHref("tempora:advent1"));
  });
});

describe("calendar announcements", () => {
  it("announces just the long date and first EF observance", () => {
    expect(calendarAnnouncement("2026-11-29", "First Sunday of Advent"))
      .toBe("Sunday, 29 November 2026: First Sunday of Advent.");
  });
  it("includes the OF Sunday cycle", () => {
    expect(calendarAnnouncement("2026-04-05", "Easter Sunday", "A"))
      .toBe("Sunday, 5 April 2026: Easter Sunday, Year A.");
  });
});
