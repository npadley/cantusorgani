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

interface RawPiece {
  readonly id: string; readonly volume: string; readonly slug: string;
  readonly section: string; readonly label: string; readonly title: string;
  readonly division?: string; readonly days?: readonly string[];
  readonly incipit: string | null; readonly genre: string;
  readonly mode: string | null; readonly mass: string | null;
  // JSON gives plain arrays; the tuple shape is checked at runtime below rather
  // than asserted here, because asserting it is how `undefined` reaches a page.
  readonly printed_pages: readonly number[];
  readonly pdf_pages: readonly number[];
  readonly systems: readonly string[];
  readonly system_assets?: readonly string[];
  readonly system_aspect: readonly (readonly number[])[];
  readonly movements: readonly RawMovement[];
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
    .filter((p) => p.genre === "mass_ordinary")
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
  const configured = import.meta.env["PUBLIC_ASSET_BASE"];
  return typeof configured === "string" && configured.length > 0
    ? configured.replace(/\/$/, "")
    : "/systems";
}
