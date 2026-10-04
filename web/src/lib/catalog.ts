import raw from "../../../data/catalog.json";
import reviewedHymnLinks from "../../../data/vespers/hymn-links.json";
import { hymnChantId } from "./hymnpairings";

/** Genre of a catalogued piece. Mirrors the pipeline's controlled set. */
export type Genre =
  | "asperges" | "mass_ordinary" | "credo" | "tonus" | "kyrie" | "gloria"
  | "sanctus" | "agnus" | "requiem" | "absolutio" | "exsequiis" | "proper"
  | "hymn" | "sequence" | "antiphon" | "responsory" | "litany" | "psalm" | "canticle" | "versicle";

/** Confidence of the NOH piece -> GregoBase chant match. */
export type PairStatus = "verified" | "unverified" | "unpaired";

/**
 * Confidence of the catalog record itself. A distinct axis from PairStatus: a
 * piece can have a verified chant pairing and an unverified title. The two
 * vocabularies must never be collapsed in the UI.
 */
export type RecordStatus = "verified" | "unmatched" | "review";

export type Movement = "kyrie" | "gloria" | "credo" | "sanctus" | "agnus" | "ite";

export interface ChantPairing {
  readonly source: "gregobase";
  readonly id: number;
  readonly movement: Movement | null;
  readonly incipit: string;
  readonly mode: string | null;
  readonly score: number;
  readonly status: PairStatus;
}

export interface MovementBoundary {
  readonly movement: Movement;
  readonly score: number;
  readonly pdfPage: number;
  readonly system: number;
  readonly ref: string;
  readonly modeMarker: string | null;
}

/** A section's kind: a part of the Mass, a hymn printed within it (the Ember
 * Saturday's *Benedictus es*), or another section (a blessing, a procession). */
export type ProperPartName =
  | "introit" | "gradual" | "alleluia" | "tract" | "sequence" | "hymn" | "offertory" | "communion" | "other";

/** Verified printed liturgical instructions attached to a section. */
export interface SectionRubric {
  /** Verified printed instruction in Latin, and its English translation. */
  readonly rubric?: string;
  readonly rubricTranslation?: string;
}

/** A section of a Proper printed in this piece (the catalogue's `sections`): where it starts. */
export interface PrintedPart extends SectionRubric {
  /** Original correction target and citation for an inline borrowed section. */
  readonly sourceTarget?: string;
  readonly source?: string;
  readonly kind: "printed";
  readonly part: ProperPartName;
  /** "" | "paschal" | "1", "2" … when a kind repeats (the Ember Saturday's four
   *  Graduals) | a key of its own ("kyrie-b"): what follows the kind in its name. */
  readonly variant: string;
  /** As the book prints it in the margin ("2. Grad. I"), where known. */
  readonly label: string | null;
  /** Its opening words ("In sole posuit"), where known. */
  readonly title: string | null;
  readonly system: number;
  readonly ref: string;
  readonly gregobaseId: number | null;
  /** How the start was found. "order" is a guess the site does not show;
   *  "inferred": the one start the page allows; "hand" is a correction
   *  (data/corrections.yml); "reviewed": a list a person checked. */
  readonly placed: "label" | "text" | "mode" | "order" | "inferred" | "hand" | "reviewed";
}

/** A part the book prints elsewhere ("Introitus. Benedicite, ut supra, p. 354"). */
export interface BorrowedPart extends SectionRubric {
  readonly kind: "borrowed";
  readonly part: ProperPartName;
  readonly variant: string;
  readonly label: string | null;
  readonly title: string | null;
  /** The lending piece and the system its part starts on; null when unresolved. */
  readonly borrowedFrom: string | null;
  readonly borrowedRef: string | null;
  /** The volume it is printed in ("noh4"), and its printed page there. */
  readonly borrowedVolume: string | null;
  readonly borrowedPage: number;
  readonly gregobaseId: number | null;
}

export type ProperPart = PrintedPart | BorrowedPart;

export interface Hymn {
  readonly title: string;
  readonly ref: string;
  readonly printedPage: number;
}

