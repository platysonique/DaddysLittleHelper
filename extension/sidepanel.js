import { renderMarkdown } from "./sidepanel-markdown.js";

const BRIDGE_URL = "http://127.0.0.1:3847";

const elements = {
  status: document.getElementById("bridge-status"),
  refresh: document.getElementById("refresh"),
  theme: document.getElementById("theme"),
  thread: document.getElementById("thread"),
  workspace: document.getElementById("workspace"),
  workspacePath: document.getElementById("workspace-path"),
  addWorkspace: document.getElementById("add-workspace"),
  model: document.getElementById("model"),
  target: document.getElementById("target"),
  tabs: document.getElementById("tabs"),
  permissionMode: document.getElementById("permission-mode"),
  context: document.getElementById("context"),
  contextSummary: document.getElementById("context-summary"),
  workspacePills: document.getElementById("workspace-pills"),
  messages: document.getElementById("messages"),
  form: document.getElementById("chat-form"),
  prompt: document.getElementById("prompt"),
  cancel: document.getElementById("cancel"),
  send: document.getElementById("send"),
  activity: document.getElementById("agent-activity"),
  activityList: document.getElementById("activity-list"),
  quickPrompts: document.getElementById("quick-prompts"),
  automationEnabled: document.getElementById("automation-enabled"),
  automationLabel: document.getElementById("automation-label")
};

let currentContext = null;
let currentWorkspaceTabs = [];
let currentCursorChatId = null;
let activeChatSessionId = null;
let activityPollTimer = null;
let activitySince = 0;

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

function addMessage(role, text, { markdown = role === "assistant" } = {}) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  if (markdown && text) {
    const body = document.createElement("div");
    body.className = "md";
    body.innerHTML = renderMarkdown(text);
    el.appendChild(body);
  } else {
    el.textContent = text;
  }
  elements.messages.appendChild(el);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return el;
}

function setTheme(theme) {
  const value = theme || "auto";
  elements.theme.value = value;
  document.documentElement.dataset.theme = value === "auto" ? "" : value;
}

function formatThreadWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function renderLoadedMessages(messages) {
  elements.messages.replaceChildren();
  if (!messages?.length) return;
  for (const message of messages) {
    addMessage(message.role === "assistant" ? "assistant" : "user", message.content || "", {
      markdown: message.role === "assistant"
    });
  }
}

function short(value, fallback = "None") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function renderPills({ workspaceId, tabCount }) {
  const pills = [
    `Workspace ${workspaceId || "unknown"}`,
    `${tabCount} tab${tabCount === 1 ? "" : "s"}`,
    elements.target.options[elements.target.selectedIndex]?.text || "Active tab"
  ];
  elements.workspacePills.replaceChildren(...pills.map((text) => {
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = text;
    return pill;
  }));
}

function renderContextSummary() {
  const page = currentContext?.page || {};
  const rows = [
    ["Target", elements.target.options[elements.target.selectedIndex]?.text || currentContext?.target],
    ["Tab", short(currentContext?.tab?.title || page.title)],
    ["URL", short(page.url || currentContext?.tab?.url)],
    [
      "Selection",
      page.selection ? short(page.selection, `${page.selection.length} chars`) : "No selected text"
    ],
    ["Page", page.excerpt ? `${page.excerpt.length} characters` : "No excerpt"],
    ["Project", elements.workspace.options[elements.workspace.selectedIndex]?.text || "Default project"]
  ];

  elements.contextSummary.replaceChildren();

  for (const [label, value] of rows) {
    const row = document.createElement("div");
    row.className = "summary-row";
    const key = document.createElement("strong");
    key.textContent = label;
    const text = document.createElement("span");
    text.textContent = value || "None";
    row.append(key, text);
    elements.contextSummary.appendChild(row);
  }

  if (page.outline?.length) {
    const heading = document.createElement("strong");
    heading.textContent = "Outline";
    const list = document.createElement("ul");
    list.className = "context-outline";
    for (const item of page.outline.slice(0, 6)) {
      const li = document.createElement("li");
      li.textContent = `${item.level}: ${item.text}`;
      list.appendChild(li);
    }
    elements.contextSummary.append(heading, list);
  }

  if (page.blocks?.length) {
    const heading = document.createElement("strong");
    heading.textContent = "Sample blocks";
    const list = document.createElement("ul");
    list.className = "context-outline";
    for (const block of page.blocks.slice(0, 3)) {
      const li = document.createElement("li");
      li.textContent = short(block, block);
      list.appendChild(li);
    }
    elements.contextSummary.append(heading, list);
  }
}

