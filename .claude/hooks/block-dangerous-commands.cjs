#!/usr/bin/env node
/**
 * PreToolUse hook: blocks dangerous shell commands before execution.
 * Exit 0 = allow, Exit 2 = block.
 * Fails open on errors (exit 0) so a hook bug never stalls the session.
 */
"use strict";

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,                          // rm -rf /
  /git\s+push\s+(-f|--force)\s+(origin\s+)?main/, // force push to main
  /git\s+reset\s+--hard/,                   // hard reset
  /DROP\s+(TABLE|DATABASE)/i,               // SQL drop
  /TRUNCATE\s+/i,                           // SQL truncate
];

async function main() {
  try {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    const input = JSON.parse(data);

    const cmd = input?.tool_input?.command ?? "";
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(cmd)) {
        console.error(`BLOCKED: dangerous command detected — ${cmd}`);
        process.exit(2);
      }
    }

    process.exit(0);
  } catch {
    // Fail open — never block on hook errors
    process.exit(0);
  }
}

main();
