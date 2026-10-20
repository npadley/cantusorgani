// Main-thread side of chant (CS §4.1, §6): draw each chant of the selection with Exsurge and hand the
// SVG strings to the layout worker. Imported only by the editor chunk; the controller calls it only when
// Chant is on and the selection has chants, so an ordinary page load and chant Off load nothing.
import type { ExsurgeLib } from '../exsurge';
import { loadExsurge } from '../exsurgeLoader';
import { chantJobs, chantScaleFor } from './chantScale';
import type { ChantScale } from './chantScale';
import { ensureExportFace, renderChantSvg } from './chantRender';
import type { ChantSource } from './chantRender';
import type { ExportPart, LayoutSettings } from './types';

export interface ChantJobDeps {
  readonly loadLib: () => Promise<ExsurgeLib>;
  readonly ensureFace: () => Promise<boolean>;
  readonly fetchChant: (id: number) => Promise<{ readonly gabc: string }>;
  readonly render: (lib: ExsurgeLib, chant: ChantSource, scale: ChantScale) => Promise<string | null>;
}

const realDeps: ChantJobDeps = {
  loadLib: loadExsurge,
  ensureFace: () => ensureExportFace(),
  async fetchChant(id) {
    const response = await fetch(`/chant/${id}.json`);
    if (!response.ok) throw new Error(`chant ${id}: ${response.status}`);
    const json: unknown = await response.json();
    if (typeof json !== 'object' || json === null || typeof (json as { gabc?: unknown }).gabc !== 'string') throw new Error(`chant ${id}: no gabc`);
    return { gabc: (json as { gabc: string }).gabc };
  },
  render: renderChantSvg,
};

/**
 * chantId -> Exsurge SVG at the job's scale. A chant that cannot be fetched or drawn is left out (the part
 * prints without it); a missing export face or a failed Exsurge load leaves every chant out.
 */
export async function renderChantSvgs(
  parts: readonly ExportPart[],
  settings: LayoutSettings,
  deps: ChantJobDeps = realDeps,
): Promise<ReadonlyMap<number, string>> {
  const out = new Map<number, string>();
  const jobs = chantJobs(parts);
  if (settings.chant !== 'before' || jobs.length === 0) return out;
  if (!(await deps.ensureFace())) return out;
  let lib: ExsurgeLib;
  try {
    lib = await deps.loadLib();
  } catch {
    return out;
  }
  for (const { id, part } of jobs) {
    const ref = part.chants.find((c) => c.id === id);
    if (ref === undefined) continue;
    try {
      const { gabc } = await deps.fetchChant(id);
      const svg = await deps.render(lib, { id, gabc, annotation: ref.annotation, mode: ref.mode }, chantScaleFor(settings, part));
      if (svg !== null) out.set(id, svg);
    } catch {
      // This chant is left out; compose reports CHANT_UNAVAILABLE and the part prints without it.
    }
  }
  return out;
}
