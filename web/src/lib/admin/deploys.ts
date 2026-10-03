/**
 * Whether a published batch is live on the site yet. A batch is live once the
 * site workflow (.github/workflows/site.yml) has finished deploying its merge
 * commit. The repository is public, so the admin home asks GitHub's public API
 * for that commit's runs from the browser: no token, and nothing new on the
 * server. Unauthenticated calls are limited (60 an hour for each address),
 * which the home's few polls stay well under.
 */

export const REPO = "npadley/cantusorgani";
const SITE_WORKFLOW = "site";

/** A workflow run, as GitHub's API returns it (only what is read here). */
export interface Run {
  readonly name: string;
  readonly event: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly html_url: string;
  readonly updated_at: string;
}

export interface DeployState {
  readonly live: boolean;
  /** Whether it is worth asking again later. */
  readonly pending: boolean;
  readonly words: string;
  readonly href: string | null;
}

/** A short local time: "3 Oct, 14:05". */
export function when(iso: string, locale = "en-GB"): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? iso
    : d.toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** What became of a merge commit, in words, from its runs. */
export function deployState(runs: readonly Run[] | null, mergedAt: string): DeployState {
  const merged = `Merged ${when(mergedAt)}`;
  if (runs === null) {
    return { live: false, pending: false, words: `${merged}; the site updates a few minutes after a merge.`, href: null };
  }
  const run = runs.find((r) => r.name === SITE_WORKFLOW && r.event === "push");
  if (!run) return { live: false, pending: true, words: `${merged}; the site's build has not started yet.`, href: null };
  if (run.status !== "completed") {
    return { live: false, pending: true, words: `${merged}; building and deploying the site now.`, href: run.html_url };
  }
  if (run.conclusion === "success") {
    return { live: true, pending: false, words: `Live on the site since ${when(run.updated_at)}.`, href: run.html_url };
  }
  return { live: false, pending: false, words: `${merged}, but the site's checks or deploy failed: see the run.`,
           href: run.html_url };
}

/** The runs for a commit; null when GitHub cannot be asked (offline, or the limit reached). */
export async function runsFor(sha: string): Promise<Run[] | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=10`,
                          { headers: { accept: "application/vnd.github+json" } });
    if (!r.ok) return null;
    return ((await r.json()) as { workflow_runs?: Run[] }).workflow_runs ?? [];
  } catch {
    return null;
  }
}
