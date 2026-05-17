import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { AGENT_BIN } from "./config.js";
import { readJsonValue, querySqlite } from "./cursor-db.js";

const execFileAsync = promisify(execFile);

const CURSOR_HOME = process.env.CURSOR_HOME || join(homedir(), ".cursor");
const CURSOR_GLOBAL_DB = join(
  homedir(),
  ".config",
  "Cursor",
  "User",
  "globalStorage",
  "state.vscdb"
);

function normalizePath(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return resolve(raw.replace(/^file:\/\//, ""));
}

function workspacePathMatches(selectedPath, projectPath) {
  const selected = normalizePath(selectedPath);
  const project = normalizePath(projectPath);
  if (!selected || !project) return false;
  if (selected === project) return true;
  if (project.endsWith(".code-workspace") && selected === resolve(project, "..")) return true;
  return false;
}

function workspaceHash(workspacePath) {
  return createHash("md5").update(normalizePath(workspacePath)).digest("hex");
}

function projectSlug(workspacePath) {
  return normalizePath(workspacePath).slice(1).replace(/\//g, "-");
}

async function readChatStoreMeta(chatDbPath) {
  try {
    const raw = await querySqlite(chatDbPath, "SELECT value FROM meta WHERE key='0' LIMIT 1;");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      if (/^[0-9a-f]+$/i.test(raw) && raw.length % 2 === 0) {
        return JSON.parse(Buffer.from(raw, "hex").toString("utf8"));
      }
      return null;
    }
  } catch {
    return null;
  }
}

async function listFilesystemChats(workspacePath) {
  const root = join(CURSOR_HOME, "chats", workspaceHash(workspacePath));
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const threads = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const storePath = join(root, entry.name, "store.db");
    const info = await stat(storePath).catch(() => null);
    if (!info?.isFile()) continue;
    const meta = await readChatStoreMeta(storePath);
    threads.push({
      id: entry.name,
      title: meta?.name || meta?.title || "Untitled Cursor thread",
      source: "cursor-chat-store",
      createdAt: meta?.createdAt ? new Date(meta.createdAt).toISOString() : null,
      updatedAt: meta?.createdAt ? new Date(meta.createdAt).toISOString() : null
    });
  }
  return threads;
}

async function listTranscriptThreadIds(workspacePath) {
  const transcriptsRoot = join(CURSOR_HOME, "projects", projectSlug(workspacePath), "agent-transcripts");
  let entries = [];
  try {
    entries = await readdir(transcriptsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function mergeThreads(items) {
  const byId = new Map();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, { ...item, sources: [item.source] });
      continue;
    }
    const preferTitle = (candidate, fallback) => {
      if (!candidate || candidate === "Cursor thread" || candidate === "Untitled Cursor thread" || candidate === "New Agent") {
        return fallback;
      }
      return candidate;
    };
    byId.set(item.id, {
      ...existing,
      ...item,
      title: preferTitle(item.title, existing.title),
      updatedAt: item.updatedAt || existing.updatedAt,
      createdAt: item.createdAt || existing.createdAt,
      sources: [...new Set([...(existing.sources || []), item.source])]
    });
  }
  return [...byId.values()].sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export async function createCursorChat() {
  const { stdout } = await execFileAsync(AGENT_BIN, ["create-chat"], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024
  });
  const chatId = stdout.trim();
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) {
    throw new Error(`create-chat returned unexpected output: ${chatId}`);
  }
  return chatId;
}

export async function listCursorThreads(workspacePath) {
  const selectedPath = normalizePath(workspacePath);
  let glassProjects = [];
  try {
    glassProjects = await readJsonValue(CURSOR_GLOBAL_DB, "glass.localAgentProjects.v1");
  } catch {
    glassProjects = [];
  }
  if (!Array.isArray(glassProjects)) glassProjects = [];

  const fromGlass = glassProjects
    .filter((project) => {
      const ws = project.workspace || {};
      const uri = ws.uri || ws.configPath || {};
      const path = uri.fsPath || uri.path || "";
      return workspacePathMatches(selectedPath, path);
    })
    .map((project) => ({
      id: project.id,
      title: project.name || "Untitled Cursor thread",
      source: "cursor-agent-project",
      createdAt: project.createdAt ? new Date(project.createdAt).toISOString() : null,
      updatedAt: project.lastUpdatedAt ? new Date(project.lastUpdatedAt).toISOString() : null,
      archived: Boolean(project.isArchived)
    }));

  const fromStore = await listFilesystemChats(selectedPath);
  const transcriptIds = await listTranscriptThreadIds(selectedPath);
  const fromTranscripts = transcriptIds.map((id) => ({
    id,
    title: "Cursor thread",
    source: "cursor-transcript",
    createdAt: null,
    updatedAt: null
  }));

  return mergeThreads([...fromGlass, ...fromStore, ...fromTranscripts]);
}