export interface Piece {
  readonly sourceNote?: string | null;
  readonly referenceSources?: { volume: string; page: number; label: string; omit?: readonly string[] }[];
  readonly excludedParts?: readonly string[];
  /** Original system positions in a composed view, for typeset/export switches. */
  readonly systemSources?: readonly { readonly slug: string; readonly index: number }[];
  readonly id: string;
  readonly volume: string;
  readonly slug: string;
  readonly section: string;
  /** Which index the piece appears under: kyriale, temporale, sanctorale, … */
  readonly division: string;
  /** 1962 calendar keys this piece serves, e.g. "tempora:Adv1-0". */
  readonly days: readonly string[];
  readonly label: string;
  readonly title: string;
  readonly incipit: string | null;
  /** Parts printed elsewhere, as the book cites them ("Introitus. Vultum tuum, Pars IV, p. 115."). */
  readonly reference: string | null;
  /** Days this piece serves because another entry cites it, not by its own heading. */
  readonly linkedDays: readonly string[];
  /** Hymns printed inside this piece (a Vespers office), where each begins. */
  readonly hymns: readonly Hymn[];
  readonly genre: Genre;
  readonly mode: string | null;
  readonly mass: string | null;
  readonly printedPages: readonly [number, number];
  /** The addendum a piece is printed in, whose pages are numbered on their own
   *  ("Addenda ad Partem III"); null for the body of the volume. */
  readonly pagination: string | null;
  readonly pdfPages: readonly [number, number];
  readonly systems: readonly string[];
  /** Published asset key per system, without its variant suffix. Empty when the
   *  page has not been sliced, in which case the local path is used. */
  readonly systemAssets: readonly string[];
  readonly systemAspect: readonly (readonly [number, number])[];
  readonly movements: readonly MovementBoundary[];
  /** A Proper's parts, in printed order; empty for everything else. */
  readonly parts: readonly ProperPart[];
  /** The whole Proper in chant on jgabc, when jgabc has it. */
  readonly jgabcUrl: string | null;
  readonly chant: readonly ChantPairing[];
  readonly status: RecordStatus;
}

export interface ChantSource {
  readonly name: string;
  readonly url: string;
  readonly licence: string;
  readonly note: string;
}

/** A source volume, and how its printed pages map to PDF pages. */
export interface VolumeInfo {
  readonly title: string;
  readonly part: string;
}

export interface Catalog {
  readonly schemaVersion: number;
  readonly volumes: Readonly<Record<string, VolumeInfo>>;
  readonly chantSource: ChantSource | null;
  readonly pieces: readonly Piece[];
}

export const SCHEMA_VERSION = 3;
/** Schema 2 named a Proper's sections `parts`; read for one release. */
const OLDER_SCHEMA = 2;

/** Liturgical order, not catalog order. Never sort movements alphabetically. */
export const MOVEMENT_ORDER: readonly Movement[] = [
  "kyrie", "gloria", "credo", "sanctus", "agnus", "ite",
];

const GENRES: ReadonlySet<string> = new Set<Genre>([
  "asperges", "mass_ordinary", "credo", "tonus", "kyrie", "gloria",
  "sanctus", "agnus", "requiem", "absolutio", "exsequiis", "proper",
  "hymn", "sequence", "antiphon", "responsory", "litany", "psalm", "canticle", "versicle",
]);

const RECORD_STATUSES: ReadonlySet<string> = new Set<RecordStatus>([
  "verified", "unmatched", "review",
]);

// The pipeline emits snake_case; the site speaks camelCase. Map explicitly and
// fail the build on drift. A double cast (`raw as unknown as Catalog`) would
// compile and then ship `undefined` to every template.
interface RawChant {
  readonly source: string; readonly id: number; readonly movement: string | null;
  readonly incipit: string; readonly mode: string | null;
  readonly score: number; readonly status: string;
}

interface RawMovement {
  readonly movement: string; readonly score: number; readonly pdf_page: number;
  readonly system: number; readonly ref: string; readonly mode_marker: string | null;
}

/** A section as the catalogue writes it (schema 3): its kind, and `n` for the
 * 2nd (3rd ...) of its kind. Schema 2's parts had `part`, with the number in
 * `variant`. */
interface RawPart {
  readonly kind?: string; readonly n?: number; readonly key?: string;
  readonly part?: string; readonly variant?: string;
  readonly label?: string | null; readonly title?: string | null;
  readonly rubric?: string; readonly rubric_translation?: string;
  readonly system?: number; readonly ref?: string;
  readonly gregobase_id?: number | null; readonly placed?: string;
  readonly borrowed_from?: string | null; readonly borrowed_ref?: string | null;
  readonly borrowed_page?: number; readonly borrowed_volume?: string | null;
}

