import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EXPORT_CEILING } from "./config";
import { PDFDocument, PDFArray, PDFRawStream, decodePDFRawStream } from "pdf-lib";

import { A4, LETTER, buildPdf, estimatePages, httpPdfFetcher, httpPngFetcher, validateSelection } from "./pdf";

// Five real @2x.png slices of NOH5 p. 21 (public domain), kept beside the test
// so it runs without build/ -- in CI, and on a fresh checkout.
const SLICES = resolve(__dirname, "__fixtures__/slices");

/** Reads real @2x.png slices, as the site would fetch them from R2. */
async function fileFetcher(ref: string): Promise<ArrayBuffer> {
  const buffer = await readFile(resolve(SLICES, `${ref}@2x.png`));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

const MISSA_I_PAGE = ["noh5/0051/000", "noh5/0051/001", "noh5/0051/002",
                      "noh5/0051/003", "noh5/0051/004"];

describe("validateSelection", () => {
  it("should refuse an empty selection and say what to do", () => {
    expect(validateSelection(0)).toBe("Tick at least one part to export.");
  });

  it("should accept a selection exactly at the ceiling", () => {
    expect(validateSelection(EXPORT_CEILING)).toBeNull();
  });

  it("should refuse one system over the ceiling with its size and the limit", () => {
    const message = validateSelection(EXPORT_CEILING + 1);
    expect(message).toContain(`This selection is ${EXPORT_CEILING + 1} systems`);
    expect(message).toContain(`the limit is ${EXPORT_CEILING}`);
    expect(message).not.toMatch(/movement pages/);
  });

  it("should name the largest ticked parts that would bring it under the ceiling", () => {
    const message = validateSelection(EXPORT_CEILING + 10, [
      { label: "Introit", systems: 8 },
      { label: "Tract", systems: 14 },
      { label: "Gradual", systems: 12 },
    ]);
    expect(message).toContain("Untick the Tract (14 systems) to fit.");
  });

  it("should accept St Therese's whole Proper (90 systems)", () => {
    expect(validateSelection(90)).toBeNull();
  });
});

describe("estimatePages", () => {
  it("should estimate about four and a half systems per A4 page, at least one", () => {
    expect(estimatePages(0)).toBe(1);
    expect(estimatePages(9)).toBe(2);
    expect(estimatePages(90)).toBe(20);
  });
});

describe("buildPdf", () => {
  it("produces a valid PDF from real slices", async () => {
    const result = await buildPdf({
      refs: MISSA_I_PAGE, title: "Missa I", fetchPng: fileFetcher,
    });
    const header = new TextDecoder().decode(result.bytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
  });

  it("packs several systems onto one page rather than one per sheet", async () => {
    // One system per page would make a single Mass a 34-page download.
    const result = await buildPdf({
      refs: MISSA_I_PAGE, title: "Missa I", fetchPng: fileFetcher,
    });
    expect(result.pages).toBeLessThan(MISSA_I_PAGE.length);
    expect(result.pages).toBeGreaterThan(0);
  });

  it("reports progress for every system", async () => {
    const seen: number[] = [];
    await buildPdf({
      refs: MISSA_I_PAGE, title: "Missa I", fetchPng: fileFetcher,
      onProgress: (done) => seen.push(done),
    });
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it("throws rather than emitting a partial PDF when a slice is missing", async () => {
    await expect(buildPdf({
      refs: [...MISSA_I_PAGE, "noh5/9999/000"],
      title: "Missa I",
      fetchPng: fileFetcher,
    })).rejects.toThrow();
  });

  it("should refuse an over-ceiling selection before fetching anything", async () => {
    let fetched = 0;
    await expect(buildPdf({
      refs: Array.from({ length: EXPORT_CEILING + 1 }, (_, i) => `x/${i}`),
      title: "Too big",
      fetchPng: async (r) => { fetched += 1; return fileFetcher(r); },
    })).rejects.toThrow(/the limit is 300/);
    expect(fetched).toBe(0);
  });
});

describe("buildPdf at scale", () => {
  it("should build a 150-system document on about 150 / 4.5 pages", async () => {
    const refs = Array.from({ length: 150 }, (_, i) => MISSA_I_PAGE[i % MISSA_I_PAGE.length]!);
    const result = await buildPdf({ refs, title: "Long", fetchPng: fileFetcher });
    expect(result.pages).toBeGreaterThan(20);
    expect(result.pages).toBeLessThan(60);
  }, 60_000);
});

describe("buildPdf page breaks", () => {
  it("should start a new page when the next system does not fit", async () => {
    // Fifteen systems cannot fit one A4 page at export width.
    const refs = Array.from({ length: 15 }, (_, i) => MISSA_I_PAGE[i % MISSA_I_PAGE.length]!);
    const result = await buildPdf({ refs, title: "Missa I", fetchPng: fileFetcher });
    expect(result.pages).toBeGreaterThan(1);
    expect(result.pages).toBeLessThan(refs.length);
  }, 30_000);
});

describe("httpPngFetcher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should fetch the @2x.png variant of a full URL stem", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await httpPngFetcher("")("https://images.cantusorgani.org/systems/noh5/0051/000-abc");
    expect(fetchMock).toHaveBeenCalledWith("https://images.cantusorgani.org/systems/noh5/0051/000-abc@2x.png?export=1");
    expect(bytes.byteLength).toBe(3);
  });

  it("should prefix a base when given a bare reference", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetchMock);
    await httpPngFetcher("/systems")("noh5/0051/000");
    expect(fetchMock).toHaveBeenCalledWith("/systems/noh5/0051/000@2x.png");
  });

  it("should throw rather than embed an error page when a slice is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    await expect(httpPngFetcher("")("https://x/missing")).rejects.toThrow(/404.*Nothing was downloaded/);
  });
});

