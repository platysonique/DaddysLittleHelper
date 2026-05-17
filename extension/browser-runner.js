import { runDeepCommand } from "./cdp/index.js";
import {
  clearRefState,
  getSnapshotMode,
  loadRefState,
  setSnapshotMode,
  shouldEscalateSnapshot
} from "./cdp/store.js";

const RESTRICTED_PREFIXES = ["chrome://", "vivaldi://", "chrome-extension://", "devtools://"];

function isRunnableUrl(url) {
  return url && !RESTRICTED_PREFIXES.some((prefix) => url.startsWith(prefix));
}

async function pageCommand(tabId, command, params = {}, frameId = 0) {
  const response = await chrome.tabs.sendMessage(
    tabId,
    { type: "DLH_PAGE_COMMAND", command, params },
    { frameId }
  );
  if (!response?.ok) throw new Error(response?.error || "Page command failed.");
  return response.result;
}

async function listFrameIds(tabId) {
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    return (frames || []).filter((f) => f.frameId !== undefined && isRunnableUrl(f.url));
  } catch {
    return [{ frameId: 0, url: "" }];
  }
}

function wrapTopFrameSnapshot(result) {
  return {
    format: "dlh-tree-v2",
    refGeneration: result.refGeneration,
    frameCount: 1,
    frames: [
      {
        frameId: 0,
        url: result.url,
        refCount: result.refCount,
        refGeneration: result.refGeneration
      }
    ],
    snapshot: result.snapshot,
    refCount: result.refCount ?? 0
  };
}

async function snapshotAllFrames(tabId) {
  const frames = await listFrameIds(tabId);
  const sections = [];
  let refGeneration = null;

  for (const frame of frames) {
    try {
      const result = await pageCommand(tabId, "snapshot", {}, frame.frameId);
      sections.push({
        frameId: frame.frameId,
        url: result.url || frame.url,
        refCount: result.refCount,
        refGeneration: result.refGeneration,
        snapshot: result.snapshot
      });
      if (frame.frameId === 0) refGeneration = result.refGeneration;
    } catch {
      // Cross-origin or restricted frames are skipped.
    }
  }

  if (!sections.length) throw new Error("No accessible frames to snapshot.");

  const merged = sections
    .map((s) => `--- frame ${s.frameId} ${s.url || ""} (${s.refCount} refs) ---\n${s.snapshot}`)
    .join("\n\n");

  return {
    format: "dlh-tree-v1-multi",
    refGeneration,
    frameCount: sections.length,
    frames: sections.map((s) => ({
      frameId: s.frameId,
      url: s.url,
      refCount: s.refCount,
      refGeneration: s.refGeneration
    })),
    snapshot: merged,
    refCount: sections.reduce((sum, s) => sum + (s.refCount || 0), 0)
  };
}

async function snapshotWithEscalation(tabId, params) {
  const allFrames = params.allFrames !== false;
  let totalFrames = 1;

  try {
    let fastResult;
    if (allFrames) {
      totalFrames = (await listFrameIds(tabId)).length;
      fastResult = await snapshotAllFrames(tabId);
    } else {
      fastResult = wrapTopFrameSnapshot(await pageCommand(tabId, "snapshot", {}, 0));
    }

    const reason = shouldEscalateSnapshot(fastResult, { totalFrames, allFrames });
    if (!reason) {
      await setSnapshotMode(tabId, "fast");
      await clearRefState(tabId);
      return { ...fastResult, automationPath: "fast" };
    }

    const deep = await runDeepCommand(tabId, "snapshot", {});
    await setSnapshotMode(tabId, "deep");
    return {
      ...deep,
      automationPath: "deep",
      escalated: true,
      escalationReason: reason,
      fastRefCount: fastResult.refCount,
      fastFrameCount: fastResult.frameCount
    };
  } catch (fastErr) {
    const deep = await runDeepCommand(tabId, "snapshot", {});
    await setSnapshotMode(tabId, "deep");
    return {
      ...deep,
      automationPath: "deep",
      escalated: true,
      escalationReason: "fast_failed",
      fastError: fastErr.message
    };
  }
}

async function deepClickAtRef(tabId, params, frameId) {
  const { x, y } = await pageCommand(
    tabId,
    "measureRef",
    { ref: params.ref, refGeneration: params.refGeneration },
    frameId
  );
  return runDeepCommand(tabId, "click_at", {
    x,
    y,
    button: params.button
  });
}

async function clickWithEscalation(tabId, params, frameId) {
  const { refMap } = await loadRefState(tabId);
  const mode = await getSnapshotMode(tabId);

  if (mode === "deep" && refMap[params.ref]) {
    return runDeepCommand(tabId, "click", params);
  }

  try {
    const result = await pageCommand(tabId, "click", params, frameId);
    if (result.hitRef && result.hitRef !== params.ref) {
      const deep = await deepClickAtRef(tabId, params, frameId);
      return {
        ...deep,
        escalated: true,
        escalationReason: "obscured",
        fastHitRef: result.hitRef
      };
    }
    return result;
  } catch {
    const deep = await deepClickAtRef(tabId, params, frameId);
    return {
      ...deep,
      escalated: true,
      escalationReason: "fast_click_failed"
    };
  }
}

export async function resolveTabId(params = {}) {
  if (params.tabId) return params.tabId;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id) throw new Error("No active tab.");
  return active.id;
}

export async function executeBrowserCommand({ command, params = {} }) {
  if (command === "tabs") {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return {
      tabs: tabs
        .filter((tab) => isRunnableUrl(tab.url))
        .map((tab) => ({
          id: tab.id,
          title: tab.title,
          url: tab.url,
          active: tab.active,
          windowId: tab.windowId
        }))
    };
  }

  const tabId = await resolveTabId(params);
  const frameId = Number(params.frameId ?? 0);

  if (command === "navigate") {
    const url = params.url;
    if (!url) throw new Error("navigate requires url.");
    await chrome.tabs.update(tabId, { url });
    return { ok: true, tabId, url };
  }

  if (command === "click_at") {
    return runDeepCommand(tabId, "click_at", params);
  }

  if (command === "screenshot") {
    const tab = await chrome.tabs.get(tabId);
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return {
      ok: true,
      mimeType: "image/png",
      dataUrl,
      note: "Viewport screenshot of the active tab window (not full page)."
    };
  }

  const tab = await chrome.tabs.get(tabId);
  if (!isRunnableUrl(tab.url)) {
    throw new Error("Cannot automate restricted browser pages.");
  }

  if (command === "snapshot") {
    return snapshotWithEscalation(tabId, params);
  }

  if (command === "click") {
    return clickWithEscalation(tabId, params, frameId);
  }

  switch (command) {
    case "find":
    case "type":
    case "fill":
    case "select":
    case "scroll":
    case "wait":
      return pageCommand(tabId, command, params, frameId);
    default:
      throw new Error(`Unknown browser command: ${command}`);
  }
}
