/**
 * The systems a correction is about, as pictures: the part's first system and
 * the one proposed, a Vespers item's systems, a piece's first and last. Built
 * from /admin/scans.json (every catalogued system's image key and size, served
 * behind Access with the admin pages), so the editor judges a report against
 * the scan without leaving the queue.
 */
import { type TargetInfo, normalise } from "./targets";

export interface Scans {
  /** Where the images are published, without a trailing slash. */
  readonly base: string;
  /** Every catalogued system in catalogue order ("noh1/0044/002"). */
  readonly order: readonly string[];
  /** Each system's image key after the ref ("87d81bf27916"), "" when not sliced. */
  readonly hash: readonly string[];
  readonly aspect: readonly (readonly [number, number])[];
  /** Each piece's systems: [index of its first in `order`, how many]. */
  readonly pieces: Readonly<Record<string, readonly [number, number]>>;
  /** Where each of a piece's movements begins (an Ordinary's Kyrie, Gloria ...). */
  readonly movements: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface Shown {
  readonly ref: string;
  /** The image without its .webp suffix; null for a system the catalogue lacks. */
  readonly stem: string | null;
  readonly aspect: readonly [number, number] | null;
  readonly caption: string;
}

/** At most this many pictures per correction: enough to judge, not a page. */
export const MAX_SHOWN = 6;

function lookup(scans: Scans): Map<string, number> {
  const cached = indexes.get(scans);
  if (cached) return cached;
  const map = new Map<string, number>();
  scans.order.forEach((ref, i) => { if (!map.has(ref)) map.set(ref, i); });
  indexes.set(scans, map);
  return map;
}
const indexes = new WeakMap<Scans, Map<string, number>>();

/** One system as a picture, captioned. */
export function shown(scans: Scans, ref: string, caption: string): Shown {
  const i = lookup(scans).get(ref);
  if (i === undefined) return { ref, stem: null, aspect: null, caption: `${caption} (${ref}, not in the catalogue)` };
  const hash = scans.hash[i] ?? "";
  const aspect = scans.aspect[i] ?? null;
  return { ref, stem: hash ? `${scans.base}/systems/${ref}-${hash}` : `${scans.base}/${ref}`, aspect, caption: `${caption} (${ref})` };
}

/** A piece's systems, in order. */
export function pieceSystems(scans: Scans, slug: string): readonly string[] {
  const span = scans.pieces[slug];
  return span ? scans.order.slice(span[0], span[0] + span[1]) : [];
}

/**
 * The systems a correction names, now and as proposed: what the editor should
 * look at before accepting. `proposed` is the value as typed; a value that is
 * not yet valid shows only what is there now.
 */
export function namedSystems(scans: Scans, info: TargetInfo, field: string, proposed = ""): readonly Shown[] {
  const value = normalise(field, proposed, info.kind);
  const systems = info.slug ? pieceSystems(scans, info.slug) : [];
  const out: Shown[] = [];
  const add = (ref: string | undefined, caption: string): void => {
    if (ref && !out.some((s) => s.ref === ref && s.caption.startsWith(caption))) out.push(shown(scans, ref, caption));
  };
  if (info.kind === "vespers") {
    const now = (info.values["refs"] ?? "").split(" ").filter(Boolean);
    now.forEach((ref, i) => add(ref, `Printed on, ${i + 1} of ${now.length}`));
    if (field === "refs" && /^(noh8\/\d{4}\/\d{3} ?)+$/.test(value) && value !== info.values["refs"]) {
      const next = value.split(" ");
      next.forEach((ref, i) => add(ref, `Proposed, ${i + 1} of ${next.length}`));
    }
  } else if (info.kind === "part") {
    const start = Number(info.values["start_system"]);
    if (start > 0) add(systems[start - 1], `Starts now: system ${start}`);
    const n = Number(value);
    if (field === "start_system" && /^\d{1,3}$/.test(value) && n !== start && n >= 1 && n <= systems.length) {
      add(systems[n - 1], `Would start: system ${n}`);
    }
  } else if (info.kind === "pairing") {
    const movement = info.target.split("/").pop() ?? "";
    add(scans.movements[info.slug ?? ""]?.[movement] ?? systems[0], movement === "chant" ? "The piece" : "Where it begins");
  } else if (field === "printed_pages" || field === "system_range") {
    add(systems[0], "First system now");
    add(systems.at(-1), "Last system now");
    const range = /^(noh\d\/\d{4}\/\d{3})-(noh\d\/\d{4}\/\d{3})$/.exec(value);
    if (field === "system_range" && range && value !== info.values["system_range"]) {
      if (range[1] !== systems[0]) add(range[1], "Would be the first");
      if (range[2] !== systems.at(-1)) add(range[2], "Would be the last");
    }
  } else {
    add(systems[0], "First system");
  }
  return out.slice(0, MAX_SHOWN);
}
