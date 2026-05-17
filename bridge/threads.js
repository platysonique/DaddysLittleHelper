import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { THREAD_DIR } from "./config.js";
import { readJson, slugify, writeJson } from "./json-store.js";

function now() {
  return new Date().toISOString();
}

function threadId({ workspaceId, vivaldiWorkspaceId, tabId, title }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return slugify([workspaceId, vivaldiWorkspaceId || "browser", tabId || "tab", title || "thread", stamp].join("-"));
}

function threadPath(id) {
  return resolve(THREAD_DIR, `${slugify(id)}.json`);
}

export async function createThread(input) {
  await mkdir(THREAD_DIR, { recursive: true });
  const id = input.id || threadId(input);
  const thread = {
    id,
    title: input.title || input.context?.title || "New thread",
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    vivaldiWorkspaceId: input.vivaldiWorkspaceId || input.context?.workspaceId || null,
    tab: input.context?.tab || null,
    model: input.model || "auto",
    createdAt: now(),
    updatedAt: now(),
    messages: []
  };
  await writeJson(threadPath(id), thread);
  return thread;
}

export async function loadThread(id) {
  return readJson(threadPath(id), null);
}

export async function saveThread(thread) {
  thread.updatedAt = now();
  await writeJson(threadPath(thread.id), thread);
  return thread;
}

export async function appendMessage(thread, message) {
  const next = {
    ...message,
    at: message.at || now()
  };
  thread.messages.push(next);
  await saveThread(thread);
  return next;
}

export async function listThreads({ workspaceId } = {}) {
  await mkdir(THREAD_DIR, { recursive: true });
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(THREAD_DIR);
  const threads = [];
  for (const file of files.filter((item) => item.endsWith(".json"))) {
    const thread = await readJson(resolve(THREAD_DIR, file), null);
    if (!thread) continue;
    if (workspaceId && thread.workspaceId !== workspaceId) continue;
    threads.push({
      id: thread.id,
      title: thread.title,
      workspaceId: thread.workspaceId,
      workspacePath: thread.workspacePath,
      vivaldiWorkspaceId: thread.vivaldiWorkspaceId,
      tab: thread.tab,
      model: thread.model,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messageCount: thread.messages?.length || 0
    });
  }
  return threads.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
