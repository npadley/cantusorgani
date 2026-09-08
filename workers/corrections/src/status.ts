/**
 * Public status rows.
 *
 * The status page is public, so submitted text becomes content on the site. The
 * defence is structural, not cosmetic: only enumerated or pattern-checked fields
 * are ever published, and the submitter's free-text note is never among them.
 * Spam then has nowhere to render.
 *
 * Every row is revalidated on the way OUT. A row written before a schema
 * tightening is still in the table, and "we validated it on input" is not a
 * property of the data — only of the code that happened to be running that day.
 */

import { parseCorrection } from "./schema";

export const STATUSES = ["pending", "accepted", "rejected"] as const;
export type Status = (typeof STATUSES)[number];

const ISO_LIKE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}:\d{2})?Z?$/;

export interface StoredRow {
  readonly id: number;
  readonly piece_id: string;
  readonly field: string;
  readonly proposed: string;
  readonly note: string;
  readonly status: string;
  readonly created_at: string;
}

export interface PublicRow {
  readonly id: number;
  readonly pieceId: string;
  readonly field: string;
  readonly proposedValue: string;
  readonly status: Status;
  readonly createdAt: string;
}

function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value);
}

export function toPublicRow(row: StoredRow): PublicRow | null {
  const check = parseCorrection({
    pieceId: row.piece_id,
    field: row.field,
    proposedValue: row.proposed,
  });
  if (!check.ok) return null;
  if (!isStatus(row.status)) return null;
  if (!ISO_LIKE.test(row.created_at)) return null;

  // Emit the values that were validated, never the raw stored strings: if
  // parseCorrection ever normalises, the published value must not diverge from
  // the one that passed the check.
  return {
    id: row.id,
    pieceId: check.value.pieceId,
    field: check.value.field,
    proposedValue: check.value.proposedValue,
    status: row.status,
    createdAt: row.created_at,
  };
}

export function toPublicRows(rows: readonly StoredRow[]): readonly PublicRow[] {
  return rows.map(toPublicRow).filter((r): r is PublicRow => r !== null);
}
