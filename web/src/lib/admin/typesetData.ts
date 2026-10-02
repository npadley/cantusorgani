/**
 * The typeset data the admin screen reads, built with the site: the manifest
 * (the parts shown typeset) and the review list (every other transcription),
 * both with the editors' earlier choices applied (pipeline/typeset/manifest.py),
 * and what stands reviewed. Kept apart from the queues so the corrections
 * target index can read it without the queues' pictures.
 */
import manifestJson from "../../../../data/typeset/manifest.json";
import reviewJson from "../../../../data/typeset/review.json";
import reviewedJson from "../../../../data/reviewed.json";
import type { Reviewed } from "./suspects";
import type { TargetTypeset } from "./targets";

export interface ReviewItem {
  readonly file: string;
  readonly status: string;
  readonly target: string | null;
  readonly source?: string;
  readonly hash?: string;
  readonly error?: string;
  readonly melody?: number | null;
  readonly incipit?: string;
  readonly page?: number;
  readonly note?: string;
  readonly candidates?: readonly { readonly target: string; readonly melody: number | null }[];
  /** A broken file's lines around the one LilyPond stopped at. */
  readonly excerpt?: { readonly first: number; readonly line: number; readonly lines: readonly string[] };
}
export interface ManifestPart { readonly target: string; readonly file: string; readonly hash: string }
export interface TypesetData {
  readonly prefix: string;
  readonly parts: readonly ManifestPart[];
  readonly items: readonly ReviewItem[];
}

export const TYPESET: TypesetData = {
  prefix: (manifestJson as { prefix: string }).prefix,
  parts: (manifestJson as { parts: readonly ManifestPart[] }).parts,
  items: (reviewJson as unknown as { items: readonly ReviewItem[] }).items,
};
export const REVIEWED = (reviewedJson as { reviewed: Reviewed }).reviewed;

/** Each file's current answer and whether it can be shown, for the admin API's checks. */
export function typesetTargets(data: TypesetData = TYPESET): Record<string, TargetTypeset> {
  const out: Record<string, TargetTypeset> = {};
  for (const part of data.parts) out[part.file] = { label: part.target, match: part.target, broken: null, hash: part.hash };
  for (const item of data.items) {
    out[item.file] = {
      label: item.incipit ?? item.file,
      match: item.status === "no-match" ? "none" : item.status === "other-setting" ? "other-setting" : "",
      ...(item.hash ? { hash: item.hash } : {}),
      broken: item.status === "broken" ? `LilyPond cannot draw it (${item.error ?? "an error"}).` : null,
    };
  }
  return out;
}
