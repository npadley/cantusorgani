import type { ApprovedConversion, ConversionManifest, ConversionManifestPart, SafeBoundary } from "./export-layout/types";
import productionManifest from "../../../data/typeset/mei/manifest.json";
import fixtureManifest from "./export-layout/__fixtures__/manifest.fixture.json";

const EMPTY: ConversionManifest = { schemaVersion: 1, parts: [] };
const DIVISIONS: ReadonlySet<string> = new Set(["finalis", "maxima", "maior", "minima"]);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const hex = (v: unknown, n: number): v is string => typeof v === "string" && new RegExp(`^[0-9a-f]{${n}}$`).test(v);

function parseBoundary(v: unknown): SafeBoundary | null {
  if (!isRecord(v)) return null;
  const { id, onset, sourceBreak, division, measureId, afterText } = v;
  if (!str(id) || !str(onset) || typeof sourceBreak !== "boolean" || !str(measureId)) return null;
  if (division !== null && !(typeof division === "string" && DIVISIONS.has(division))) return null;
  if (afterText !== null && typeof afterText !== "string") return null;
  return { id, onset, sourceBreak, division: division as SafeBoundary["division"], measureId, afterText };
}

function parsePart(v: unknown): ConversionManifestPart | null {
  if (!isRecord(v)) return null;
  const { target, renderHash, digest, meiUrl, meiSha256, sourceRevision, profile, verovio, capabilities, boundaries } = v;
  if (!str(target) || !hex(renderHash, 32) || !hex(digest, 64) || !hex(meiSha256, 64)) return null;
  if (!str(meiUrl) || !str(sourceRevision) || !str(profile) || !str(verovio)) return null;
  if (!isRecord(capabilities) || typeof capabilities["manualBreaks"] !== "boolean") return null;
  if (!Array.isArray(boundaries)) return null;
  const parsed = (boundaries as unknown[]).map(parseBoundary);
  const safe = parsed.filter((b): b is SafeBoundary => b !== null);
  if (safe.length !== parsed.length) return null;
  return { target, renderHash, digest, meiUrl, meiSha256, sourceRevision, profile, verovio,
           boundaries: safe, capabilities: { manualBreaks: capabilities["manualBreaks"] } };
}

/** Strictly validates a manifest. Malformed parts are dropped; a wrong top-level shape is empty. */
export function parseManifest(value: unknown): ConversionManifest {
  if (!isRecord(value) || value["schemaVersion"] !== 1 || !Array.isArray(value["parts"])) return EMPTY;
  const parts = (value["parts"] as unknown[]).map(parsePart).filter((p): p is ConversionManifestPart => p !== null);
  return { schemaVersion: 1, parts };
}

/** The approved conversion for exactly this target and render hash, else null. */
export function approvedConversionFor(target: string, renderHash: string, manifest: ConversionManifest): ApprovedConversion | null {
  const part = manifest.parts.find((p) => p.target === target && p.renderHash === renderHash);
  if (!part) return null;
  const { target: _t, renderHash: _r, ...conversion } = part;
  return conversion;
}

/** Production manifest, or the experimental fixture when PUBLIC_MEI_MANIFEST=fixture (B10a hardens this). */
export function loadManifest(): ConversionManifest {
  return parseManifest(import.meta.env.PUBLIC_MEI_MANIFEST === "fixture" ? fixtureManifest : productionManifest);
}
