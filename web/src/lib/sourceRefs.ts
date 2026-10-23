/** Parsed scan address. Callers check actual systems and adapter page bounds. */
export interface SourceRef {
  readonly volume: string;
  readonly pdf_page: number;
  readonly index: number;
}

const REF = "([a-z][a-z0-9-]{0,63})/([0-9]{4})/([0-9]{3})";
const REF_PATTERN = new RegExp(`^${REF}$`, "u");
const RANGE_PATTERN = new RegExp(`^(${REF})-(${REF})$`, "u");

/** Parse a registered ref without trimming input; throws on syntax/membership errors. */
export function parseRef(text: string, knownSources: ReadonlySet<string>): SourceRef {
  const match = REF_PATTERN.exec(text);
  // JavaScript's $ may match before a final newline; require the whole input.
  if (!match || match[0] !== text) throw new Error(`Invalid source ref: ${JSON.stringify(text)}`);
  const volume = match[1]!;
  if (!knownSources.has(volume)) throw new Error(`Unknown source key: ${volume}`);
  return { volume, pdf_page: Number(match[2]), index: Number(match[3]) };
}

/** Inclusive parsed endpoints; equal refs are valid. Source keys may contain hyphens. */
export function parseRange(
  text: string,
  knownSources: ReadonlySet<string>,
): readonly [SourceRef, SourceRef] {
  const match = RANGE_PATTERN.exec(text);
  if (!match || match[0] !== text) throw new Error(`Invalid source range: ${JSON.stringify(text)}`);
  const first = parseRef(match[1]!, knownSources);
  const last = parseRef(match[5]!, knownSources);
  if (first.volume !== last.volume) throw new Error(`Source range runs across two sources: ${text}`);
  if (first.pdf_page > last.pdf_page || (first.pdf_page === last.pdf_page && first.index > last.index)) {
    throw new Error(`Source range runs backwards: ${text}`);
  }
  return [first, last];
}
