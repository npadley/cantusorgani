import type { ConversionLookup, ExportPart, PartHeading, ScanExportPart, SelectionInput } from "./types";

type Segment = SelectionInput["segments"][number];

/** Snapshot of the reader's selection as export parts, in page order. */
export function snapshotSelection(input: SelectionInput, lookup: ConversionLookup): ExportPart[] {
  const parts: ExportPart[] = [];
  const seen = new Set<string>();
  const push = (part: ExportPart): void => {
    if (seen.has(part.id)) throw new Error(`DUPLICATE_PART: ${part.id}`);
    seen.add(part.id);
    parts.push(part);
  };
  for (const seg of input.segments) {
    const heading: PartHeading = { label: seg.label, rubric: seg.rubric, rubricTranslation: seg.rubricTranslation, credit: seg.credit };
    const base = (runIndex: number, count: number, sourceRevision: string) =>
      ({ id: `${seg.segmentId}:${runIndex}`, label: seg.label, heading, sourceSystemCount: count, sourceRevision });
    const scan = (runIndex: number, stems: readonly string[], count: number, available: boolean): ScanExportPart =>
      ({ ...base(runIndex, count, stems[0] ?? ""), kind: "scan", stems, customizableAvailable: available });

    const total = seg.runs.reduce((n, r) => n + r.count, 0);
    if (seg.runs.length === 0 || total !== seg.stems.length) {
      push(scan(0, seg.stems, seg.stems.length, false));
      continue;
    }
    let pending: ScanExportPart | null = null;
    const flush = (): void => { if (pending) push(pending); pending = null; };
    let offset = 0;
    seg.runs.forEach((run, i) => {
      const stems = seg.stems.slice(offset, offset + run.count);
      offset += run.count;
      const { target, hash } = run;
      const eligible = run.key !== null && target !== null && hash !== null;
      const conversion = eligible ? lookup(target, hash) : null;
      if (eligible && !run.showsScans) {
        if (conversion) {
          flush();
          push({ ...base(i, run.count, hash), kind: "mei", target, renderHash: hash, conversion });
          return;
        }
        if (run.letter !== null && run.a4 !== null) {
          flush();
          push({ ...base(i, run.count, hash), kind: "fixed", target, renderHash: hash, letterPdf: run.letter, a4Pdf: run.a4 });
          return;
        }
      }
      const available = conversion !== null && run.showsScans;
      if (pending) {
        pending = { ...pending, stems: [...pending.stems, ...stems], sourceSystemCount: pending.sourceSystemCount + run.count,
                    customizableAvailable: pending.customizableAvailable || available };
      } else {
        pending = scan(i, stems, run.count, available);
      }
    });
    flush();
  }
  return parts;
}
