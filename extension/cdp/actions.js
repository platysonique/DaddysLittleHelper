/** CDP input actions for Deep Mode. */
import { attachTab, sendCommand } from "./session.js";
import { assertDeepRefGeneration, loadRefState } from "./store.js";

async function resolveNode(descriptor, backendDOMNodeId) {
  const { object } = await sendCommand(descriptor, "DOM.resolveNode", { backendNodeId: backendDOMNodeId });
  if (!object?.objectId) throw new Error("Could not resolve node.");
  const { model } = await sendCommand(descriptor, "DOM.getBoxModel", { objectId: object.objectId });
  if (!model?.content?.length) throw new Error("No box model for node.");
  const content = model.content;
  const x = (content[0] + content[2] + content[4] + content[6]) / 4;
  const y = (content[1] + content[3] + content[5] + content[7]) / 4;
  return { x, y };
}

async function dispatchClick(descriptor, x, y, button = "left") {
  const btn = button === "right" ? "right" : "left";
  await sendCommand(descriptor, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: btn
  });
  await sendCommand(descriptor, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: btn,
    clickCount: 1
  });
  await sendCommand(descriptor, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: btn,
    clickCount: 1
  });
}

export async function deepClickRef(tabId, ref, refGeneration, button = "left") {
  await assertDeepRefGeneration(tabId, refGeneration);
  const { refMap } = await loadRefState(tabId);
  const entry = refMap[ref];
  if (!entry) throw new Error(`Unknown CDP ref ${ref}. Run dlh_browser_snapshot with deep:true first.`);

  const state = await attachTab(tabId);
  const descriptor = entry.sessionId
    ? { tabId, sessionId: entry.sessionId }
    : state.target;

  const { x, y } = await resolveNode(descriptor, entry.backendDOMNodeId);
  await dispatchClick(descriptor, x, y, button);
  return { ok: true, ref, mode: "deep", x, y };
}

export async function deepClickAt(tabId, x, y, button = "left") {
  const state = await attachTab(tabId);
  await dispatchClick(state.target, x, y, button);
  return { ok: true, mode: "deep", x, y };
}
