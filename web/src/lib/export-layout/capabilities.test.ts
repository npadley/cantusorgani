import { describe, expect, it } from "vitest";
import { capabilitiesFor } from "./capabilities";
import type { ApprovedConversion, ExportPart } from "./types";

const base = { id: "s:0", label: "L", heading: null, sourceSystemCount: 1, sourceRevision: "r" };
const conversion = (manualBreaks: boolean): ApprovedConversion => ({
  digest: "d", meiUrl: "u", meiSha256: "h", sourceRevision: "r", profile: "p", verovio: "v", boundaries: [], capabilities: { manualBreaks },
});
const mei = (manualBreaks: boolean): ExportPart => ({ ...base, kind: "mei", target: "t", renderHash: "r", conversion: conversion(manualBreaks) });

describe("capabilitiesFor", () => {
  it("should enable everything for mei, with manual breaks from the conversion", () => {
    expect(capabilitiesFor(mei(true))).toEqual({ page: true, margins: true, staffSize: true, lyricsSize: true, spacing: true,
      linePolicy: true, maxSystems: true, manualBreaks: true, label: "Customizable typeset" });
    expect(capabilitiesFor(mei(false)).manualBreaks).toBe(false);
  });

  it("should allow only page, margins and max systems for scans", () => {
    expect(capabilitiesFor({ ...base, kind: "scan", stems: ["a"], customizableAvailable: false })).toEqual({
      page: true, margins: true, staffSize: false, lyricsSize: false, spacing: false, linePolicy: false,
      maxSystems: true, manualBreaks: false, label: "Original scan" });
  });

  it("should allow only page and margins for fixed", () => {
    expect(capabilitiesFor({ ...base, kind: "fixed", target: "t", renderHash: "r", letterPdf: "l", a4Pdf: "a" })).toEqual({
      page: true, margins: true, staffSize: false, lyricsSize: false, spacing: false, linePolicy: false,
      maxSystems: false, manualBreaks: false, label: "Fixed typeset layout" });
  });
});
