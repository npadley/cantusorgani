import raw from "../../../data/catalog.json";

/** Genre of a catalogued piece. Mirrors the pipeline's controlled set. */
export type Genre =
  | "asperges" | "mass_ordinary" | "credo" | "tonus" | "kyrie" | "gloria"
  | "sanctus" | "agnus" | "requiem" | "absolutio" | "exsequiis" | "proper";

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

export type ProperPartName =
  | "introit" | "gradual" | "alleluia" | "tract" | "sequence" | "offertory" | "communion";

/** A part of a Proper printed in this piece: where it starts. */
export interface PrintedPart {
  readonly kind: "printed";
  readonly part: ProperPartName;
  /** "" | "paschal" | "1", "2" … when a part repeats (Ember Saturday Graduals). */
  readonly variant: string;
  readonly system: number;
  readonly ref: string;
  readonly gregobaseId: number | null;
  /** How the start was found. "order" is a guess the site does not show. */
  readonly placed: "label" | "text" | "mode" | "order";
}

/** A part the book prints elsewhere ("Introitus. Benedicite, ut supra, p. 354"). */
export interface BorrowedPart {
  readonly kind: "borrowed";
  readonly part: ProperPartName;
  readonly variant: string;
  /** The lending piece and the system its part starts on; null when unresolved. */
  readonly borrowedFrom: string | null;
  readonly borrowedRef: string | null;
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

export const SCHEMA_VERSION = 2;

/** Liturgical order, not catalog order. Never sort movements alphabetically. */
export const MOVEMENT_ORDER: readonly Movement[] = [
  "kyrie", "gloria", "credo", "sanctus", "agnus", "ite",
];

const GENRES: ReadonlySet<string> = new Set<Genre>([
  "asperges", "mass_ordinary", "credo", "tonus", "kyrie", "gloria",
  "sanctus", "agnus", "requiem", "absolutio", "exsequiis", "proper",
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

interface RawPart {
  readonly part: string; readonly variant?: string;
  readonly system?: number; readonly ref?: string;
  readonly gregobase_id?: number | null; readonly placed?: string;
  readonly borrowed_from?: string | null; readonly borrowed_ref?: string | null;
  readonly borrowed_page?: number;
}

interface RawPiece {
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
  readonly pdf_pages: readonly number[];
  readonly systems: readonly string[];
  readonly system_assets?: readonly string[];
  readonly system_aspect: readonly (readonly number[])[];
  readonly movements: readonly RawMovement[];
  // Optional: a catalog written before Proper parts existed still loads.
  readonly parts?: readonly RawPart[];
  readonly jgabc_url?: string | null;
  readonly chant: readonly RawChant[] | null;
  readonly review_status: string;
}

interface RawVolume {
  readonly title: string;
  readonly part: string;
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
  ["introit", "gradual", "alleluia", "tract", "sequence", "offertory", "communion"]);
const PLACEMENTS: ReadonlySet<string> = new Set(["label", "text", "mode", "order"]);

function parsePart(x: RawPart, where: string): ProperPart {
  if (!PART_NAMES.has(x.part)) throw new Error(`${where}: unknown part ${x.part}`);
  const part = x.part as ProperPartName;
  const variant = x.variant ?? "";
  const gregobaseId = Number.isInteger(x.gregobase_id) ? (x.gregobase_id as number) : null;
  if (x.borrowed_page !== undefined) {
    return {
      kind: "borrowed", part, variant, gregobaseId, borrowedPage: x.borrowed_page,
      borrowedFrom: x.borrowed_from ?? null, borrowedRef: x.borrowed_ref ?? null,
    };
  }
  if (typeof x.system !== "number" || typeof x.ref !== "string" || !PLACEMENTS.has(x.placed ?? "")) {
    throw new Error(`${where}: a printed part needs system, ref and placed`);
  }
  return {
    kind: "printed", part, variant, system: x.system, ref: x.ref, gregobaseId,
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
  if (doc.schema_version !== SCHEMA_VERSION) {
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
    if (p.system_aspect.length !== p.systems.length) {
      throw new Error(`${p.id}: ${p.systems.length} systems but ${p.system_aspect.length} aspects`);
    }
    return {
      id: p.id, volume: p.volume, slug: p.slug, section: p.section,
      division: p.division ?? "varia", days: p.days ?? [],
      label: p.label, title: p.title, incipit: p.incipit,
      reference: p.reference ?? null, linkedDays: p.linked_days ?? [],
      hymns: (p.hymns ?? []).map((h): Hymn => ({ title: h.title, ref: h.ref, printedPage: h.printed_page })),
      genre: p.genre as Genre, mode: p.mode, mass: p.mass,
      printedPages: pair(p.printed_pages, `${p.id}.printed_pages`),
      pdfPages: pair(p.pdf_pages, `${p.id}.pdf_pages`),
      systems: p.systems,
      systemAssets: p.system_assets ?? [],
      systemAspect: p.system_aspect.map((a, i) => pair(a, `${p.id}.system_aspect[${i}]`)),
      movements: p.movements.map((m): MovementBoundary => ({
        movement: m.movement as Movement, score: m.score, pdfPage: m.pdf_page,
        system: m.system, ref: m.ref, modeMarker: m.mode_marker,
      })),
      parts: (p.parts ?? []).map((x, i) => parsePart(x, `${p.id}.parts[${i}]`)),
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
 */
export function movementStarts(piece: Piece): readonly MovementStart[] {
  const seen = new Set<Movement>();
  const starts: MovementStart[] = [];
  for (const movement of MOVEMENT_ORDER) {
    const boundary = piece.movements.find((b) => b.movement === movement);
    const index = boundary ? piece.systems.indexOf(boundary.ref) : -1;
    if (index < 0 || seen.has(movement)) continue;
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

export interface JumpTarget {
  readonly label: string;
  readonly anchor: string;
  /** Position in piece.systems of the first system. */
  readonly index: number;
  readonly kind: "movement" | "hymn" | "part";
  /** A part's chant on GregoBase, when known. */
  readonly chantUrl?: string | null;
  /** A part's partOrder. */
  readonly order?: number;
}

const PART_LABELS: Readonly<Record<ProperPartName, string>> = {
  introit: "Introit", gradual: "Gradual", alleluia: "Alleluia", tract: "Tract",
  sequence: "Sequence", offertory: "Offertory", communion: "Communion",
};

const PART_ORDER: readonly string[] = [
  "introit", "gradual", "alleluia", "tract", "alleluia/paschal", "sequence", "offertory", "communion",
];

/** Position of a part in the order of Mass, for listing printed and borrowed parts together. */
export function partOrder(part: ProperPartName, variant = ""): number {
  const key = variant === "paschal" ? `${part}/paschal` : part;
  const i = PART_ORDER.indexOf(key);
  return (i < 0 ? PART_ORDER.indexOf(part) : i) + (/^\d+$/.test(variant) ? Number(variant) / 100 : 0);
}

/** "Paschal Alleluia", "Gradual 2", "Offertory". */
export function partLabel(part: ProperPartName, variant = ""): string {
  if (variant === "paschal") return `Paschal ${PART_LABELS[part]}`;
  return variant ? `${PART_LABELS[part]} ${variant}` : PART_LABELS[part];
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
      label: partLabel(x.part, x.variant),
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
export function jumpTargets(piece: Piece): readonly JumpTarget[] {
  const movements: JumpTarget[] = movementStarts(piece).map((s) => ({
    label: s.label, anchor: s.anchor, index: s.index, kind: "movement",
  }));
  const parts: JumpTarget[] = [];
  const partAnchors = new Set<string>();
  for (const x of piece.parts) {
    // Placed by order alone, a start is a guess: it waits in the review queue.
    if (x.kind !== "printed" || x.placed === "order") continue;
    const index = piece.systems.indexOf(x.ref);
    const anchor = partAnchor(x.part, x.variant);
    if (index < 0 || partAnchors.has(anchor)) continue;
    partAnchors.add(anchor);
    parts.push({ label: partLabel(x.part, x.variant), anchor, index, kind: "part",
                 chantUrl: gregobaseUrl(x.gregobaseId), order: partOrder(x.part, x.variant) });
  }
  const used = new Map<string, number>();
  const hymns: JumpTarget[] = [];
  for (const h of piece.hymns) {
    const index = piece.systems.indexOf(h.ref);
    if (index < 0) continue;
    const seen = used.get(h.title) ?? 0;
    used.set(h.title, seen + 1);
    hymns.push({ label: h.title, anchor: hymnAnchor(h.title, seen), index, kind: "hymn" });
  }
  return [...movements, ...parts, ...hymns].sort((a, b) => a.index - b.index);
}

/** Every hymn in the catalog, A-Z, with the page and anchor that show it. */
export function hymnIndex(pieces: readonly Piece[] = allPieces()):
    readonly { readonly title: string; readonly piece: Piece; readonly anchor: string }[] {
  const out: { title: string; piece: Piece; anchor: string }[] = [];
  for (const piece of pieces) {
    for (const t of jumpTargets(piece)) {
      if (t.kind === "hymn") out.push({ title: t.label, piece, anchor: t.anchor });
    }
  }
  return out.sort((a, b) => a.title.localeCompare(b.title, "la"));
}