interface RawPiece {
  readonly source_note?: string;
  readonly reference_sources?: { volume: string; page: number; label: string; omit?: readonly string[] }[];
  readonly id: string; readonly volume: string; readonly slug: string;
  readonly section: string; readonly label: string; readonly title: string;
  readonly division?: string; readonly days?: readonly string[];
  readonly incipit: string | null; readonly genre: string;
  readonly reference?: string | null; readonly linked_days?: readonly string[];
  readonly hymns?: readonly { readonly title: string; readonly ref: string; readonly printed_page: number }[];
  readonly mode: string | null; readonly mass: string | null;
  // JSON gives plain arrays; the tuple shape is checked at runtime below rather
  // than asserted here, because asserting it is how `undefined` reaches a page.
  readonly printed_pages: readonly number[];
  readonly pagination?: string;
  readonly pdf_pages: readonly number[];
  readonly systems: readonly string[];
  readonly system_assets?: readonly string[];
  readonly system_aspect: readonly (readonly number[])[];
  readonly movements: readonly RawMovement[];
  /** A Proper's sections (schema 3). */
  readonly sections?: readonly RawPart[];
  /** The same, as schema 2 named them. */
  readonly parts?: readonly RawPart[];
  readonly jgabc_url?: string | null;
  readonly chant: readonly RawChant[] | null;
  readonly review_status: string;
}

interface RawVolume {
  readonly title: string;
  readonly part: string;
  /** Addenda with their own pagination: id to title. */
  readonly addenda?: Readonly<Record<string, string>>;
}

interface RawCatalog {
  readonly schema_version: number;
  readonly volumes: Readonly<Record<string, RawVolume>>;
  readonly chant_source: ChantSource | null;
  readonly pieces: readonly RawPiece[];
}

function pair(values: readonly number[], where: string): readonly [number, number] {
  const [first, second] = values;
  if (typeof first !== "number" || typeof second !== "number" || values.length !== 2) {
    throw new Error(`${where}: expected exactly two numbers, got ${JSON.stringify(values)}`);
  }
  return [first, second];
}

const PART_NAMES: ReadonlySet<string> = new Set(
  ["introit", "gradual", "alleluia", "tract", "sequence", "hymn", "offertory", "communion", "other"]);
const PLACEMENTS: ReadonlySet<string> = new Set(["label", "text", "mode", "order", "inferred", "hand", "reviewed"]);

/** Printed text from the catalogue (a margin label, an incipit), or null. */
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function parsePart(x: RawPart, where: string): ProperPart {
  const name = x.kind ?? x.part ?? "";
  if (!PART_NAMES.has(name)) throw new Error(`${where}: unknown part ${name}`);
  const part = name as ProperPartName;
  const variant = x.key ? x.key : x.n ? String(x.n) : x.variant ?? "";
  const gregobaseId = Number.isInteger(x.gregobase_id) ? (x.gregobase_id as number) : null;
  const label = text(x.label);
  const title = text(x.title);
  const rubric = text(x.rubric);
  const rubricTranslation = text(x.rubric_translation);
  const instructions = { ...(rubric ? { rubric } : {}), ...(rubricTranslation ? { rubricTranslation } : {}) };
  if (x.borrowed_page !== undefined) {
    return {
      kind: "borrowed", part, variant, label, title, ...instructions, gregobaseId, borrowedPage: x.borrowed_page,
      borrowedFrom: x.borrowed_from ?? null, borrowedRef: x.borrowed_ref ?? null,
      borrowedVolume: x.borrowed_volume ?? null,
    };
  }
  if (typeof x.system !== "number" || typeof x.ref !== "string" || !PLACEMENTS.has(x.placed ?? "")) {
    throw new Error(`${where}: a printed part needs system, ref and placed`);
  }
  return {
    kind: "printed", part, variant, label, title, ...instructions, system: x.system, ref: x.ref, gregobaseId,
    placed: x.placed as PrintedPart["placed"],
  };
}

/** Only jgabc's own propers page: the catalog is data, and a link is output. */
function safeJgabcUrl(url: string | null): string | null {
  return url !== null && /^https:\/\/bbloomf\.github\.io\/jgabc\/propers\.html#(saint|sunday|mass|common)=[\w%.-]+$/.test(url)
    ? url : null;
}

