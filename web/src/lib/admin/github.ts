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
