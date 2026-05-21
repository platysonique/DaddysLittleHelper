import { renderMarkdown } from "./sidepanel-markdown.js";

const BRIDGE_URL = "http://127.0.0.1:3847";

const elements = {
  status: document.getElementById("bridge-status"),
  refresh: document.getElementById("refresh"),
  theme: document.getElementById("theme"),
  thread: document.getElementById("thread"),
  threadTitle: document.getElementById("thread-title"),
  renameThread: document.getElementById("rename-thread"),
  workspace: document.getElementById("workspace"),
  workspacePath: document.getElementById("workspace-path"),
  openWorkspace: document.getElementById("open-workspace"),
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
let currentCursorThreads = [];
let chatInFlight = false;

function option(value, label) {
  const item = document.createElement("option");
  item.value = value;
  item.textContent = label;
  return item;
}

const PROMPT_LEAK_RE =
  /You are DaddysLittleHelper|Hard constraints:|AGENT_PROJECT_RESUME|Selected project:|User request:/;

function sanitizeForDisplay(text) {
  if (!text) return "";
  const trimmed = String(text).trim();
  if (/^AGENT_PROJECT_RESUME\s*$/i.test(trimmed)) return "";
  if (trimmed.length > 80 && PROMPT_LEAK_RE.test(trimmed)) {
    const match = trimmed.match(/User request:\s*([\s\S]+)$/i);
    return match ? match[1].trim() : "";
  }
  return trimmed;
}

function friendlyFetchError(error) {
  const msg = error?.message || String(error || "");
  if (error?.name === "TypeError" && /fetch/i.test(msg)) {
    return "Bridge not running. In the project folder run: ./install.sh — then Restart Vivaldi and click Refresh.";
  }
  return msg || "Unknown error";
}

function addMessage(role, text, { markdown = role === "assistant" } = {}) {
  const isPlaceholder = role === "assistant" && !String(text || "").trim();
  if (!isPlaceholder) {
    text = sanitizeForDisplay(text);
    if (!text) return null;
  }
  const el = document.createElement("div");
  el.className = `message ${role}`;
  if (markdown) {
    const body = document.createElement("div");
    body.className = "md";
    body.innerHTML = isPlaceholder ? "" : renderMarkdown(text);
    el.appendChild(body);
  } else {
    el.textContent = isPlaceholder ? "" : text;
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
  elements.activity.open = true;
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
  pushActivity("Cursor: starting");
  activityPollTimer = setInterval(pollBrowserActivity, 700);
}

function stopActivityPoll() {
  if (activityPollTimer) clearInterval(activityPollTimer);
  activityPollTimer = null;
}

function setChatBusy(busy) {
  chatInFlight = Boolean(busy);
  elements.send.disabled = busy;
  elements.prompt.disabled = busy;
  elements.cancel.classList.toggle("hidden", !busy);
}

async function jsonFetch(path, options = {}) {
  let response;
  try {
    response = await fetch(`${BRIDGE_URL}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
  } catch (error) {
    throw new Error(friendlyFetchError(error));
  }
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body}`);
  }
  return response.json();
}

function setBridgeOfflineStatus(error) {
  const detail = error ? friendlyFetchError(error) : "Run ./install.sh, then Refresh";
  elements.status.textContent = `Bridge offline — ${detail}`;
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

async function syncAutomationToBridge(enabled) {
  await jsonFetch("/settings", {
    method: "POST",
    body: JSON.stringify({ browserAutomationEnabled: Boolean(enabled) })
  });
  await chrome.storage.local.set({ dlhAutomationPendingSync: false });
}

async function saveAutomationEnabled(enabled, { syncBridge = true } = {}) {
  const on = Boolean(enabled);
  setAutomationUi(on);
  await chrome.storage.local.set({ dlhAutomationEnabled: on });
  if (!syncBridge) return;
  await syncAutomationToBridge(on);
}

async function loadBridge() {
  let health;
  try {
    health = await jsonFetch("/health");
  } catch (error) {
    setBridgeOfflineStatus(error);
    return;
  }

  const [browser, settings] = await Promise.all([
    jsonFetch("/browser/status").catch(() => ({ connected: false, browserAutomationEnabled: false })),
    jsonFetch("/settings").catch(() => ({ browserAutomationEnabled: false }))
  ]);

  const prefs = await chrome.storage.local.get([
    "dlhAutomationEnabled",
    "dlhAutomationPendingSync",
    "dlhModel",
    "dlhWorkspace",
    "dlhPermissionMode",
    "dlhTheme",
    "dlhCursorThread"
  ]);
  const automationOn = prefs.dlhAutomationPendingSync
    ? Boolean(prefs.dlhAutomationEnabled)
    : Boolean(settings.browserAutomationEnabled);
  setAutomationUi(automationOn);
  await chrome.storage.local.set({ dlhAutomationEnabled: automationOn });
  if (prefs.dlhAutomationPendingSync) {
    try {
      await syncAutomationToBridge(automationOn);
    } catch {
      // keep pending until bridge accepts settings
    }
  }

  let automation;
  if (!automationOn) {
    automation = "automation OFF (security)";
  } else if (browser.status === "wrong_extension" || browser.status === "wrong_version") {
    const actual = browser.identity?.extensionId || "unknown";
    const expected = browser.expected?.extensionId || "unknown";
    automation = `automation blocked · wrong extension ${actual} (expected ${expected})`;
  } else if (browser.status === "unknown_extension") {
    automation = "automation blocked · extension identity missing";
  } else if (browser.automationActive) {
    automation = "automation ON · linked";
  } else if (browser.connected) {
    automation = "automation ON · waiting for Vivaldi";
  } else {
    automation = "automation ON · open Vivaldi";
  }
  elements.status.textContent = `${health.service} ready · ${automation}`;

  let models;
  let workspaces;
  try {
    [{ models }, { workspaces }] = await Promise.all([
      jsonFetch("/models"),
      jsonFetch("/workspaces")
    ]);
  } catch (error) {
    elements.status.textContent = `${health.service} ready (partial) — ${friendlyFetchError(error)}`;
    return;
  }

  elements.model.replaceChildren(...models.map((model) => option(model.id, model.label || model.id)));
  elements.workspace.replaceChildren(...workspaces.map((workspace) => option(workspace.id, `${workspace.name} — ${workspace.path}`)));

  if (prefs.dlhModel) elements.model.value = prefs.dlhModel;
  if (prefs.dlhWorkspace) elements.workspace.value = prefs.dlhWorkspace;
  if (prefs.dlhPermissionMode) elements.permissionMode.value = prefs.dlhPermissionMode;
  setTheme(prefs.dlhTheme || "auto");

  await Promise.all([
    loadTabs().catch(() => {}),
    loadQuickPrompts().catch(() => {}),
    loadCursorThreads(prefs.dlhCursorThread).catch(() => {})
  ]);
  await refreshContext().catch(() => {});
}

async function loadCursorThreads(preferredThreadId) {
  const workspaceId = elements.workspace.value;
  const { threads } = await jsonFetch(`/cursor-threads?workspaceId=${encodeURIComponent(workspaceId)}`);
  currentCursorThreads = threads || [];
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
    syncThreadTitleInput();
    await loadCursorThread(preferredThreadId);
  } else {
    elements.thread.value = "";
    syncThreadTitleInput();
    currentCursorChatId = null;
    renderLoadedMessages([]);
  }
}

function syncThreadTitleInput() {
  const thread = currentCursorThreads.find((item) => item.id === elements.thread.value);
  elements.threadTitle.value = thread?.title && thread.title !== "Cursor thread" ? thread.title : "";
  elements.threadTitle.disabled = !elements.thread.value;
  elements.renameThread.disabled = !elements.thread.value;
}

async function loadCursorThread(threadId) {
  if (!threadId) {
    currentCursorChatId = null;
    renderLoadedMessages([]);
    syncThreadTitleInput();
    await chrome.storage.local.remove("dlhCursorThread");
    return;
  }
  currentCursorChatId = threadId;
  syncThreadTitleInput();
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

async function renameCursorThread() {
  const threadId = elements.thread.value;
  const title = elements.threadTitle.value.trim();
  if (!threadId || !title) return;
  const workspaceId = elements.workspace.value;
  elements.renameThread.disabled = true;
  elements.renameThread.textContent = "Renaming...";
  try {
    const { thread } = await jsonFetch(`/cursor-threads/${encodeURIComponent(threadId)}/rename`, {
      method: "POST",
      body: JSON.stringify({ workspaceId, title })
    });
    elements.status.textContent = `Renamed Cursor thread: ${thread.title}`;
    await loadCursorThreads(threadId);
  } finally {
    elements.renameThread.disabled = false;
    elements.renameThread.textContent = "Rename";
  }
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
  elements.tabs.dataset.scopeMode = result.scopeMode || "";
  elements.tabs.title =
    result.scopeMode === "window-fallback"
      ? "Vivaldi did not expose workspace metadata; showing current-window tabs as a fallback."
      : "";
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
  const { workspace } = await jsonFetch("/workspaces", {
    method: "POST",
    body: JSON.stringify({ path })
  });
  elements.workspacePath.value = "";
  await loadBridge();
  if (workspace?.id) {
    elements.workspace.value = workspace.id;
    await chrome.storage.local.set({ dlhWorkspace: workspace.id });
    await loadCursorThreads();
    await refreshContext();
  }
}

async function openWorkspace() {
  elements.openWorkspace.disabled = true;
  elements.openWorkspace.textContent = "Opening...";
  try {
    const { path } = await jsonFetch("/workspaces/pick", { method: "POST", body: "{}" });
    if (!path) return;
    elements.workspacePath.value = path;
    await addWorkspace();
  } finally {
    elements.openWorkspace.disabled = false;
    elements.openWorkspace.textContent = "Open";
  }
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
let lastAssistantChunk = "";

function isPromptLeak(text) {
  return Boolean(text && sanitizeForDisplay(text) === "");
}

function textFromContentBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks.map((block) => block?.text || "").join("");
}

function textFromAgentPayload(data) {
  if (!data || typeof data !== "object") return "";
  const update = data.params?.update;
  if (update?.sessionUpdate === "agent_message_chunk" && update.content?.text) {
    return update.content.text;
  }
  if (data.type === "assistant") {
    return textFromContentBlocks(data.message?.content);
  }
  if (data.type === "result" && typeof data.result === "string") {
    return data.result;
  }
  if (typeof data.text === "string") return data.text;
  if (typeof data.result === "string") return data.result;
  return "";
}

function textFromAgentResult(data) {
  const direct = textFromAgentPayload(data);
  if (direct) return direct;
  if (Array.isArray(data?.events)) {
    for (let i = data.events.length - 1; i >= 0; i -= 1) {
      const text = textFromAgentPayload(data.events[i]);
      if (text) return text;
    }
  }
  return "";
}

function setAssistantMarkdown(assistantEl, text) {
  assistantMarkdown = text;
  const body = assistantEl.querySelector(".md") || assistantEl;
  if (body.classList.contains("md")) {
    body.innerHTML = renderMarkdown(assistantMarkdown);
  } else {
    assistantEl.textContent = assistantMarkdown;
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function appendAssistantText(assistantEl, chunk) {
  if (!chunk || isPromptLeak(chunk)) return;
  if (chunk === lastAssistantChunk) return;
  lastAssistantChunk = chunk;
  setAssistantMarkdown(assistantEl, assistantMarkdown + chunk);
}

function replaceAssistantText(assistantEl, text) {
  if (!text || isPromptLeak(text)) return;
  lastAssistantChunk = text;
  setAssistantMarkdown(assistantEl, text);
}

async function sendPrompt(event) {
  event.preventDefault();
  const message = elements.prompt.value.trim();
  if (!message) return;
  elements.prompt.value = "";
  await refreshContext().catch(() => {});

  await chrome.storage.local.set({
    dlhModel: elements.model.value,
    dlhWorkspace: elements.workspace.value,
    dlhPermissionMode: elements.permissionMode.value,
    dlhTheme: elements.theme.value
  });

  addMessage("user", message);
  const assistant = addMessage("assistant", "");
  if (!assistant) {
    addMessage("event", "Could not open assistant message area.");
    return;
  }
  assistantMarkdown = "";
  lastAssistantChunk = "";
  setChatBusy(true);
  startActivityPoll();
  activeChatSessionId = null;

  let response;
  try {
    response = await fetch(`${BRIDGE_URL}/chat`, {
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
  } catch (error) {
    replaceAssistantText(assistant, `**Bridge error:** ${friendlyFetchError(error)}`);
    setChatBusy(false);
    stopActivityPoll();
    return;
  }

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => "Chat request failed.");
    replaceAssistantText(assistant, errText);
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
          if (data?.type === "assistant" && data?.message?.content) {
            const full = textFromContentBlocks(data.message.content);
            if (full) replaceAssistantText(assistant, full);
          } else {
            const text = textFromAgentPayload(data);
            if (text) appendAssistantText(assistant, text);
          }
        } else if (name === "agent-result") {
          const text = textFromAgentResult(data);
          if (text && !assistantMarkdown.trim()) replaceAssistantText(assistant, text);
        } else if (name === "status") {
          if (data?.phase === "print" && data?.detail === "cursor-thread-resume") {
            pushActivity("Using Cursor thread (resume)");
          }
        } else if (name === "tool-activity") {
          const status = data.status ? ` (${data.status})` : "";
          pushActivity(`tool: ${data.tool}${status}`);
        } else if (name === "fallback") {
          if (!/cursor thread|resume/i.test(data.reason || "")) {
            addMessage("event", `Fallback: ${data.reason}`);
          }
        } else if (name === "cursor-thread" && data.cursorChatId) {
          currentCursorChatId = data.cursorChatId;
          elements.thread.value = data.cursorChatId;
          chrome.storage.local.set({ dlhCursorThread: data.cursorChatId });
          if (data.created && !chatInFlight) loadCursorThreads(data.cursorChatId).catch(() => {});
        } else if (name === "error") {
          addMessage("event", data.message || "Error");
        } else if (name === "done") {
          if (!assistantMarkdown.trim() && !data?.cancelled) {
            replaceAssistantText(assistant, "_Cursor finished, but no assistant text was returned._");
          }
          if (data.cancelled) addMessage("event", "Cancelled.");
        }
      });
    }
  } catch (error) {
    replaceAssistantText(assistant, `**Error:** ${friendlyFetchError(error)}`);
  } finally {
    setChatBusy(false);
    stopActivityPoll();
    activeChatSessionId = null;
  }
}

async function cancelChat() {
  if (!activeChatSessionId) return;
  try {
    await jsonFetch("/chat/cancel", {
      method: "POST",
      body: JSON.stringify({ chatSessionId: activeChatSessionId })
    });
    addMessage("event", "Cancelling…");
  } catch (error) {
    addMessage("event", friendlyFetchError(error));
  }
}

elements.automationEnabled.addEventListener("change", async () => {
  const on = elements.automationEnabled.checked;
  setAutomationUi(on);
  await chrome.storage.local.set({ dlhAutomationEnabled: on, dlhAutomationPendingSync: true });
  try {
    await syncAutomationToBridge(on);
    elements.status.textContent = on
      ? "Automation ON — agents can use browser tools when Vivaldi is connected."
      : "Automation OFF — chat only.";
    await loadBridge();
  } catch (error) {
    elements.status.textContent = `Bridge offline — automation ${on ? "ON" : "OFF"} saved. Run ./install.sh in the project folder, restart Vivaldi, Refresh.`;
  }
});

elements.refresh.addEventListener("click", () => {
  loadBridge().catch((error) => setBridgeOfflineStatus(error));
});
elements.addWorkspace.addEventListener("click", () => {
  addWorkspace().catch((error) => {
    elements.status.textContent = `Add project failed: ${friendlyFetchError(error)}`;
  });
});
elements.openWorkspace.addEventListener("click", () => {
  openWorkspace().catch((error) => {
    elements.status.textContent = `Open project failed: ${friendlyFetchError(error)}`;
  });
});
elements.theme.addEventListener("change", async () => {
  setTheme(elements.theme.value);
  await chrome.storage.local.set({ dlhTheme: elements.theme.value });
});
elements.thread.addEventListener("change", () => {
  syncThreadTitleInput();
  loadCursorThread(elements.thread.value).catch((error) => {
    elements.status.textContent = `Cursor thread load failed: ${error.message}`;
  });
});
elements.renameThread.addEventListener("click", () => {
  renameCursorThread().catch((error) => {
    elements.status.textContent = `Rename failed: ${friendlyFetchError(error)}`;
  });
});
elements.threadTitle.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  renameCursorThread().catch((error) => {
    elements.status.textContent = `Rename failed: ${friendlyFetchError(error)}`;
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
elements.prompt.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  elements.form.requestSubmit();
});
elements.form.addEventListener("submit", sendPrompt);
elements.cancel.addEventListener("click", cancelChat);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "DLH_TABS_CHANGED") return;
  loadTabs().then(refreshContext).catch((error) => {
    elements.status.textContent = `Tab refresh failed: ${error.message}`;
  });
});

loadBridge().catch((error) => setBridgeOfflineStatus(error));