describe("buildPdf part headings", () => {
  it("should print each part's heading, and take the room it needs", async () => {
    const plain = await buildPdf({ refs: MISSA_I_PAGE, title: "T", fetchPng: fileFetcher });
    const headed = await buildPdf({
      refs: MISSA_I_PAGE, title: "T", fetchPng: fileFetcher,
      headings: [{ index: 0, label: "Introit" }, { index: 3, label: "Paschal Alleluia" }],
    });
    expect(headed.bytes.byteLength).toBeGreaterThan(plain.bytes.byteLength);
    const { PDFDocument } = await import("pdf-lib");
    const loaded = await PDFDocument.load(headed.bytes);
    const objects = loaded.context.enumerateIndirectObjects().map(([, obj]) => String(obj));
    expect(objects.some((o) => o.includes("/Helvetica-Bold"))).toBe(true);
  }, 30_000);

  it("should print headings in Latin characters Helvetica can show", async () => {
    const { pdfSafe } = await import("./pdf");
    expect(pdfSafe("S. Theresiæ — Missa")).toBe("S. Theresiæ — Missa");
    expect(pdfSafe("Dómine ǽterne")).toBe("Dómine æterne");
    expect(pdfSafe("snow ☃ man")).toBe("snow  man");
  });
});

/** A stand-in for a typeset part's PDF: `pages` pages at the given size. */
async function typesetPdf(pages: number, size: { width: number; height: number }): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let k = 0; k < pages; k++) doc.addPage([size.width, size.height]).drawText(`music ${k + 1}`);
  const bytes = await doc.save();
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

const pageSizes = async (bytes: Uint8Array) =>
  (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);

describe("buildPdf paper", () => {
  it("should make US Letter pages by default", async () => {
    const { bytes } = await buildPdf({ refs: MISSA_I_PAGE.slice(0, 1), title: "T", fetchPng: fileFetcher });
    expect(await pageSizes(bytes)).toEqual([[612, 792]]);
  });

  it("should make A4 pages when asked", async () => {
    const { bytes } = await buildPdf({ refs: MISSA_I_PAGE.slice(0, 1), title: "T", fetchPng: fileFetcher, paper: "a4" });
    expect(await pageSizes(bytes)).toEqual([[595, 842]]);
  });
});

describe("buildPdf typeset music", () => {
  it("should put a typeset part's own pages in place of its scans", async () => {
    const fetchPng = vi.fn(fileFetcher);
    const fetchPdf = vi.fn(async () => typesetPdf(2, LETTER));
    const result = await buildPdf({
      refs: MISSA_I_PAGE, title: "T", fetchPng, fetchPdf,
      headings: [{ index: 0, label: "Kyrie" }, { index: 3, label: "Gloria" }],
      typeset: [{ index: 0, count: 3, pdf: "https://x/typeset/h/letter.pdf", label: "Kyrie" }],
    });
    expect(fetchPdf).toHaveBeenCalledWith("https://x/typeset/h/letter.pdf");
    // Only the two scanned systems were fetched; the typeset three were not.
    expect(fetchPng.mock.calls.map(([ref]) => ref)).toEqual(MISSA_I_PAGE.slice(3));
    // Two typeset pages, then the scans on a page of their own.
    expect(result.pages).toBe(3);
    expect(await pageSizes(result.bytes)).toEqual([[612, 792], [612, 792], [612, 792]]);
    expect(result.fallbacks).toEqual([]);
  }, 30_000);

  it("should fit an A4 typeset page onto an A4 export", async () => {
    const result = await buildPdf({
      refs: MISSA_I_PAGE.slice(0, 2), title: "T", fetchPng: fileFetcher, paper: "a4",
      fetchPdf: async () => typesetPdf(1, A4),
      typeset: [{ index: 0, count: 2, pdf: "a4.pdf", label: "Kyrie" }],
    });
    expect(result.pages).toBe(1);
    expect(await pageSizes(result.bytes)).toEqual([[595, 842]]);
  });

  it("should use the scans and name the part when its typeset PDF cannot be fetched", async () => {
    const fetchPng = vi.fn(fileFetcher);
    const result = await buildPdf({
      refs: MISSA_I_PAGE.slice(0, 3), title: "T", fetchPng,
      fetchPdf: async () => { throw new Error("typeset PDF 404"); },
      typeset: [{ index: 0, count: 3, pdf: "letter.pdf", label: "Kyrie" }],
    });
    expect(fetchPng).toHaveBeenCalledTimes(3);
    expect(result.fallbacks).toEqual(["Kyrie"]);
  }, 30_000);

  it("should use the scans when the typeset PDF cannot be embedded", async () => {
    const blank = await PDFDocument.create();
    blank.addPage([612, 792]);
    const bytes = await blank.save();
    const result = await buildPdf({
      refs: MISSA_I_PAGE.slice(0, 1), title: "T", fetchPng: fileFetcher,
      fetchPdf: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      typeset: [{ index: 0, count: 1, pdf: "letter.pdf", label: "Kyrie" }],
    });
    expect(result.fallbacks).toEqual(["Kyrie"]);
    expect(result.pages).toBe(1);
  });
});

