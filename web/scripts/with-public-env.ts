// Run a command with web/.env's PUBLIC_ variables in its environment.
//
//   node scripts/with-public-env.ts astro build
//
// web/.env is mounted from 1Password as a named pipe; Vite skips anything that
// is not a regular file, so the build would silently fall back to local image
// paths. Only PUBLIC_ variables are passed on (see src/lib/publicEnv.ts); a
// variable already set in the environment wins over the file.
//
// Two failures are made loud rather than silent: 1Password not serving the pipe
// (locked, or an approval prompt unanswered) times out with instructions, and a
// production build without PUBLIC_ASSET_BASE refuses to run -- it would publish
// pages whose images point at local paths.
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { publicEntries } from "../src/lib/publicEnv.ts";

const PIPE_TIMEOUT_MS = 30_000;
const envFile = fileURLToPath(new URL("../.env", import.meta.url));

async function readEnvFile(): Promise<Record<string, string>> {
  if (!existsSync(envFile)) return {};
  if (!statSync(envFile).isFIFO()) return publicEntries(await readFile(envFile, "utf8"));
  console.error("Reading web/.env from 1Password -- approve the prompt in the 1Password app if one appears.");
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error("timeout")), PIPE_TIMEOUT_MS).unref();
  });
  try {
    return publicEntries(await Promise.race([readFile(envFile, "utf8"), timeout]));
  } catch {
    console.error(
      `1Password did not serve web/.env within ${PIPE_TIMEOUT_MS / 1000}s. Unlock 1Password, ` +
      "approve its prompt for the Cantus Organi Environment, then run this again.");
    process.exit(1);
  }
}

const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("usage: node scripts/with-public-env.ts <command> [args...]");
  process.exit(2);
}
const env = { ...(await readEnvFile()), ...process.env };
if (args.includes("build") && !env["PUBLIC_ASSET_BASE"]) {
  console.error(
    "PUBLIC_ASSET_BASE is not set: the build would link local image paths. Check web/.env " +
    "(1Password, Cantus Organi Environment) or set it in the environment.");
  process.exit(1);
}
if (env["PUBLIC_MEI_MANIFEST"] === "fixture" && /^https?:\/\//.test(env["PUBLIC_ASSET_BASE"] ?? "")) {
  console.error(
    "PUBLIC_MEI_MANIFEST=fixture is for e2e builds only, and PUBLIC_ASSET_BASE is a remote " +
    "(production) base: the site would offer unapproved conversions. Unset PUBLIC_MEI_MANIFEST.");
  process.exit(1);
}
const result = spawnSync(command, args, { stdio: "inherit", env });
// The pipe read may still be pending in the background; do not wait for it.
process.exit(result.status ?? 1);
