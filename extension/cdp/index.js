import { buildDeepSnapshot } from "./snapshot.js";
import { deepClickAt, deepClickRef } from "./actions.js";
import { detachTab } from "./session.js";

export async function runDeepCommand(tabId, command, params = {}) {
  switch (command) {
    case "snapshot":
      return buildDeepSnapshot(tabId);
    case "click":
      return deepClickRef(tabId, params.ref, params.refGeneration, params.button);
    case "click_at":
      return deepClickAt(tabId, params.x, params.y, params.button);
    case "detach":
      await detachTab(tabId);
      return { ok: true };
    default:
      throw new Error(`Deep mode does not support command: ${command}`);
  }
}
