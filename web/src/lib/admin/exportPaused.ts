import { TYPESET, type ManifestPart } from "./typesetData";

/**
 * Pieces whose custom export is paused: an approved MEI conversion exists, but it no longer matches
 * what the site publishes, so the Customize button is hidden until the conversion is re-reviewed
 * (or its approval is carried forward: `noh typeset-mei-carry`). Built with the site, read-only.
 *
 * The render hash check needs only the committed records and data/typeset/manifest.json. The other
 * inputs (include files, converter code, tool versions) are checked by `noh typeset-mei-stale`; when
 * its JSON report is present at build time (build/mei/stale/stale.json) its reasons are added.
 */
export interface MeiRecordSummary {
  readonly source_path: string;
  readonly target: string | null;
  readonly render_hash: string | null;
  readonly state: string;
}
export interface StaleReport {
  readonly checked: number;
  readonly stale: readonly { readonly sourcePath: string; readonly reasons: readonly { readonly reason: string }[] }[];
}
export interface PausedExport {
  readonly target: string;
  readonly sourcePath: string;
  readonly reasons: readonly string[];
  readonly recordedRenderHash: string | null;
  /** The render hash the site publishes for the target now, or null when it no longer matches a part. */
  readonly currentRenderHash: string | null;
}

const RENDER_HASH_MOVED = "The chant source or an include file changed (render hash moved).";
const REASON_TEXT: Readonly<Record<string, string>> = {
  source: "The chant source changed.",
  include: "An include file this piece loads changed.",
  converter: "The MEI converter code changed.",
  extractor: "The LilyPond extractor changed.",
  profile: "The conversion profile changed.",
  schema: "The MEI schema changed.",
  lilypond: "The pinned LilyPond version changed.",
  verovio: "The Verovio version changed.",
  font: "The export fonts changed.",
  approval: "The signed approval no longer matches the record's inputs.",
};

function reportReasons(report: StaleReport | null, sourcePath: string): string[] {
  const entries = Array.isArray(report?.stale) ? report.stale : [];
  const reasons = new Set<string>();
  for (const entry of entries) {
    if (entry.sourcePath !== sourcePath) continue;
    for (const { reason } of entry.reasons) {
      if (reason === "render_hash") continue; // the matched parts say this themselves
      reasons.add(REASON_TEXT[reason] ?? `Input changed: ${reason}.`);
    }
  }
  return [...reasons];
}

export function pausedExports(
  records: readonly MeiRecordSummary[],
  matched: readonly Pick<ManifestPart, "target" | "hash">[],
  report: StaleReport | null,
): PausedExport[] {
  const paused: PausedExport[] = [];
  for (const record of records) {
    if (record.state !== "approved" || record.target === null) continue;
    const hashes = matched.filter((part) => part.target === record.target).map((part) => part.hash);
    const reasons: string[] = [];
    if (hashes.length === 0) reasons.push("The target is no longer matched to a typeset file.");
    else if (record.render_hash === null || !hashes.includes(record.render_hash)) reasons.push(RENDER_HASH_MOVED);
    reasons.push(...reportReasons(report, record.source_path));
    if (reasons.length === 0) continue;
    paused.push({
      target: record.target, sourcePath: record.source_path, reasons,
      recordedRenderHash: record.render_hash, currentRenderHash: hashes[0] ?? null,
    });
  }
  return paused.sort((a, b) => a.target.localeCompare(b.target));
}

const recordModules = import.meta.glob<MeiRecordSummary>("../../../../data/typeset/mei/records/*.json", {
  eager: true, import: "default",
});
const reportModules = import.meta.glob<StaleReport>("../../../../build/mei/stale/stale.json", {
  eager: true, import: "default",
});

export const MEI_RECORDS: readonly MeiRecordSummary[] = Object.values(recordModules);

export const EXPORT_PAUSED: readonly PausedExport[] = pausedExports(
  MEI_RECORDS,
  TYPESET.parts,
  Object.values(reportModules)[0] ?? null,
);
