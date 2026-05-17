import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const CURSOR_HOME = process.env.CURSOR_HOME || join(homedir(), ".cursor");

function normalizePath(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return resolve(raw.replace(/^file:\/\//, ""));
}

function projectSlug(workspacePath) {
  return normalizePath(workspacePath).slice(1).replace(/\//g, "-");
}

function extractText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .join("")
    .trim();
}

function cleanDisplayText(text) {
  return String(text || "")
    .replace(/<\/?user_query>/gi, "")
    .replace(/<\/?assistant_query>/gi, "")
    .trim();
}

export async function loadCursorTranscript({ workspacePath, threadId }) {
  const slug = projectSlug(workspacePath);
  const filePath = join(
    CURSOR_HOME,
    "projects",
    slug,
    "agent-transcripts",
    threadId,
    `${threadId}.jsonl`
  );

  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return { threadId, messages: [], transcriptPath: filePath, found: false };
  }

  const messages = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const role = event.role === "assistant" ? "assistant" : "user";
    const text = cleanDisplayText(extractText(event.message?.content));
    if (!text) continue;
    messages.push({ role, content: text });
  }

  return { threadId, messages, transcriptPath: filePath, found: messages.length > 0 };
}