let cached: Catalog | null = null;

/** The bundled catalog, validated once and cached. */
export function loadCatalog(): Catalog {
  if (!cached) cached = parseCatalog(raw);
  return cached;
}

/**
 * Validate and map a raw catalog document. Pure, so every rejection path can be
 * exercised with synthetic input rather than only ever seeing the one bundled
 * file -- a validator that is never shown bad data is a validator nobody has
 * checked.
 */
export function parseCatalog(input: unknown): Catalog {
  const doc = input as RawCatalog;
  if (doc.schema_version !== SCHEMA_VERSION && doc.schema_version !== OLDER_SCHEMA) {
    throw new Error(
      `catalog schema_version ${doc.schema_version}, expected ${SCHEMA_VERSION}`,
    );
  }

  const pieces = doc.pieces.map((p): Piece => {
    if (!(p.volume in doc.volumes)) throw new Error(`${p.id}: unknown volume ${p.volume}`);
    if (!GENRES.has(p.genre)) throw new Error(`${p.id}: unknown genre ${p.genre}`);
    if (!RECORD_STATUSES.has(p.review_status)) {
      throw new Error(`${p.id}: unknown review_status ${p.review_status}`);
    }
    const addenda = doc.volumes[p.volume]?.addenda ?? {};
    if (p.pagination !== undefined && !Object.hasOwn(addenda, p.pagination)) {
      throw new Error(`${p.id}: unknown pagination ${p.pagination} in ${p.volume}`);
    }
    if (p.system_aspect.length !== p.systems.length) {
      throw new Error(`${p.id}: ${p.systems.length} systems but ${p.system_aspect.length} aspects`);
    }
    return {
      id: p.id, volume: p.volume, slug: p.slug, section: p.section, sourceNote: p.source_note ?? null,
      division: p.division ?? "varia", days: p.days ?? [],
      label: p.label, title: p.title, incipit: p.incipit,
      reference: p.reference ?? null, referenceSources: p.reference_sources ?? [], linkedDays: p.linked_days ?? [],
      hymns: (p.hymns ?? []).map((h): Hymn => ({ title: h.title, ref: h.ref, printedPage: h.printed_page })),
      genre: p.genre as Genre, mode: p.mode, mass: p.mass,
      printedPages: pair(p.printed_pages, `${p.id}.printed_pages`),
      pagination: p.pagination === undefined ? null : (addenda[p.pagination] ?? null),
      pdfPages: pair(p.pdf_pages, `${p.id}.pdf_pages`),
      systems: p.systems,
      systemAssets: p.system_assets ?? [],
      systemAspect: p.system_aspect.map((a, i) => pair(a, `${p.id}.system_aspect[${i}]`)),
      movements: p.movements.map((m): MovementBoundary => ({
        movement: m.movement as Movement, score: m.score, pdfPage: m.pdf_page,
        system: m.system, ref: m.ref, modeMarker: m.mode_marker,
      })),
      parts: (p.sections ?? p.parts ?? []).map((x, i) => parsePart(x, `${p.id}.sections[${i}]`)),
      jgabcUrl: safeJgabcUrl(p.jgabc_url ?? null),
      chant: (p.chant ?? []).map((c): ChantPairing => ({
        source: "gregobase", id: c.id,
        movement: (c.movement as Movement | null) ?? null,
        incipit: c.incipit, mode: c.mode, score: c.score,
        status: c.status as PairStatus,
      })),
      status: p.review_status as RecordStatus,
    };
  });

  return {
    schemaVersion: doc.schema_version,
    volumes: Object.fromEntries(Object.entries(doc.volumes).map(
      ([id, v]): [string, VolumeInfo] => [id, { title: v.title, part: v.part }])),
    chantSource: doc.chant_source,
    pieces,
  };
}

export function allPieces(): readonly Piece[] {
  return loadCatalog().pieces;
}

export function pieceBySlug(slug: string): Piece | undefined {
  return allPieces().find((p) => p.slug === slug);
}

/** Ordinary Masses in printed order: I, II, … XVIII. */
export function ordinaryMasses(): readonly Piece[] {
  return allPieces()
    // The Kyriale's eighteen Ordinaries, and nothing that only mentions a Missa.
    .filter((p) => p.genre === "mass_ordinary" && p.division === "kyriale")
    .slice()
    .sort((a, b) => a.printedPages[0] - b.printedPages[0]);
}

