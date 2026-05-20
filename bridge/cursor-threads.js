import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { AGENT_BIN } from "./config.js";
import { readJsonValue, querySqlite, writeJsonValue } from "./cursor-db.js";

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

function projectBasename(workspacePath) {
  return normalizePath(workspacePath).split("/").filter(Boolean).at(-1) || "";
}

function workspaceUri(workspacePath) {
  const path = normalizePath(workspacePath);
  return {
    $mid: 1,
    fsPath: path,
    external: `file://${path}`,
    path,
    scheme: "file"
  };
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

async function transcriptRootsForWorkspace(workspacePath) {
  const selectedSlug = projectSlug(workspacePath);
  const basename = projectBasename(workspacePath);
  const projectsRoot = join(CURSOR_HOME, "projects");
  let entries = [];
  try {
    entries = await readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [join(projectsRoot, selectedSlug, "agent-transcripts")];
  }
  const roots = entries
    .filter((entry) => entry.isDirectory() && (entry.name === selectedSlug || entry.name.endsWith(`-${basename}`)))
    .map((entry) => join(projectsRoot, entry.name, "agent-transcripts"));
  return [...new Set(roots)];
}

function extractUserQuery(text) {
  const match = String(text || "").match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/i);
  return (match ? match[1] : text).replace(/\s+/g, " ").trim();
}

function titleFromText(text) {
  const cleaned = extractUserQuery(text);
  if (!cleaned || /^reply with exactly:/i.test(cleaned) || /^resume_ok/i.test(cleaned)) return "";
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

async function titleFromTranscript(filePath) {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return "";
  }
  for (const line of raw.split("\n").slice(0, 120)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.role !== "user") continue;
    const content = event.message?.content;
    if (!Array.isArray(content)) continue;
    const text = content.map((block) => block?.text || "").join(" ").trim();
    const title = titleFromText(text);
    if (title) return title;
  }
  return "";
}

async function listTranscriptThreads(workspacePath) {
  const roots = await transcriptRootsForWorkspace(workspacePath);
  let entries = [];
  for (const transcriptsRoot of roots) {
    let rootEntries = [];
    try {
      rootEntries = await readdir(transcriptsRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue;
      const transcriptPath = join(transcriptsRoot, entry.name, `${entry.name}.jsonl`);
      const info = await stat(transcriptPath).catch(() => null);
      entries.push({
        id: entry.name,
        title: await titleFromTranscript(transcriptPath) || "Cursor thread",
        source: "cursor-transcript",
        createdAt: null,
        updatedAt: info?.mtime ? info.mtime.toISOString() : null,
        transcriptPath
      });
    }
  }
  return entries;
}

function mergeThreads(items) {
  const byId = new Map();
  const titlePriority = {
    "cursor-agent-project": 4,
    "cursor-chat-store": 3,
    "cursor-transcript": 1
  };
  const isGenericTitle = (title) =>
    !title || title === "Cursor thread" || title === "Untitled Cursor thread" || title === "New Agent";
  const betterTitle = (candidate, existing) => {
    if (isGenericTitle(candidate.title)) return existing.title;
    if (isGenericTitle(existing.title)) return candidate.title;
    const candidatePriority = titlePriority[candidate.source] || 0;
    const existingPriority = titlePriority[existing.titleSource] || titlePriority[existing.source] || 0;
    if (candidatePriority >= existingPriority) return candidate.title;
    return existing.title;
  };

  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, { ...item, titleSource: item.source, sources: [item.source] });
      continue;
    }
    const title = betterTitle(item, existing);
    byId.set(item.id, {
      ...existing,
      ...item,
      title,
      titleSource: title === item.title ? item.source : existing.titleSource,
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
  const selectedBasename = projectBasename(selectedPath);
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
      return workspacePathMatches(selectedPath, path) || projectBasename(path) === selectedBasename;
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
  const fromTranscripts = await listTranscriptThreads(selectedPath);

  return mergeThreads([...fromGlass, ...fromStore, ...fromTranscripts]);
}

export async function renameCursorThread({ workspacePath, threadId, title }) {
  const selectedPath = normalizePath(workspacePath);
  const nextTitle = String(title || "").replace(/\s+/g, " ").trim();
  if (!threadId) throw new Error("Missing Cursor thread id.");
  if (!nextTitle) throw new Error("Thread name cannot be empty.");
  if (nextTitle.length > 120) throw new Error("Thread name must be 120 characters or less.");

  let glassProjects = [];
  try {
    glassProjects = await readJsonValue(CURSOR_GLOBAL_DB, "glass.localAgentProjects.v1");
  } catch {
    glassProjects = [];
  }
  if (!Array.isArray(glassProjects)) glassProjects = [];

  const now = Date.now();
  const existing = glassProjects.find((project) => project.id === threadId);
  if (existing) {
    existing.name = nextTitle;
    existing.lastUpdatedAt = now;
  } else {
    glassProjects.push({
      id: threadId,
      name: nextTitle,
      workspace: {
        id: workspaceHash(selectedPath),
        uri: workspaceUri(selectedPath)
      },
      createdAt: now,
      lastUpdatedAt: now,
      isArchived: false
    });
  }

  const { backupPath } = await writeJsonValue(CURSOR_GLOBAL_DB, "glass.localAgentProjects.v1", glassProjects);
  return { id: threadId, title: nextTitle, backupPath };
}
