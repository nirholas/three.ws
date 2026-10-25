#!/usr/bin/env node
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";

function quoteForShell(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function platformOpenCommand(targetPath, { reveal = false } = {}) {
  if (reveal) {
    switch (process.platform) {
      case "darwin":
        return { command: "open", args: ["-R", targetPath], display: `open -R ${quoteForShell(targetPath)}` };
      case "win32":
        return {
          command: "explorer.exe",
          args: [`/select,${targetPath}`],
          display: `explorer /select,${quoteForShell(targetPath)}`
        };
      default: {
        const folderPath = path.dirname(targetPath);
        return { command: "xdg-open", args: [folderPath], display: `xdg-open ${quoteForShell(folderPath)}` };
      }
    }
  }

  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [targetPath], display: `open ${quoteForShell(targetPath)}` };
    case "win32":
      return { command: "explorer.exe", args: [targetPath], display: `explorer ${quoteForShell(targetPath)}` };
    default:
      return { command: "xdg-open", args: [targetPath], display: `xdg-open ${quoteForShell(targetPath)}` };
  }
}

async function main() {
  const target = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!target) throw new Error("Usage: node show-path.mjs [--reveal] <file-or-folder>");

  const targetPath = path.resolve(target);
  await access(targetPath);

  const reveal = process.argv.includes("--reveal");
  const openCommand = platformOpenCommand(targetPath, { reveal });
  console.log(`Path: ${targetPath}`);
  console.log(`Fallback command: ${openCommand.display}`);

  if (process.argv.includes("--print-only") || process.env.CI) {
    return;
  }

  const child = spawn(openCommand.command, openCommand.args, {
    detached: true,
    stdio: "ignore"
  });

  child.on("error", (error) => {
    console.error(`Could not open path automatically: ${error.message}`);
    process.exitCode = 1;
  });

  child.unref();
  await new Promise((resolve) => setTimeout(resolve, 100));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
