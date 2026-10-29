import { dayHref } from "./indexes";

/** Borrowed Propers belong to the lender's occasion, not the selected date. */
export function calendarDayHref(source: { readonly key: string; readonly borrowed: boolean }, iso?: string): string {
  const href = dayHref(source.key);
  return iso && !source.borrowed ? `${href}?date=${iso}` : href;
}

export const CALENDAR_MARKERS: Readonly<Record<string, string>> = {
  w: "white", r: "red", v: "violet", g: "green", b: "black", p: "rose",
};

export function calendarAnnouncement(iso: string, title: string, cycle?: "A" | "B" | "C"): string {
  const date = new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  return `${date}: ${title.replace(/[.!?]+$/, "")}${cycle ? `, Year ${cycle}` : ""}.`;
}
