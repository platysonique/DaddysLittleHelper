#!/usr/bin/env node
/**
 * Bridge service is installed only by ./install.sh (all-in-one).
 * This entrypoint re-runs the same install path for npm scripts.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installSh = join(root, "install.sh");

const result = spawnSync("bash", [installSh, "--no-pull", "--skip-doctor", "--bridge-only"], {
  stdio: "inherit",
  env: { ...process.env, DLH_ROOT: root }
});

process.exit(result.status ?? 1);
