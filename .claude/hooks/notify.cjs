#!/usr/bin/env node
/**
 * Notification hook: cross-platform desktop notification.
 * Supports macOS (osascript), Linux (notify-send), and Windows (PowerShell).
 * Fails open — notification errors are silently ignored.
 */
"use strict";

const { execFileSync } = require("child_process");
const os = require("os");

function sanitize(str) {
  return str.replace(/[^\w\s.,!?:;\-()]/g, "");
}

function notify(title, message) {
  const platform = os.platform();
  const safeTitle = sanitize(title);
  const safeMessage = sanitize(message);

  if (platform === "darwin") {
    execFileSync("osascript", [
      "-e",
      `display notification "${safeMessage}" with title "${safeTitle}"`,
    ], { stdio: "ignore", timeout: 5000 });
  } else if (platform === "linux") {
    execFileSync("notify-send", [safeTitle, safeMessage], {
      stdio: "ignore",
      timeout: 5000,
    });
  } else if (platform === "win32") {
    execFileSync("powershell.exe", [
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${safeMessage}', '${safeTitle}', 'OK', 'Information')`,
    ], { stdio: "ignore", timeout: 5000 });
  }
}

async function main() {
  try {
    let data = "";
    for await (const chunk of process.stdin) data += chunk;
    const input = JSON.parse(data);

    const message = input?.message ?? "Needs your attention";
    notify("Claude Code", message);
  } catch {
    // Fail open — notification errors should never block work
  }
}

main();
