// Run a command with web/.env's PUBLIC_ variables in its environment.
//
//   node scripts/with-public-env.ts astro build
//
// web/.env is mounted from 1Password as a named pipe; Vite skips anything that
// is not a regular file, so the build would silently fall back to local image
// paths. Only PUBLIC_ variables are passed on (see src/lib/publicEnv.ts); a
// variable already set in the environment wins over the file.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { publicEntries } from "../src/lib/publicEnv.ts";

const envFile = fileURLToPath(new URL("../.env", import.meta.url));
const fromFile = existsSync(envFile) ? publicEntries(readFileSync(envFile, "utf8")) : {};
const [command, ...args] = process.argv.slice(2);
if (command === undefined) {
  console.error("usage: node scripts/with-public-env.ts <command> [args...]");
  process.exit(2);
}
const result = spawnSync(command, args, {
  stdio: "inherit",
  env: { ...fromFile, ...process.env },
});
process.exit(result.status ?? 1);