export function piecesInSection(section: string): readonly Piece[] {
  return allPieces().filter((p) => p.section === section);
}

export function sections(): readonly string[] {
  return [...new Set(allPieces().map((p) => p.section))];
}

/** Chant pairings in liturgical order, not catalog order. */
export function orderedChant(piece: Piece): readonly ChantPairing[] {
  return piece.chant.slice().sort((a, b) => {
    const ai = a.movement ? MOVEMENT_ORDER.indexOf(a.movement) : 99;
    const bi = b.movement ? MOVEMENT_ORDER.indexOf(b.movement) : 99;
    return ai - bi;
  });
}

/**
 * Resolves a system to its published URL stem.
 *
 * Published keys carry a content hash (systems/noh5/0051/000-91a1743aa200), so
 * the site cannot derive them from the ref alone — it must use the key the
 * pipeline recorded. Getting this wrong 404s every image in production while
 * working perfectly against local files, which is exactly what happened.
 */
export function systemUrlStem(piece: Piece, index: number): string {
  const asset = piece.systemAssets[index];
  const ref = piece.systems[index];
  if (asset && asset.length > 0) return `${assetBase()}/${asset}`;
  // Not yet sliced, or a local development build without manifests.
  return `${assetBase()}/${ref}`;
}

/** Asset base for system images. Falls back to a local path so the site can be
 *  built and read before anything is uploaded to R2. */
export function assetBase(): string {
  const configured = import.meta.env.PUBLIC_ASSET_BASE;
  return typeof configured === "string" && configured.length > 0
    ? configured.replace(/\/$/, "")
    : "/systems";
}

/** Pieces that carry a piece's days by citation: where its Mass is actually printed. */
export function citedBy(piece: Piece, pieces: readonly Piece[] = allPieces()): readonly Piece[] {
  return pieces.filter((p) => p.id !== piece.id && p.linkedDays.some((d) => piece.days.includes(d)));
}

/** "Nova Organi Harmonia, part III" for a piece's volume. */
/** Where in the book: "pp. 5–10", or for an addendum, which numbers its pages
 *  afresh, "Addenda ad Partem III, pp. 3–11". */
export function pagesLabel(piece: Piece): string {
  const pages = `pp. ${piece.printedPages[0]}–${piece.printedPages[1]}`;
  return piece.pagination ? `${piece.pagination}, ${pages}` : pages;
}

export function volumeLabel(piece: Piece): string {
  const part = loadCatalog().volumes[piece.volume]?.part;
  return part ? `Nova Organi Harmonia, part ${part}` : "Nova Organi Harmonia";
}

export const MOVEMENT_LABELS: Readonly<Record<Movement, string>> = {
  kyrie: "Kyrie", gloria: "Gloria", credo: "Credo", sanctus: "Sanctus",
  agnus: "Agnus Dei", ite: "Ite, missa est",
};

export interface MovementStart {
  readonly movement: Movement;
  readonly label: string;
  /** The in-page anchor of the movement's heading, e.g. "gloria". */
  readonly anchor: string;
  /** Position in piece.systems of the movement's first system. */
  readonly index: number;
}

/**
 * Where each movement begins, one per movement, in liturgical order. The jump
 * links and the headings in the music both come from here, so a link can never
 * name an anchor the page does not have.
 *
 * A section a person listed for the Mass (data/sections: its second Kyrie, each
 * of its dismissals) speaks for the system it starts on: a movement found on
 * that same system is left out, so "Ite, missa est" gives way to "Deo gratias (I)".
 * A row named for a movement (its key is `gloria`) is that movement, wherever
 * the pipeline put it: that is how an editor moves a movement's start.
 */
export function movementStarts(piece: Piece): readonly MovementStart[] {
  const rows = piece.parts.filter((x): x is PrintedPart => x.kind === "printed" && x.placed !== "order");
  const listed = new Set(rows.map((x) => x.ref));
  const renamed = new Set(rows.filter((x) => x.part === "other").map((x) => x.variant));
  const seen = new Set<Movement>();
  const starts: MovementStart[] = [];
  for (const movement of MOVEMENT_ORDER) {
    const boundary = piece.movements.find((b) => b.movement === movement);
    const index = boundary ? piece.systems.indexOf(boundary.ref) : -1;
    if (index < 0 || seen.has(movement) || renamed.has(movement) || (boundary && listed.has(boundary.ref))) continue;
    seen.add(movement);
    starts.push({ movement, label: MOVEMENT_LABELS[movement], anchor: movement, index });
  }
  return starts.sort((a, b) => a.index - b.index);
}

