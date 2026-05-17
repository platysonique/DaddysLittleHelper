import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(__dirname, "..");
export const DATA_DIR = resolve(PROJECT_ROOT, "data");
export const THREAD_DIR = resolve(DATA_DIR, "threads");
export const WORKSPACES_FILE = resolve(DATA_DIR, "workspaces.json");
export const SETTINGS_FILE = resolve(DATA_DIR, "settings.json");

export const DEFAULT_HOST = process.env.DLH_HOST || "127.0.0.1";
export const DEFAULT_PORT = Number(process.env.DLH_PORT || 3847);
export const DEFAULT_MODEL = process.env.DLH_MODEL || "auto";
export const AGENT_BIN = process.env.DLH_AGENT_BIN || "agent";

export const DEFAULT_WORKSPACE = {
  id: "daddyslittlehelper",
  name: "DaddysLittleHelper",
  path: PROJECT_ROOT
};
