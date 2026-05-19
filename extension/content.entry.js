import { getPageContext } from "./page/context.js";
import { buildSnapshot, findElements } from "./page/snapshot.js";
import { clickRef, fillRef, measureRef, scrollPage, selectRef, typeRef, waitMs } from "./page/actions.js";

let cachedWorkspaceId = null;

async function resolveWorkspaceId() {
  if (cachedWorkspaceId !== null) return cachedWorkspaceId;
  try {
    const response = await chrome.runtime.sendMessage({ type: "DLH_GET_WORKSPACE" });
    cachedWorkspaceId = response?.workspaceId ?? null;
  } catch {
    cachedWorkspaceId = null;
  }
  return cachedWorkspaceId;
}

async function runPageCommand(command, params = {}) {
  const refGeneration = params.refGeneration;
  switch (command) {
    case "snapshot":
      return buildSnapshot();
    case "find":
      return findElements(params.query, params.limit);
    case "measureRef":
      return measureRef(params.ref, refGeneration);
    case "click":
      return clickRef(params.ref, refGeneration, params.button, params.clickCount);
    case "type":
      return typeRef(params.ref, refGeneration, params.text || "", Boolean(params.submit));
    case "fill":
      return fillRef(params.ref, refGeneration, params.text || "");
    case "select":
      return selectRef(params.ref, refGeneration, params.value);
    case "scroll":
      return scrollPage(params.direction, Number(params.amount || 900));
    case "wait":
      return waitMs(Number(params.ms || 1000));
    default:
      throw new Error(`Unknown page command: ${command}`);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "DLH_VIVALDI_WORKSPACE") {
    cachedWorkspaceId = message.workspaceId ?? null;
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.type === "DLH_GET_PAGE_CONTEXT") {
    (async () => {
      const workspaceId = await resolveWorkspaceId();
      sendResponse(getPageContext(workspaceId));
    })();
    return true;
  }

  if (message.type === "DLH_PAGE_COMMAND") {
    (async () => {
      try {
        sendResponse({ ok: true, result: await runPageCommand(message.command, message.params || {}) });
      } catch (error) {
        sendResponse({ ok: false, error: error?.message || String(error) });
      }
    })();
    return true;
  }

  return false;
});
