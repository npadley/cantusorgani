import type { ExportPart, PartCapabilities } from "./types";

export function capabilitiesFor(part: ExportPart): PartCapabilities {
  switch (part.kind) {
    case "mei":
      return { page: true, margins: true, staffSize: true, lyricsSize: true, spacing: true, linePolicy: true,
               maxSystems: true, manualBreaks: part.conversion.capabilities.manualBreaks, label: "Customizable typeset" };
    case "scan":
      return { page: true, margins: true, staffSize: false, lyricsSize: false, spacing: false, linePolicy: false,
               maxSystems: true, manualBreaks: false, label: "Original scan" };
    case "fixed":
      return { page: true, margins: true, staffSize: false, lyricsSize: false, spacing: false, linePolicy: false,
               maxSystems: false, manualBreaks: false, label: "Fixed typeset layout" };
  }
}
