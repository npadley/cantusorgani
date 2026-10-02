import { beforeAll, expect, it } from "vitest";
import { readMain, readSource } from "./github";
import { keyPair } from "./testing";
import type { GithubEnv } from "./github";
let env: GithubEnv;
beforeAll(async () => { env = { GITHUB_REPO: "org/repo", GITHUB_APP_ID: "1", GITHUB_INSTALLATION_ID: "2", GITHUB_APP_PRIVATE_KEY: (await keyPair()).pem }; });
const sha = "a".repeat(40);
function stub(body: unknown, status = 200) {
  const calls: string[] = [];
  return { calls, fetcher: async (url: string) => {
    calls.push(url);
    return url.endsWith("/access_tokens") ? Response.json({ token: "private-token" }) : Response.json(body, { status });
  } };
}
it("loads UTF-8 source at an exact repository revision", async () => {
  const s = stub({ type: "file", encoding: "base64", sha, content: Buffer.from("Kýrie æternam").toString("base64") });
  expect(await readSource(env, "vol-5/x.ly", sha, s.fetcher)).toEqual({ text: "Kýrie æternam", blobSha: sha });
  expect(s.calls[1]).toBe(`https://api.github.com/repos/org/repo/contents/data/typeset/src/vol-5/x.ly?ref=${sha}`);
});
it.each([{ type: "dir" }, { type: "file", encoding: "base64", sha: "bad", content: "YQ==" },
  { type: "file", encoding: "base64", sha, content: Buffer.from("a".repeat(61441)).toString("base64") }])("refuses invalid or oversized repository source", async (body) => {
  const s = stub(body); await expect(readSource(env, "vol-5/x.ly", sha, s.fetcher)).rejects.toThrow();
});
it("refuses traversal without fetching", async () => {
  const s = stub({}); await expect(readSource(env, "../x.ly", sha, s.fetcher)).rejects.toThrow(); expect(s.calls).toEqual([]);
});
it("reports missing source without exposing response bodies", async () => {
  const s = stub({ secret: "private" }, 404); await expect(readSource(env, "vol-5/x.ly", sha, s.fetcher)).rejects.toThrow(/404/);
});
it("captures main and its tree", async () => {
  const fetcher = async (url: string) => Response.json(url.endsWith("access_tokens") ? { token: "token" }
    : url.includes("/git/ref/") ? { object: { sha } } : { tree: { sha: "b".repeat(40) } });
  expect(await readMain(env, fetcher)).toEqual({ commitSha: sha, treeSha: "b".repeat(40) });
});
