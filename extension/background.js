import { executeBrowserCommand } from "./browser-runner.js";

const BRIDGE_URL = "http://127.0.0.1:3847";
const TAB_WORKSPACES_KEY = "dlhTabWorkspaces";

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
  while (true) {
    try {
      await fetch(`${BRIDGE_URL}/browser/ping`, { method: "POST" }).catch(() => {});
      const response = await fetch(`${BRIDGE_URL}/browser/wait?timeoutMs=25000`);
      const job = await response.json();
      if (!job?.id || !job?.command) {
        continue;
      }
      try {
        if (!(await isBrowserAutomationEnabled())) {
          await postJson("/browser/result", { id: job.id, error: AUTOMATION_OFF_MSG });
          continue;
        }
        const result = await executeBrowserCommand(job);
        await postJson("/browser/result", { id: job.id, result });
      } catch (error) {
        await postJson("/browser/result", { id: job.id, error: error?.message || String(error) });
      }
    } catch {
      await sleep(2000);
    }
  }
}

browserWorkerLoop();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    // Vivaldi may toggle or ignore open(); the action still focuses the panel when supported.
  }
});

function workspaceIdFromTab(tab) {
  const raw = tab?.vivExtData?.workspaceId;
  if (raw === undefined || raw === null || raw === "") return null;
  const asNumber = Number(raw);
  return Number.isFinite(asNumber) ? String(Math.round(asNumber)) : String(raw);
}

async function readTabWorkspaces() {
  const data = await chrome.storage.session.get(TAB_WORKSPACES_KEY);
  return data[TAB_WORKSPACES_KEY] || {};
}

async function writeTabWorkspace(tabId, workspaceId) {
  const map = await readTabWorkspaces();
  map[String(tabId)] = workspaceId;
  await chrome.storage.session.set({ [TAB_WORKSPACES_KEY]: map });
}

async function sendWorkspace(tabId, workspaceId) {
  if (!tabId) return;
  await writeTabWorkspace(tabId, workspaceId);
  try {
    await chrome.tabs.sendMessage(tabId, { type: "DLH_VIVALDI_WORKSPACE", workspaceId });
  } catch {
    // Content script may not exist on chrome://, extension pages, or restricted sites.
  }
}

async function workspaceIdForTab(tab) {
  if (!tab?.id) return null;
  const map = await readTabWorkspaces();
  if (map[String(tab.id)] !== undefined) return map[String(tab.id)];
  return workspaceIdFromTab(tab);
}

function broadcastTabsChanged() {
  chrome.runtime.sendMessage({ type: "DLH_TABS_CHANGED" }).catch(() => {});
}

chrome.tabs.onActivated.addListener(async (info) => {
  const tab = await chrome.tabs.get(info.tabId).catch(() => null);
  await sendWorkspace(info.tabId, workspaceIdFromTab(tab));
  broadcastTabsChanged();
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  await sendWorkspace(tabId, workspaceIdFromTab(tab));
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
      workspaceId: await workspaceIdForTab(tab)
    }))
  );
  const visible = currentWorkspaceOnly
    ? tabsWithWorkspace.filter(({ workspaceId }) => workspaceId === currentWorkspaceId)
    : tabsWithWorkspace;

  return {
    currentWorkspaceId,
    activeTabId: active?.id || null,
    tabs: visible.map(({ tab, workspaceId }) => ({
      id: tab.id,
      windowId: tab.windowId,
      index: tab.index,
      active: tab.active,
      pinned: tab.pinned,
      title: tab.title,
      url: tab.url,
      workspaceId
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
  const tabs = await chrome.tabs.query({ currentWindow: true });
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