function pushActivity(text) {
  elements.activity.classList.remove("hidden");
  const item = document.createElement("li");
  item.textContent = text;
  elements.activityList.prepend(item);
  while (elements.activityList.children.length > 12) {
    elements.activityList.lastChild.remove();
  }
}

function clearActivity() {
  activitySince = Date.now();
  elements.activityList.replaceChildren();
  elements.activity.classList.add("hidden");
}

async function pollBrowserActivity() {
  try {
    const { activity } = await jsonFetch(`/browser/activity?since=${activitySince}`);
    for (const entry of activity || []) {
      if (entry.phase === "start") {
        pushActivity(`browser: ${entry.command}`);
      }
    }
    activitySince = Date.now();
  } catch {
    // ignore poll errors during chat
  }
}

function startActivityPoll() {
  clearActivity();
  activityPollTimer = setInterval(pollBrowserActivity, 700);
}

function stopActivityPoll() {
  if (activityPollTimer) clearInterval(activityPollTimer);
  activityPollTimer = null;
}

function setChatBusy(busy) {
  elements.send.disabled = busy;
  elements.prompt.disabled = busy;
  elements.cancel.classList.toggle("hidden", !busy);
}

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body}`);
  }
  return response.json();
}

function runtimeMessage(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadQuickPrompts() {
  const settings = await jsonFetch("/settings");
  elements.quickPrompts.replaceChildren();
  for (const item of settings.quickPrompts || []) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = item.label;
    btn.addEventListener("click", () => {
      elements.prompt.value = item.text;
      elements.prompt.focus();
    });
    elements.quickPrompts.appendChild(btn);
  }
}

function setAutomationUi(enabled) {
  const on = Boolean(enabled);
  elements.automationEnabled.checked = on;
  elements.automationLabel.textContent = on ? "On" : "Off";
  document.body.dataset.automation = on ? "on" : "off";
}

async function saveAutomationEnabled(enabled) {
  const on = Boolean(enabled);
  setAutomationUi(on);
  await jsonFetch("/settings", {
    method: "POST",
    body: JSON.stringify({ browserAutomationEnabled: on })
  });
  await chrome.storage.local.set({ dlhAutomationEnabled: on });
}

async function loadBridge() {
  const [health, browser, settings] = await Promise.all([
    jsonFetch("/health"),
    jsonFetch("/browser/status").catch(() => ({ connected: false, browserAutomationEnabled: false })),
    jsonFetch("/settings").catch(() => ({ browserAutomationEnabled: false }))
  ]);

  const automationOn = Boolean(settings.browserAutomationEnabled);
  setAutomationUi(automationOn);
  await chrome.storage.local.set({ dlhAutomationEnabled: automationOn });

  let automation;
  if (!automationOn) {
    automation = "automation OFF (security)";
  } else if (browser.automationActive) {
    automation = "automation ON · linked";
  } else if (browser.connected) {
    automation = "automation ON · waiting for Vivaldi";
  } else {
    automation = "automation ON · open Vivaldi";
  }
  elements.status.textContent = `${health.service} ready · ${automation}`;

  const [{ models }, { workspaces }] = await Promise.all([
    jsonFetch("/models"),
    jsonFetch("/workspaces")
  ]);

  elements.model.replaceChildren(...models.map((model) => option(model.id, model.label || model.id)));
  elements.workspace.replaceChildren(...workspaces.map((workspace) => option(workspace.id, `${workspace.name} — ${workspace.path}`)));

  const stored = await chrome.storage.local.get(["dlhModel", "dlhWorkspace", "dlhPermissionMode", "dlhTheme", "dlhCursorThread"]);
  if (stored.dlhModel) elements.model.value = stored.dlhModel;
  if (stored.dlhWorkspace) elements.workspace.value = stored.dlhWorkspace;
  if (stored.dlhPermissionMode) elements.permissionMode.value = stored.dlhPermissionMode;
  setTheme(stored.dlhTheme || "auto");

  await Promise.all([loadTabs(), loadQuickPrompts(), loadCursorThreads(stored.dlhCursorThread)]);
  await refreshContext();
}

async function loadCursorThreads(preferredThreadId) {
  const workspaceId = elements.workspace.value;
  const { threads } = await jsonFetch(`/cursor-threads?workspaceId=${encodeURIComponent(workspaceId)}`);
  const threadOptions = [
    option("", "New Cursor thread"),
    ...(threads || []).map((thread) => {
      const updated = formatThreadWhen(thread.updatedAt || thread.createdAt);
      const suffix = updated ? ` — ${updated}` : "";
      return option(thread.id, `${thread.title || thread.id}${suffix}`);
    })
  ];
  elements.thread.replaceChildren(...threadOptions);
  if (!threads?.length) {
    elements.thread.replaceChildren(
      option("", "New Cursor thread"),
      option("", "No Cursor threads found for this project yet")
    );
  }
  if (preferredThreadId && (threads || []).some((thread) => thread.id === preferredThreadId)) {
    elements.thread.value = preferredThreadId;
    await loadCursorThread(preferredThreadId);
  } else {
    elements.thread.value = "";
    currentCursorChatId = null;
    renderLoadedMessages([]);
  }
}

async function loadCursorThread(threadId) {
  if (!threadId) {
    currentCursorChatId = null;
    renderLoadedMessages([]);
    await chrome.storage.local.remove("dlhCursorThread");
    return;
  }
  currentCursorChatId = threadId;
  const workspaceId = elements.workspace.value;
  const transcript = await jsonFetch(
    `/cursor-threads/${encodeURIComponent(threadId)}/transcript?workspaceId=${encodeURIComponent(workspaceId)}`
  );
  renderLoadedMessages(transcript.messages || []);
  if (!transcript.found) {
    addMessage("event", "Cursor thread selected. Prior messages stay in Cursor; new prompts continue this thread.");
  }
  await chrome.storage.local.set({ dlhCursorThread: threadId });
}

async function loadTabs() {
  const result = await runtimeMessage({ type: "DLH_LIST_TABS", currentWorkspaceOnly: true });
  currentWorkspaceTabs = result.tabs || [];
  elements.tabs.replaceChildren(...currentWorkspaceTabs.map((tab) => {
    const title = tab.title || tab.url || tab.id;
    const marker = tab.active ? "• " : "";
    return option(String(tab.id), `${marker}${title}`);
  }));
  if (currentWorkspaceTabs.length === 0) {
    elements.tabs.replaceChildren(option("", "No tabs in current Vivaldi workspace"));
  }
  elements.tabs.dataset.workspaceId = result.currentWorkspaceId || "";
  renderPills({ workspaceId: result.currentWorkspaceId, tabCount: currentWorkspaceTabs.length });
}

async function refreshContext() {
  if (!elements.tabs.value && currentWorkspaceTabs[0]?.id) {
    elements.tabs.value = String(currentWorkspaceTabs[0].id);
  }
  const tabId = elements.target.value === "selected-tab" ? Number(elements.tabs.value) : undefined;
  currentContext = await runtimeMessage({ type: "DLH_GET_CONTEXT", tabId, target: elements.target.value });
  currentContext.target = elements.target.value;
  renderContextSummary();
  elements.context.textContent = JSON.stringify(currentContext, null, 2);
}

async function addWorkspace() {
  const path = elements.workspacePath.value.trim();
  if (!path) return;
  await jsonFetch("/workspaces", {
    method: "POST",
    body: JSON.stringify({ path })
  });
  elements.workspacePath.value = "";
  await loadBridge();
}

function parseSseChunk(buffer, onEvent) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() || "";
  for (const part of parts) {
    let event = "message";
    let data = "";
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      if (line.startsWith("data:")) data += line.slice(5).trim();
    }
    if (!data) continue;
    try {
      onEvent(event, JSON.parse(data));
    } catch {
      onEvent(event, data);
    }
  }
  return rest;
}

let assistantMarkdown = "";

function appendAssistantText(assistantEl, chunk) {
  assistantMarkdown += chunk;
  const body = assistantEl.querySelector(".md") || assistantEl;
  if (body.classList.contains("md")) {
    body.innerHTML = renderMarkdown(assistantMarkdown);
  } else {
    assistantEl.textContent = assistantMarkdown;
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

async function sendPrompt(event) {
  event.preventDefault();
  const message = elements.prompt.value.trim();
  if (!message) return;
  elements.prompt.value = "";
  await refreshContext();

  await chrome.storage.local.set({
    dlhModel: elements.model.value,
    dlhWorkspace: elements.workspace.value,
    dlhPermissionMode: elements.permissionMode.value,
    dlhTheme: elements.theme.value
  });

  addMessage("user", message);
  const assistant = addMessage("assistant", "");
  assistantMarkdown = "";
  setChatBusy(true);
  startActivityPoll();
  activeChatSessionId = null;

  const response = await fetch(`${BRIDGE_URL}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message,
      model: elements.model.value,
      workspaceId: elements.workspace.value,
      permissionMode: elements.permissionMode.value,
      cursorChatId: currentCursorChatId || elements.thread.value || undefined,
      context: currentContext
    })
  });

  if (!response.ok || !response.body) {
    assistant.textContent = await response.text();
    setChatBusy(false);
    stopActivityPoll();
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = parseSseChunk(buffer, (name, data) => {
        if (name === "chat-started") {
          activeChatSessionId = data.chatSessionId;
        } else if (name === "agent-event") {
          const text =
            data?.params?.update?.content?.text ||
            data?.message?.content?.map?.((block) => block.text || "").join("") ||
            data?.text ||
            "";
          if (text) appendAssistantText(assistant, text);
        } else if (name === "tool-activity") {
          pushActivity(`tool: ${data.tool}`);
        } else if (name === "fallback") {
          addMessage("event", `Fallback: ${data.reason}`);
        } else if (name === "cursor-thread" && data.cursorChatId) {
          currentCursorChatId = data.cursorChatId;
          elements.thread.value = data.cursorChatId;
          chrome.storage.local.set({ dlhCursorThread: data.cursorChatId });
          if (data.created) loadCursorThreads(data.cursorChatId).catch(() => {});
        } else if (name === "error") {
          addMessage("event", data.message || "Error");
        } else if (name === "done") {
          if (data.cancelled) addMessage("event", "Cancelled.");
        }
      });
    }
  } finally {
    setChatBusy(false);
    stopActivityPoll();
    activeChatSessionId = null;
  }
}

