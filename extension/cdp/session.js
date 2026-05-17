/** CDP session manager via chrome.debugger (Deep Mode). */

const PROTOCOL_VERSION = "1.3";
const attachedTabs = new Map();
let globalListenerRegistered = false;

function tabKey(tabId) {
  return String(tabId);
}

function ensureGlobalListener() {
  if (globalListenerRegistered) return;
  globalListenerRegistered = true;
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (!tabId) return;
    const state = attachedTabs.get(tabKey(tabId));
    if (!state) return;
    if (method === "Target.attachedToTarget" && params.sessionId) {
      state.sessions.set(params.sessionId, {
        sessionId: params.sessionId,
        targetInfo: params.targetInfo
      });
      const descriptor = { tabId, sessionId: params.sessionId };
      sendCommand(descriptor, "Accessibility.enable").catch(() => {});
      sendCommand(descriptor, "DOM.enable").catch(() => {});
    }
  });
}

export function isAttached(tabId) {
  return attachedTabs.has(tabKey(tabId));
}

export async function attachTab(tabId) {
  const key = tabKey(tabId);
  if (attachedTabs.has(key)) return attachedTabs.get(key);

  const target = { tabId };
  await chrome.debugger.attach(target, PROTOCOL_VERSION);
  await sendCommand(target, "Accessibility.enable");
  await sendCommand(target, "DOM.enable");
  await sendCommand(target, "Page.enable");

  try {
    await sendCommand(target, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
      filter: [{ type: "iframe", exclude: false }]
    });
  } catch {
    // Older Chromium builds may not support flat sessions.
  }

  const state = { target, sessions: new Map() };
  attachedTabs.set(key, state);
  ensureGlobalListener();
  return state;
}

export async function detachTab(tabId) {
  const key = tabKey(tabId);
  if (!attachedTabs.has(key)) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // ignore
  }
  attachedTabs.delete(key);
}

export function sendCommand(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

export async function getSessionsForTab(tabId) {
  const state = await attachTab(tabId);
  const targets = [{ descriptor: state.target, label: "main" }];
  for (const [sessionId, info] of state.sessions) {
    targets.push({
      descriptor: { tabId, sessionId },
      label: `frame:${sessionId}`,
      targetInfo: info.targetInfo
    });
  }
  return targets;
}