/** A readable in-page anchor: "Creator alme siderum" -> "hymn-creator-alme-siderum". */
export function hymnAnchor(title: string, occurrence = 0): string {
  const base = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `hymn-${base}${occurrence ? `-${occurrence + 1}` : ""}`;
}

export interface JumpTarget extends SectionRubric {
  readonly source?: string;
  readonly label: string;
  readonly anchor: string;
  /** Position in piece.systems of the first system. */
  readonly index: number;
  /** "chant": the one chant of a single-chant piece (Credo I), shown above its music. */
  readonly kind: "movement" | "hymn" | "part" | "chant";
  /** A part's chant on GregoBase, when known. */
  readonly chantUrl?: string | null;
  /** The GregoBase id of a part's chant, when known. */
  readonly chantId?: number | null;
  /** A part's partOrder. */
  readonly order?: number;
  /** Where a part is corrected: "part:<slug>/<part>[:<variant>]". */
  readonly target?: string;
  /** A section's margin label as printed ("2. Grad. I") and its opening words,
   * shown beside its heading where known. */
  readonly printed?: string | null;
  readonly title?: string | null;
}

const PART_LABELS: Readonly<Record<ProperPartName, string>> = {
  introit: "Introit", gradual: "Gradual", alleluia: "Alleluia", tract: "Tract",
  sequence: "Sequence", hymn: "Hymn", offertory: "Offertory", communion: "Communion", other: "Section",
};

// The order of Mass, for placing a section printed elsewhere among those
// printed here. A hymn follows the lessons' Graduals (the Ember Saturday's
// *Benedictus es*); a section outside the Mass (a blessing) comes last.
const PART_ORDER: readonly string[] = [
  "introit", "gradual", "hymn", "alleluia", "tract", "alleluia/paschal", "sequence", "offertory", "communion", "other",
];

/** Position of a part in the order of Mass, for listing printed and borrowed parts together. */
export function partOrder(part: ProperPartName, variant = ""): number {
  const paschal = /^paschal(?:-\d+)?$/.test(variant);
  const key = paschal ? `${part}/paschal` : part;
  const i = PART_ORDER.indexOf(key);
  return (i < 0 ? PART_ORDER.indexOf(part) : i) + (paschal && variant.includes("-") ? Number(variant.split("-")[1]) / 100
    : /^\d+$/.test(variant) ? Number(variant) / 100 : 0);
}

/**
 * Sections printed here in the book's order, with those printed elsewhere
 * slotted in by their place in the order of Mass: the book may print its
 * sections out of that order (NOH3's Queenship Mass prints its Paschal
 * Alleluia before the Gradual), and the page follows the book.
 */
export function inPrintedOrder<T extends { readonly order: number }>(own: readonly T[], borrowed: readonly T[]): T[] {
  const out = [...own];
  for (const b of [...borrowed].sort((x, y) => x.order - y.order)) {
    const at = out.findIndex((x) => !borrowed.includes(x) && x.order > b.order);
    out.splice(at < 0 ? out.length : at, 0, b);
  }
  return out;
}

/** "Paschal Alleluia", "Gradual 2", "Offertory". */
export function partLabel(part: ProperPartName, variant = ""): string {
  if (/^paschal(?:-\d+)?$/.test(variant)) return `Paschal ${PART_LABELS[part]}${variant.includes("-") ? ` ${variant.split("-")[1]}` : ""}`;
  if (variant === "extra-paschal") return `${PART_LABELS[part]} (outside Paschaltide)`;
  if (variant === "advent") return `${PART_LABELS[part]} (Advent)`;
  if (variant === "shared") return PART_LABELS[part];
  // A key of its own ("kyrie-b") with no label to show: its words.
  if (variant && !/^\d+$/.test(variant)) return variant.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
  return variant ? `${PART_LABELS[part]} ${variant}` : PART_LABELS[part];
}