async function cancelChat() {
  if (!activeChatSessionId) return;
  await jsonFetch("/chat/cancel", {
    method: "POST",
    body: JSON.stringify({ chatSessionId: activeChatSessionId })
  });
  addMessage("event", "Cancelling…");
}

elements.automationEnabled.addEventListener("change", async () => {
  try {
    await saveAutomationEnabled(elements.automationEnabled.checked);
    await loadBridge();
  } catch (error) {
    elements.status.textContent = `Could not save automation setting: ${error.message}`;
    elements.automationEnabled.checked = !elements.automationEnabled.checked;
    setAutomationUi(elements.automationEnabled.checked);
  }
});

elements.refresh.addEventListener("click", loadBridge);
elements.addWorkspace.addEventListener("click", addWorkspace);
elements.theme.addEventListener("change", async () => {
  setTheme(elements.theme.value);
  await chrome.storage.local.set({ dlhTheme: elements.theme.value });
});
elements.thread.addEventListener("change", () => {
  loadCursorThread(elements.thread.value).catch((error) => {
    elements.status.textContent = `Cursor thread load failed: ${error.message}`;
  });
});
elements.workspace.addEventListener("change", async () => {
  await chrome.storage.local.set({ dlhWorkspace: elements.workspace.value });
  await loadCursorThreads();
  await refreshContext();
});
elements.target.addEventListener("change", async () => {
  await loadTabs();
  await refreshContext();
});
elements.tabs.addEventListener("change", refreshContext);
elements.form.addEventListener("submit", sendPrompt);
elements.cancel.addEventListener("click", cancelChat);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "DLH_TABS_CHANGED") return;
  loadTabs().then(refreshContext).catch((error) => {
    elements.status.textContent = `Tab refresh failed: ${error.message}`;
  });
});

loadBridge().catch((error) => {
  elements.status.textContent = `Bridge unavailable: ${error.message}`;
});
