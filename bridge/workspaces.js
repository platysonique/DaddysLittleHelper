import { stat } from "node:fs/promises";
import { DEFAULT_WORKSPACE, WORKSPACES_FILE } from "./config.js";
import { readJson, slugify, writeJson } from "./json-store.js";

function normalizeWorkspace(input) {
  const path = String(input.path || "").trim();
  if (!path.startsWith("/")) {
    throw new Error("Workspace path must be absolute.");
  }

  return {
    id: input.id || slugify(`${input.name || path}-${path}`),
    name: input.name || path.split("/").filter(Boolean).at(-1) || path,
    path
  };
}

export async function loadWorkspaces() {
  const current = await readJson(WORKSPACES_FILE, null);
  if (Array.isArray(current) && current.length > 0) return current;
  await writeJson(WORKSPACES_FILE, [DEFAULT_WORKSPACE]);
  return [DEFAULT_WORKSPACE];
}

export async function addWorkspace(input) {
  const workspace = normalizeWorkspace(input);
  const info = await stat(workspace.path).catch(() => null);
  if (!info?.isDirectory()) {
    throw new Error(`Workspace does not exist or is not a directory: ${workspace.path}`);
  }

  const workspaces = await loadWorkspaces();
  const withoutDuplicate = workspaces.filter((item) => item.path !== workspace.path && item.id !== workspace.id);
  const next = [...withoutDuplicate, workspace].sort((a, b) => a.name.localeCompare(b.name));
  await writeJson(WORKSPACES_FILE, next);
  return workspace;
}

export async function resolveWorkspace(idOrPath) {
  const workspaces = await loadWorkspaces();
  const requested = idOrPath || DEFAULT_WORKSPACE.id;
  return workspaces.find((item) => item.id === requested || item.path === requested) || DEFAULT_WORKSPACE;
}
