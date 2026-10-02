#!/usr/bin/env node

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npm, ["--prefix", projectRoot, "run", "dcf", "--", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(`Could not start DCF Builder: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
