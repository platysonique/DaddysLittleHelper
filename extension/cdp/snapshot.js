/** AX-tree snapshot for CDP Deep Mode. */
import { attachTab, getSessionsForTab, sendCommand } from "./session.js";
import { saveRefState } from "./store.js";

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "slider",
  "spinbutton",
  "option",
  "treeitem",
  "gridcell",
  "heading"
]);

function nodeName(node) {
  if (!node?.name?.value) return "";
  return String(node.name.value).replace(/\s+/g, " ").trim().slice(0, 140);
}

function flattenAxNodes(nodes) {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const lines = [];
  const index = [];
  let assigned = 0;

  function walk(nodeId, depth) {
    const node = byId.get(nodeId);
    if (!node) return;
    const role = node.role?.value || "generic";
    const name = nodeName(node);
    const interesting = INTERACTIVE_ROLES.has(role) || (name && role === "generic");

    if (interesting && name) {
      assigned += 1;
      const ref = `@${assigned}`;
      const indent = "  ".repeat(Math.min(depth, 8));
      const flags = [];
      if (node.ignored) flags.push("ignored");
      if (node.hidden) flags.push("hidden");
      const state = flags.length ? ` {${flags.join(", ")}}` : "";
      lines.push(`${indent}${ref} [${role}] ${name}${state}`);
      index.push({
        ref,
        role,
        name,
        backendDOMNodeId: node.backendDOMNodeId,
        nodeId: node.nodeId
      });
    }

    for (const childId of node.childIds || []) {
      walk(childId, depth + 1);
    }
  }

  const root = nodes.find((n) => !n.parentId) || nodes[0];
  if (root) walk(root.nodeId, 0);

  return { lines, index, refCount: assigned };
}

export async function buildDeepSnapshot(tabId) {
  await attachTab(tabId);
  const sessions = await getSessionsForTab(tabId);
  const sections = [];
  const refMap = {};
  let total = 0;

  for (const session of sessions) {
    try {
      const { nodes } = await sendCommand(session.descriptor, "Accessibility.getFullAXTree");
      const { lines, index, refCount } = flattenAxNodes(nodes || []);
      const header = `--- ${session.label} (${refCount} refs) ---`;
      sections.push(`${header}\n${lines.join("\n")}`);
      total += refCount;
      for (const entry of index) {
        refMap[entry.ref] = {
          backendDOMNodeId: entry.backendDOMNodeId,
          sessionId: session.descriptor.sessionId || null,
          role: entry.role,
          name: entry.name
        };
      }
    } catch {
      // skip inaccessible session
    }
  }

  const refGeneration = Date.now();
  await saveRefState(tabId, refGeneration, refMap);

  return {
    format: "dlh-tree-v2-cdp",
    mode: "deep",
    refGeneration,
    refCount: total,
    snapshot: sections.join("\n\n") || "(no interactive nodes in AX tree)",
    note: "CDP snapshot (auto-escalated). Chrome may show a short debugging banner while attached."
  };
}