/**
 * What a section is called on the page and in the jump links: "Gradual 2",
 * "Paschal Alleluia"; a hymn by its opening words ("Benedictus es"), and a
 * section outside the Mass by the label the book (or an editor) gives it.
 */
export function sectionName(x: ProperPart): string {
  if (x.part === "hymn" && x.title) return x.title;
  if (x.part === "other" && (x.label || x.title)) return (x.label ?? x.title) as string;
  return partLabel(x.part, x.variant);
}

/** In-page anchor of a part's heading: "introit", "alleluia-paschal", "gradual-2". */
export function partAnchor(part: ProperPartName, variant = ""): string {
  return variant ? `${part}-${variant}` : part;
}

/** A GregoBase chant page, from a validated integer id only. */
export function gregobaseUrl(id: number | null): string | null {
  return id !== null && Number.isInteger(id) && id > 0
    ? `https://gregobase.selapa.net/chant.php?id=${id}` : null;
}

export interface BorrowedLink {
  readonly label: string;
  /** partOrder of the part, to list it among the printed ones. */
  readonly order: number;
  /** "/piece/<lender>/#<anchor>", or null when the lender is unknown. */
  readonly href: string | null;
  readonly lenderTitle: string | null;
  readonly page: number;
  readonly chantUrl: string | null;
}

/** Parts printed elsewhere, as links to where the lending piece prints them. */
export function borrowedLinks(piece: Piece, pieces: readonly Piece[] = allPieces()): readonly BorrowedLink[] {
  return piece.parts.filter((x): x is BorrowedPart => x.kind === "borrowed").map((x) => {
    const lender = x.borrowedFrom ? pieces.find((p) => p.slug === x.borrowedFrom) : undefined;
    const lent = lender?.parts.find((q): q is PrintedPart => q.kind === "printed" && q.ref === x.borrowedRef);
    return {
      label: sectionName(x),
      order: partOrder(x.part, x.variant),
      href: lender && lent ? `/piece/${lender.slug}/#${partAnchor(lent.part, lent.variant)}` : null,
      lenderTitle: lender ? (lender.incipit ?? lender.title) : null,
      page: x.borrowedPage,
      chantUrl: gregobaseUrl(x.gregobaseId),
    };
  });
}

/**
 * Everything a reader can jump to in a piece: its movements (a Mass), its
 * parts (a Proper) and the hymns printed in it (a Vespers office), in page order. The jump links and the
 * headings in the music both come from here, so every link has a target.
 */
/** The verified GregoBase pairing for a movement (the pairing step's, not a guess). */
export function verifiedChant(piece: Piece, movement: Movement | null = null): ChantPairing | undefined {
  const verified = piece.chant.filter((c) => c.status === "verified");
  return movement === null ? (verified.length === 1 ? verified[0] : undefined)
    : verified.find((c) => c.movement === movement);
}

