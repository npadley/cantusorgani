import raw from "../../../data/corrections-log.json";

import { buildTargets } from "./admin/targetIndex";
import { FIELD_LABELS, describeTarget, sectionsSummary } from "./admin/targets";

/**
 * The public corrections log, from data/corrections-log.json (written by
 * `noh apply-corrections` from data/corrections.yml): what was corrected, from
 * what to what, and when. It never holds an address or a note.
 */
export interface LogEntry {
  readonly id: string;
  readonly target: string;
  readonly field: string;
  readonly was: string;
  readonly value: string;
  readonly date: string;
  readonly by: "reader" | "editor";
  /** What the target is, in words, and where it is on the site. */
  readonly label: string;
  readonly href: string | null;
  readonly fieldLabel: string;
}

function text(value: unknown, field: string): string {
  if (field === "sections") return sectionsSummary(value);
  if (value === null || value === undefined || value === "") return field === "chant" ? "none" : "(none)";
  return Array.isArray(value) ? value.join("–") : String(value);
}

export function parseLog(input: unknown): readonly LogEntry[] {
  const doc = (input ?? {}) as { schema_version?: number; corrections?: unknown };
  if (doc.schema_version !== 1) throw new Error(`corrections log schema_version ${String(doc.schema_version)}, expected 1`);
  const rows = Array.isArray(doc.corrections) ? (doc.corrections as Record<string, unknown>[]) : [];
  const targets = buildTargets();
  return rows.map((r) => {
    const target = String(r["target"] ?? "");
    const field = String(r["field"] ?? "");
    const info = describeTarget(targets, target);
    return {
      id: String(r["id"] ?? ""), target, field, was: text(r["was"], field), value: text(r["value"], field),
      date: String(r["date"] ?? ""), by: r["by"] === "reader" ? "reader" : "editor",
      label: info?.label ?? target, href: info?.href ?? null, fieldLabel: FIELD_LABELS[field] ?? field,
    };
  });
}

export function correctionsLog(): readonly LogEntry[] {
  return parseLog(raw);
}
