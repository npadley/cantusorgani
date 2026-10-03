import { createHash } from "node:crypto";
import auditJson from "../../../../data/typeset/melody-audit.json";
import proofreadSource from "../../../../pipeline/typeset/proofread.py?raw";
import proofNotesSource from "../../../../pipeline/typeset/proof_notes.py?raw";
import { allPieces, jumpTargets, type Piece } from "../catalog";
import { chantEntry } from "../chants";
import { REVIEWED, TYPESET } from "./typesetData";

export interface MelodyAuditPart { readonly file: string; readonly target: string; readonly hash: string }
export interface CurrentChant { readonly id: number | null; readonly gabcHash: string | null }
export interface MelodyAuditItem {
  readonly file: string; readonly target: string; readonly hash: string;
  readonly chant_id: number | null; readonly gabc_hash?: string | null; readonly status: string;
}
export interface MelodyAuditReport {
  readonly algorithm?: string; readonly algorithm_hash?: string; readonly items: readonly MelodyAuditItem[];
}
export interface MelodyAuditCounts {
  readonly remaining: number; readonly checked: number; readonly agreement: number;
  readonly attention: number; readonly noReference: number; readonly unchecked: number;
}

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** Count current manifest parts with independently produced melody evidence. */
export function melodyAuditCounts(
  parts: readonly MelodyAuditPart[], reviewed: Readonly<Record<string, { readonly was: string }>>,
  report: MelodyAuditReport, currentChants: ReadonlyMap<string, CurrentChant>, expectedAlgorithmHash?: string,
): MelodyAuditCounts {
  const remaining = parts.filter((part) => reviewed[`typeset:${part.file}`]?.was !== part.hash);
  const evidence = new Map(report.items.map((item) => [item.file, item]));
  let checked = 0;
  let agreement = 0;
  let attention = 0;
  let noReference = 0;
  const algorithmCurrent = (!report.algorithm || report.algorithm === "melody-audit-1")
    && (!expectedAlgorithmHash || report.algorithm_hash === expectedAlgorithmHash);
  if (!algorithmCurrent) {
    return { remaining: remaining.length, checked: 0, agreement: 0, attention: 0, noReference: 0, unchecked: remaining.length };
  }
  for (const part of remaining) {
    const item = evidence.get(part.file);
    const chant = currentChants.get(part.target);
    if (!item || !chant || item.target !== part.target || item.hash !== part.hash) continue;
    if (chant.gabcHash === null) {
      if (item.status !== "no-reference" || item.chant_id !== chant.id || item.gabc_hash != null) continue;
    } else {
      if (chant.id === null || item.chant_id !== chant.id || item.gabc_hash !== chant.gabcHash) continue;
    }
    checked++;
    if (item.status === "melody-agrees") agreement++;
    else if (item.status === "no-reference") noReference++;
    else attention++;
  }
  return { remaining: remaining.length, checked, agreement, attention, noReference, unchecked: remaining.length - checked };
}

function targetChant(target: string, pieces: readonly Piece[]): CurrentChant {
  const slug = /^(?:part|movement|piece):([a-z0-9-]+)/.exec(target)?.[1];
  const piece = slug ? pieces.find((p) => p.slug === slug) : undefined;
  if (!piece) return { id: null, gabcHash: null };
  let id: number | null = null;
  const movement = /^movement:[a-z0-9-]+\/([a-z]+)$/.exec(target)?.[1];
  if (movement) id = piece.chant.find((pairing) => pairing.movement === movement)?.id ?? null;
  else if (target.startsWith("piece:")) id = piece.chant[0]?.id ?? null;
  else {
    const part = piece.parts.find((p) => `part:${piece.slug}/${p.part}${p.variant ? `:${p.variant}` : ""}` === target);
    const movementId = part ? piece.chant.find((pairing) => pairing.movement === part.variant)?.id : undefined;
    id = part?.gregobaseId ?? movementId ?? jumpTargets(piece).find((row) => row.target === target)?.chantId ?? null;
  }
  const entry = chantEntry(id);
  return { id, gabcHash: entry ? sha256(entry.gabc) : null };
}

const report = auditJson as MelodyAuditReport;
const pieces = allPieces();
const current = new Map(TYPESET.parts.map((part) => [part.target, targetChant(part.target, pieces)]));
const algorithmHash = sha256(proofreadSource + proofNotesSource);

export const MELODY_AUDIT_COUNTS = melodyAuditCounts(TYPESET.parts, REVIEWED, report, current, algorithmHash);