export function jumpTargets(piece: Piece): readonly JumpTarget[] {
  const movements: JumpTarget[] = movementStarts(piece).map((s) => {
    const chant = verifiedChant(piece, s.movement);
    return {
      label: s.label, anchor: s.anchor, index: s.index, kind: "movement",
      chantId: chant?.id ?? null, chantUrl: gregobaseUrl(chant?.id ?? null),
    };
  });
  const parts: JumpTarget[] = [];
  const partAnchors = new Set<string>();
  for (const x of piece.parts) {
    // Placed by order alone, a start is a guess: it waits in the review queue.
    if (x.kind !== "printed" || x.placed === "order") continue;
    const index = piece.systemSources && piece.systems[x.system] === x.ref ? x.system : piece.systems.indexOf(x.ref);
    const anchor = partAnchor(x.part, x.variant);
    if (index < 0 || partAnchors.has(anchor)) continue;
    partAnchors.add(anchor);
    // A row named for a movement keeps that movement's chant and name unless it gives its own.
    const movement = x.part === "other" && (MOVEMENT_ORDER as readonly string[]).includes(x.variant)
      ? x.variant as Movement : null;
    const chantId = x.gregobaseId ?? (x.part === "hymn" ? hymnChantId(x.ref) : null)
      ?? (movement ? verifiedChant(piece, movement)?.id ?? null : null);
    const label = movement && !x.label ? MOVEMENT_LABELS[movement] : sectionName(x);
    parts.push({ label, anchor: movement ?? anchor, index, kind: "part",
                 chantUrl: gregobaseUrl(chantId), chantId,
                 order: partOrder(x.part, x.variant),
                 target: x.sourceTarget ?? `part:${piece.slug}/${x.part}${x.variant ? `:${x.variant}` : ""}`,
                 ...(x.source ? { source: x.source } : {}),
                 printed: x.label, title: x.title,
                 ...(x.rubric ? { rubric: x.rubric } : {}),
                 ...(x.rubricTranslation ? { rubricTranslation: x.rubricTranslation } : {}) });
  }
  const used = new Map<string, number>();
  const hymns: JumpTarget[] = [];
  for (const h of piece.hymns) {
    if (piece.parts.some((p) => p.kind === "printed" && p.part === "hymn" && p.ref === h.ref)) continue;
    const index = piece.systems.indexOf(h.ref);
    if (index < 0) continue;
    const seen = used.get(h.title) ?? 0;
    used.set(h.title, seen + 1);
    const chantId = hymnChantId(h.ref);
    hymns.push({ label: h.title, anchor: hymnAnchor(h.title, seen), index, kind: "hymn",
      chantId, chantUrl: gregobaseUrl(chantId) });
  }
  const all = [...movements, ...parts, ...hymns];
  // A single chant (Credo I, an ad libitum Kyrie): its chant above the music.
  const researched = piece.genre === "hymn" ? hymnChantId(piece.systems[0] ?? "") : null;
  const single = all.length === 0 && piece.systems.length > 0
    ? (researched ? { id: researched, movement: null } : verifiedChant(piece)) : undefined;
  if (single) {
    all.push({
      label: single.movement ? MOVEMENT_LABELS[single.movement] : piece.title, anchor: "chant",
      index: 0, kind: "chant", chantId: single.id, chantUrl: gregobaseUrl(single.id),
    });
  }
  return all.sort((a, b) => a.index - b.index);
}

/** Every printed hymn setting, including standalone pieces and sections of a Mass. */
export function hymnIndex(pieces: readonly Piece[] = allPieces()):
    readonly { readonly title: string; readonly piece: Piece; readonly anchor: string; readonly printedPage: number; readonly ref: string }[] {
  const out: { title: string; piece: Piece; anchor: string; printedPage: number; ref: string }[] = [];
  for (const piece of pieces) {
    const seen = new Set<string>();
    if (piece.genre === "hymn" && piece.systems.length > 0 && !piece.sourceNote) {
      out.push({ title: piece.title, piece, anchor: "", printedPage: piece.printedPages[0], ref: piece.systems[0]! });
      seen.add(piece.systems[0]!);
    }
    for (const t of jumpTargets(piece)) {
      const part = t.kind === "part" ? piece.parts.find((p) =>
        p.kind === "printed" && p.part === "hymn" && partAnchor(p.part, p.variant) === t.anchor) : undefined;
      if (t.kind !== "hymn" && !part) continue;
      const ref = piece.systems[t.index];
      if (!ref || seen.has(ref)) continue;
      seen.add(ref);
      const embedded = piece.hymns.find((h) => h.ref === ref);
      const pdfPage = Number(ref.split("/")[1]);
      const volume = raw.volumes[piece.volume as keyof typeof raw.volumes];
      const segment = volume?.page_map.find((s) => pdfPage >= s.first_pdf && pdfPage <= s.last_pdf);
      const printedPage = embedded?.printedPage ?? (segment ? pdfPage - segment.offset : piece.printedPages[0]);
      out.push({ title: embedded?.title ?? part?.title ?? t.label, piece, anchor: t.anchor, printedPage, ref });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "la") || a.piece.volume.localeCompare(b.piece.volume)
    || a.printedPage - b.printedPage);
}

/** Related settings by reviewed incipit; existing music stays the primary source. */
export function relatedHymnSettings(piece: Piece, pieces: readonly Piece[] = allPieces()): Piece[] {
  const links: Readonly<Record<string, readonly string[]>> = reviewedHymnLinks;
  const slugs = new Set(hymnIndex([piece]).flatMap((h) => links[h.title] ?? []));
  return pieces.filter((p) => slugs.has(p.slug) && p.slug !== piece.slug && p.volume === "noh7"
    && p.genre === "hymn" && p.systems.length > 0 && !p.sourceNote);
}
