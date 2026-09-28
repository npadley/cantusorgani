import { readFileSync } from "node:fs";

import type { Targets } from "../src/lib/admin/targets";

/**
 * What the built site says now, so the browser tests follow the data: a
 * correction published to Dominica I Adventus must not break them.
 */
export const targets = JSON.parse(readFileSync(new URL("../dist/corrections/targets.json", import.meta.url), "utf8")) as Targets;

/** A piece's printed parts, by name, with the systems they start on (from 1). */
export function starts(slug: string): { readonly systems: number; readonly [part: string]: number } {
  const piece = targets.pieces[slug];
  if (!piece) throw new Error(`${slug} is not in dist/corrections/targets.json; run pnpm build`);
  const out: Record<string, number> = { systems: piece.systems ?? 0 };
  for (const p of piece.parts ?? []) if (p.system !== null && !p.variant) out[p.part] = p.system;
  return out as { readonly systems: number; readonly [part: string]: number };
}