describe("httpPdfFetcher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should fetch a published PDF under its export cache key", async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([37, 80])));
    vi.stubGlobal("fetch", fetchMock);
    const bytes = await httpPdfFetcher("https://images.cantusorgani.org/typeset/h/letter.pdf");
    expect(fetchMock).toHaveBeenCalledWith("https://images.cantusorgani.org/typeset/h/letter.pdf?export=1");
    expect(bytes.byteLength).toBe(2);
  });

  it("should throw when the PDF is not there", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    await expect(httpPdfFetcher("https://x/a.pdf")).rejects.toThrow(/404/);
  });
});


/** Actual PDF text and drawing operators, decoded from the saved page streams. */
async function pageOperators(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => (page.node.Contents() as PDFArray).asArray().map((ref) => {
    const stream = doc.context.lookup(ref) as PDFRawStream;
    return new TextDecoder().decode(decodePDFRawStream(stream).decode());
  }).join("\n"));
}

const rubricHeading = { index: 0, label: "Alleluia", rubric: "Tempore Paschali.", rubricTranslation: "During Paschaltide." };
const hex = (text: string): string => Buffer.from(text, "latin1").toString("hex").toUpperCase();

it.each(["scans", "typeset", "fallback"])("prints both rubric languages above %s music even for a single selected part", async (mode) => {
  const result = await buildPdf({
    refs: MISSA_I_PAGE.slice(0, 1), title: "T", fetchPng: fileFetcher, headings: [rubricHeading],
    ...(mode !== "scans" ? {
      typeset: [{ index: 0, count: 1, pdf: "https://x/music.pdf", label: "Alleluia" }],
      fetchPdf: async () => { if (mode === "fallback") throw new Error("missing"); return typesetPdf(1, LETTER); },
    } : {}),
  });
  const [content] = await pageOperators(result.bytes);
  const latin = content!.indexOf(hex(rubricHeading.rubric));
  const english = content!.indexOf(hex(rubricHeading.rubricTranslation));
  expect(latin).toBeGreaterThan(-1);
  expect(english).toBeGreaterThan(latin);
  expect(english).toBeLessThan(content!.indexOf(" Do"));
  expect((content!.match(new RegExp(hex(rubricHeading.rubric), "g")) ?? []).length).toBe(1);
  expect(result.fallbacks).toEqual(mode === "fallback" ? ["Alleluia"] : []);
});

it("wraps long rubric text inside the margins and moves the instruction with its system", async () => {
  const long = "During Paschaltide the following verse is sung. ".repeat(8).trim();
  const result = await buildPdf({ refs: MISSA_I_PAGE, title: "T", fetchPng: fileFetcher,
    headings: [{ index: 4, label: "Alleluia", rubric: "Tempore Paschali.", rubricTranslation: long }],
  });
  const pages = await pageOperators(result.bytes);
  const instructions = pages.filter((content) => content.includes(hex("Tempore Paschali.")));
  expect(instructions).toHaveLength(1);
  const content = instructions[0]!;
  expect(content.indexOf(hex("Tempore Paschali."))).toBeLessThan(content.lastIndexOf(" Do"));
  const lines = [...content.matchAll(/<([0-9A-F]+)> Tj/g)].map((m) => Buffer.from(m[1]!, "hex").toString("latin1"));
  const translationLines = lines.filter((line) => !["Alleluia", "Tempore Paschali."].includes(line));
  expect(translationLines.length).toBeGreaterThan(1);
  expect(translationLines.join(" ")).toBe(long);
});

it("keeps verse and response marks readable in PDF's standard font", async () => {
  const { pdfSafe } = await import("./pdf");
  expect(pdfSafe("℣. Tempore Paschali. ℟. Alleluia.")).toBe("V. Tempore Paschali. R. Alleluia.");
});


it("preserves the full typeset page when it has no export heading or rubric", async () => {
  const result = await buildPdf({ refs: MISSA_I_PAGE.slice(0, 1), title: "T", fetchPng: fileFetcher,
    typeset: [{ index: 0, count: 1, pdf: "https://x/music.pdf", label: "Alleluia" }],
    fetchPdf: async () => typesetPdf(1, LETTER),
  });
  const [content] = await pageOperators(result.bytes);
  const matrices = [...content!.matchAll(/([0-9. -]+) cm/g)].map((m) => m[1]!.trim());
  expect(matrices).toEqual(Array(4).fill("1 0 0 1 0 0"));
});
