/**
 * Publishing a batch: the admin screen asks GitHub to run the corrections-batch
 * workflow (.github/workflows/corrections-batch.yml), which records the batch
 * and opens a pull request. The heavy work -- checking every entry against the
 * catalogue, regenerating catalog.json -- runs in GitHub Actions, never inside
 * the request, whose CPU time is capped.
 *
 * It signs in as the GitHub App: a short-lived JWT from the App's private key,
 * exchanged for an installation token scoped to the one repository.
 */
import { importSigningKey, signJwt } from "./crypto";

export interface GithubEnv {
  /** "npadley/cantusorgani" */
  readonly GITHUB_REPO?: string;
  readonly GITHUB_APP_ID?: string;
  readonly GITHUB_INSTALLATION_ID?: string;
  readonly GITHUB_APP_PRIVATE_KEY?: string;
}

export interface BatchEntry {
  readonly target: string;
  readonly field: string;
  readonly value: string;
  readonly note: string;
  readonly source: string;
  readonly editor_email: string;
  /** A review's: what the editor was shown, so the batch refuses a review of something since changed. */
  readonly seen?: string;
}

export interface Batch { readonly batch: string; readonly entries: readonly BatchEntry[] }

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const API = "https://api.github.com";

export function githubConfigured(env: GithubEnv): boolean {
  return Boolean(env.GITHUB_REPO && env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
}

/** A batch id: sortable by time, unguessable enough to name a branch. */
export function newBatchId(now: Date = new Date(), random: () => number = Math.random): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const tail = Array.from({ length: 6 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]).join("");
  return `b-${stamp}-${tail}`;
}

function headers(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
           "x-github-api-version": "2022-11-28", "user-agent": "cantusorgani-admin" };
}

export async function installationToken(env: GithubEnv, fetcher: Fetch = fetch, now: number = Date.now()): Promise<string> {
  const key = await importSigningKey(env.GITHUB_APP_PRIVATE_KEY ?? "");
  const issued = Math.floor(now / 1000) - 60;      // GitHub allows for clock drift
  const jwt = await signJwt({ iat: issued, exp: issued + 540, iss: env.GITHUB_APP_ID }, key);
  const response = await fetcher(`${API}/app/installations/${env.GITHUB_INSTALLATION_ID}/access_tokens`,
                                 { method: "POST", headers: headers(jwt) });
  if (!response.ok) throw new Error(`GitHub refused the App's sign-in (HTTP ${response.status})`);
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error("GitHub returned no installation token");
  return body.token;
}

/** Starts the corrections-batch workflow; GitHub answers 204 and runs it. */
export async function dispatchBatch(env: GithubEnv, batch: Batch, fetcher: Fetch = fetch): Promise<void> {
  const token = await installationToken(env, fetcher);
  const response = await fetcher(`${API}/repos/${env.GITHUB_REPO}/dispatches`, {
    method: "POST", headers: { ...headers(token), "content-type": "application/json" },
    body: JSON.stringify({ event_type: "corrections-batch", client_payload: batch }),
  });
  if (response.status !== 204) throw new Error(`GitHub did not start the workflow (HTTP ${response.status})`);
}

/** Closes a batch's pull request, saying why. Used when the site's checks fail
 * on it: the batch goes back to the admin screen rather than sitting open. */
export async function closePullRequest(env: GithubEnv, pr: number, why: string, fetcher: Fetch = fetch): Promise<void> {
  const token = await installationToken(env, fetcher);
  const base = `${API}/repos/${env.GITHUB_REPO}`;
  const send = { ...headers(token), "content-type": "application/json" };
  const comment = await fetcher(`${base}/issues/${pr}/comments`, { method: "POST", headers: send, body: JSON.stringify({ body: why }) });
  if (!comment.ok) throw new Error(`GitHub refused the comment on PR #${pr} (HTTP ${comment.status})`);
  const closed = await fetcher(`${base}/pulls/${pr}`, { method: "PATCH", headers: send, body: JSON.stringify({ state: "closed" }) });
  if (!closed.ok) throw new Error(`GitHub did not close PR #${pr} (HTTP ${closed.status})`);
}

/** An authenticated repository client reused across one operation. */
export async function githubClient(env: GithubEnv, fetcher: Fetch = fetch): Promise<(path: string, init?: RequestInit) => Promise<unknown>> {
  const token = await installationToken(env, fetcher);
  return async (path, init = {}) => {
    const response = await fetcher(`${API}/repos/${env.GITHUB_REPO}/${path}`, {
      ...init, headers: { ...headers(token), "content-type": "application/json" },
    });
    if (!response.ok) throw new Error(`GitHub request failed (HTTP ${response.status})`);
    return response.status === 204 ? null : response.json();
  };
}

export async function readMain(env: GithubEnv, fetcher: Fetch = fetch): Promise<{ commitSha: string; treeSha: string }> {
  const request = await githubClient(env, fetcher);
  const ref = await request("git/ref/heads/main") as { object?: { sha?: string } };
  const commitSha = ref.object?.sha ?? "";
  if (!/^[0-9a-f]{40}$/.test(commitSha)) throw new Error("GitHub returned an invalid main revision");
  const commit = await request(`git/commits/${commitSha}`) as { tree?: { sha?: string } };
  const treeSha = commit.tree?.sha ?? "";
  if (!/^[0-9a-f]{40}$/.test(treeSha)) throw new Error("GitHub returned an invalid tree revision");
  return { commitSha, treeSha };
}

export async function readSource(env: GithubEnv, file: string, ref: string, fetcher: Fetch = fetch): Promise<{ text: string; blobSha: string }> {
  const { isTypesetFile } = await import("../../../../workers/corrections/src/schema");
  const { validSourceSize } = await import("./sourceCheck");
  if (!isTypesetFile(file) || !/^(main|[0-9a-f]{40})$/.test(ref)) throw new Error("Invalid source path or revision");
  const request = await githubClient(env, fetcher);
  const body = await request(`contents/data/typeset/src/${file.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`) as
    { type?: string; encoding?: string; sha?: string; content?: string; size?: number };
  if (body.type !== "file" || body.encoding !== "base64" || typeof body.content !== "string" || !/^[0-9a-f]{40}$/.test(body.sha ?? "") || (body.size ?? 0) > 60 * 1024) {
    throw new Error("GitHub returned invalid or oversized source");
  }
  const bytes = Uint8Array.from(atob(body.content.replace(/\s/g, "")), (c) => c.charCodeAt(0));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!validSourceSize(text)) throw new Error("Source exceeds 60 KiB");
  return { text, blobSha: body.sha! };
}
