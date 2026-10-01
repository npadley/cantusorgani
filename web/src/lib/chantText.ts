/** Build-time lyric text for search. Notation stays in the music viewer. */
import { jumpTargets } from "./catalog";
import type { Piece } from "./catalog";
import { chantEntry } from "./chants";
import { MANIFEST } from "./typeset";

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

export function gabcWords(gabc: string): string {
  const body = gabc.includes("%%") ? gabc.split("%%").slice(1).join("%%") : gabc;
  let text = body.replace(/<(?:(?:i|sp|alt))\b[^>]*>[\s\S]*?<\/(?:i|sp|alt)>/gi, " ")
    .replace(/\([^)]*\)/g, "")
    .replace(/[{}*_~]/g, "").replace(/(?:^|\s)\.(?=\s|$)/g, " ");
  // Removing nested markup can assemble another tag. Repeat until no tags
  // remain, then exclude stray delimiters from the extracted plain text.
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^<>]*>/g, "");
  } while (text !== previous);
  return normalize(text.replace(/[<>]/g, "")).replace(/^AL(?=le)/, "Al");
}

/** Preserve word breaks while joining hyphenated sung syllables. */
export function lyricWords(source: string): readonly string[] {
  const clean = source.replace(/%\{[\s\S]*?%\}/g, "").replace(/%[^\n]*/g, "");
  const out: string[] = [];
  for (const match of clean.matchAll(/\\lyricmode\s*\{/g)) {
    let depth = 1, end = match.index! + match[0].length;
    const start = end;
    while (end < clean.length && depth > 0) {
      if (clean[end] === "{") depth++;
      if (clean[end] === "}") depth--;
      end++;
    }
    if (depth !== 0) continue;
    out.push(normalize(clean.slice(start, end - 1).replace(/\s*--\s*/g, "")
      .replace(/\\set\s+stanza\s*=\s*"[^"]*"/g, "")
      .replace(/\\[a-zA-Z][\w-]*/g, "").replace(/[{}"_*]/g, " ")));
  }
  return out.filter(Boolean);
}

const sources = import.meta.glob<string>("../../../data/typeset/src/**/*.ly", { query: "?raw", import: "default", eager: true });
const typesetWords = new Map<string, readonly string[]>();
for (const part of MANIFEST.parts) {
  const source = sources[`../../../data/typeset/src/${part.file}`];
  if (source) typesetWords.set(part.target, lyricWords(source));
}

export function chantTexts(piece: Piece): readonly string[] {
  const words: string[] = [];
  for (const heading of jumpTargets(piece)) {
    const entry = chantEntry(heading.chantId);
    if (entry) words.push(gabcWords(entry.gabc));
    const target = heading.target ?? (heading.kind === "movement" ? `movement:${piece.slug}/${heading.anchor}` : `piece:${piece.slug}`);
    words.push(...(typesetWords.get(target) ?? []));
  }
  words.push(...(typesetWords.get(`piece:${piece.slug}`) ?? []));
  return [...new Set(words.filter(Boolean))];
}
