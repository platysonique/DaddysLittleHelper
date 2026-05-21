import { executeBrowserCommand } from "./browser-runner.js";

const BRIDGE_URL = "http://127.0.0.1:3847";
const TAB_WORKSPACES_KEY = "dlhTabWorkspaces";
const WORKER_ALARM = "dlh-browser-worker";
const RUNTIME_SESSION_ID = crypto.randomUUID();
let workerLoopRunning = false;

function extensionIdentity() {
  const manifest = chrome.runtime.getManifest();
  return {
    extensionId: chrome.runtime.id,
    version: manifest.version,
    name: manifest.name,
    runtimeSessionId: RUNTIME_SESSION_ID
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(path, body) {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

async function browserWorkerLoop() {
  if (workerLoopRunning) return;
  workerLoopRunning = true;
  while (true) {
    try {
      const identity = extensionIdentity();
      await postJson("/browser/ping", { identity }).catch(() => {});
      const waitParams = new URLSearchParams({
        timeoutMs: "25000",
        extensionId: identity.extensionId,
        version: identity.version,
        runtimeSessionId: identity.runtimeSessionId
      });
      const response = await fetch(`${BRIDGE_URL}/browser/wait?${waitParams}`);
      const job = await response.json();
      if (!job?.id || !job?.command) {
        continue;
      }
      try {
        const result = await executeBrowserCommand(job);
        await postJson("/browser/result", { id: job.id, identity, result });
      } catch (error) {
        await postJson("/browser/result", { id: job.id, identity, error: error?.message || String(error) });
      }
    } catch {
      await sleep(2000);
    }
  }
}

function startBrowserWorkerLoop() {
  browserWorkerLoop().catch(() => {
    workerLoopRunning = false;
  });
}

function scheduleWorkerAlarm() {
  chrome.alarms?.create?.(WORKER_ALARM, { periodInMinutes: 0.5 });
}

startBrowserWorkerLoop();
scheduleWorkerAlarm();

chrome.runtime.onInstalled.addListener(() => {
  scheduleWorkerAlarm();
  startBrowserWorkerLoop();
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup?.addListener?.(() => {
  scheduleWorkerAlarm();
  startBrowserWorkerLoop();
});

chrome.alarms?.onAlarm?.addListener?.((alarm) => {
  if (alarm.name === WORKER_ALARM) startBrowserWorkerLoop();
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    // Vivaldi may toggle or ignore open(); the action still focuses the panel when supported.
  }
});

function normalizeWorkspaceId(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) ? String(Math.round(asNumber)) : String(raw);
}

function workspaceIdFromVivExtData(vivExtData, depth = 0) {
  if (!vivExtData || depth > 3) return null;
  if (typeof vivExtData === "string") {
    try {
      return workspaceIdFromVivExtData(JSON.parse(vivExtData), depth + 1);
    } catch {
      return null;
    }
  }
  if (typeof vivExtData !== "object") return null;
  const direct = normalizeWorkspaceId(vivExtData.workspaceId ?? vivExtData.workspace_id ?? vivExtData.workspace);
  if (direct) return direct;
  for (const key of ["extData", "data", "tab", "vivaldi"]) {
    const nested = workspaceIdFromVivExtData(vivExtData[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function parseVivExtData(vivExtData) {
  if (!vivExtData) return {};
  if (typeof vivExtData === "string") {
    try {
      return parseVivExtData(JSON.parse(vivExtData));
    } catch {
      return {};
    }
  }
  return typeof vivExtData === "object" ? vivExtData : {};
}

function tabScopeFromTab(tab) {
  const vivExtData = parseVivExtData(tab?.vivExtData);
  const workspaceId = normalizeWorkspaceId(tab?.workspaceId) || workspaceIdFromVivExtData(vivExtData);
  const groupId = vivExtData.group || tab?.group || null;
  const tileId = vivExtData.tiling?.id || null;
  return {
    workspaceId,
    groupId: groupId ? String(groupId) : null,
    tileId: tileId ? String(tileId) : null
  };
}

function workspaceIdFromTab(tab) {
  return tabScopeFromTab(tab).workspaceId;
}

async function readTabWorkspaces() {
  const data = await chrome.storage.session.get(TAB_WORKSPACES_KEY);
  return data[TAB_WORKSPACES_KEY] || {};
}

async function writeTabWorkspace(tabId, workspaceId) {
  const map = await readTabWorkspaces();
  const key = String(tabId);
  if (workspaceId !== null && workspaceId !== undefined) {
    map[key] = workspaceId;
  } else if (!(key in map)) {
    map[key] = null;
  }
  await chrome.storage.session.set({ [TAB_WORKSPACES_KEY]: map });
}

async function sendWorkspace(tabId, workspaceId) {
  if (!tabId) return;
  await writeTabWorkspace(tabId, workspaceId);
  const map = await readTabWorkspaces();
  const resolvedWorkspaceId = map[String(tabId)] ?? null;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "DLH_VIVALDI_WORKSPACE", workspaceId: resolvedWorkspaceId });
  } catch {
    // Content script may not exist on chrome://, extension pages, or restricted sites.
  }
}

async function workspaceIdForTab(tab) {
  if (!tab?.id) return null;
  const liveWorkspaceId = workspaceIdFromTab(tab);
  if (liveWorkspaceId) {
    await writeTabWorkspace(tab.id, liveWorkspaceId);
    return liveWorkspaceId;
  }
  const map = await readTabWorkspaces();
  if (map[String(tab.id)] !== undefined) return map[String(tab.id)];
  return null;
}

function broadcastTabsChanged() {
  chrome.runtime.sendMessage({ type: "DLH_TABS_CHANGED" }).catch(() => {});
}

chrome.tabs.onActivated.addListener(async (info) => {
  const tab = await chrome.tabs.get(info.tabId).catch(() => null);
  await sendWorkspace(info.tabId, await workspaceIdForTab(tab));
  broadcastTabsChanged();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  await sendWorkspace(tabId, await workspaceIdForTab(tab));
  broadcastTabsChanged();
});

chrome.tabs.onCreated.addListener(broadcastTabsChanged);
chrome.tabs.onRemoved.addListener(broadcastTabsChanged);
chrome.tabs.onMoved.addListener(broadcastTabsChanged);

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function tabsInCurrentWindow({ currentWorkspaceOnly = true } = {}) {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const active = tabs.find((tab) => tab.active) || null;
  const currentWorkspaceId = await workspaceIdForTab(active);
  const tabsWithWorkspace = await Promise.all(
    tabs.map(async (tab) => ({
      tab,
      workspaceId: await workspaceIdForTab(tab),
      scope: tabScopeFromTab(tab)
    }))
  );
  const activeScope = active ? tabScopeFromTab(active) : {};
  let visible = tabsWithWorkspace;
  let scopeMode = "all";
  let scopeReason = "all-tabs-requested";
  if (currentWorkspaceOnly) {
    if (currentWorkspaceId) {
      visible = tabsWithWorkspace.filter(({ workspaceId }) => workspaceId === currentWorkspaceId);
      scopeMode = "workspace";
      scopeReason = "workspace-id";
    } else if (activeScope.groupId) {
      visible = tabsWithWorkspace.filter(({ scope }) => scope.groupId === activeScope.groupId);
      scopeMode = "group";
      scopeReason = "active-vivaldi-group";
    } else if (activeScope.tileId) {
      visible = tabsWithWorkspace.filter(({ scope }) => scope.tileId === activeScope.tileId);
      scopeMode = "tile";
      scopeReason = "active-vivaldi-tile";
    } else {
      // Vivaldi often withholds workspace metadata from extensions. Keep the
      // picker usable instead of silently rendering an empty "workspace" list.
      visible = tabsWithWorkspace.filter(({ tab }) => tab.hidden !== true);
      scopeMode = "window-fallback";
      scopeReason = "workspace-metadata-unavailable";
    }
  }

  return {
    currentWorkspaceId,
    activeTabId: active?.id || null,
    scopeMode,
    scopeReason,
    tabs: visible.map(({ tab, workspaceId, scope }) => ({
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      active: tab.active,
      pinned: tab.pinned,
      title: tab.title,
      url: tab.url,
      workspaceId,
      groupId: scope.groupId,
      tileId: scope.tileId
    }))
  };
}

async function pageContext(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "DLH_GET_PAGE_CONTEXT" });
  } catch (error) {
    return { error: error?.message || "Unable to read page context." };
  }
}

async function allTabContexts() {
  const { tabs } = await tabsInCurrentWindow({ currentWorkspaceOnly: true });
  const contexts = [];
  for (const tab of tabs) {
    if (!tab.id || !tab.url || tab.url.startsWith("chrome://") || tab.url.startsWith("vivaldi://")) continue;
    contexts.push({
      tab: {
        id: tab.id,
        windowId: tab.windowId,
        index: tab.index,
        active: tab.active,
        title: tab.title,
        url: tab.url,
        workspaceId: await workspaceIdForTab(tab)
      },
      page: await pageContext(tab.id)
    });
  }
  return contexts;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message.type === "DLH_GET_WORKSPACE") {
      const tab = sender.tab?.id ? await chrome.tabs.get(sender.tab.id) : await currentTab();
      sendResponse({ workspaceId: await workspaceIdForTab(tab) });
      return;
    }

    if (message.type === "DLH_GET_CONTEXT") {
      if (message.target === "all-tabs-context") {
        const active = await currentTab();
        sendResponse({
          bridgeUrl: BRIDGE_URL,
          workspaceId: await workspaceIdForTab(active),
          tab: active
            ? {
                id: active.id,
                windowId: active.windowId,
                index: active.index,
                active: active.active,
                title: active.title,
                url: active.url
              }
            : null,
          page: { title: active?.title, url: active?.url, excerpt: "Using all open tab contexts." },
          allTabs: await allTabContexts()
        });
        return;
      }

      const tab = message.tabId ? await chrome.tabs.get(message.tabId) : await currentTab();
      const context = tab
        ? await pageContext(tab.id)
        : { error: "No active tab." };
      sendResponse({
        bridgeUrl: BRIDGE_URL,
        workspaceId: await workspaceIdForTab(tab),
        tab: tab
          ? {
              id: tab.id,
              windowId: tab.windowId,
              index: tab.index,
              active: tab.active,
              title: tab.title,
              url: tab.url
            }
          : null,
        page: context
      });
      return;
    }

    if (message.type === "DLH_LIST_TABS") {
      sendResponse(await tabsInCurrentWindow({ currentWorkspaceOnly: message.currentWorkspaceOnly !== false }));
      return;
    }

    sendResponse({ error: `Unknown message type: ${message.type}` });
  })();
  return true;
});
