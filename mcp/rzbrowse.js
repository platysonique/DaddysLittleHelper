#!/usr/bin/env node
import { createStdioTransport } from "./stdio.js";

const BRIDGE_URL = process.env.DLH_BRIDGE_URL || "http://127.0.0.1:3847";

const frameProps = {
  frameId: { type: "number", description: "Frame id from snapshot (0 = top)." },
  refGeneration: { type: "number", description: "refGeneration from the latest snapshot for that frame." }
};

const leaseProps = {
  leaseToken: {
    type: "string",
    description: "Opaque L2 tab lease token from rzbrowse_lease_claim (auto-attached from last claim if omitted)."
  },
  missionId: { type: "string", description: "Mission id (default browser-mission-current for single-job)." },
  actor: { type: "string", description: "Lease actor id (e.g. rozi, cursor)." }
};

function legacyAliasName(canonical) {
  if (canonical === "rzbrowse_bridge_status") return "dlh_bridge_status";
  if (canonical === "rzbrowse_workspaces_list") return "dlh_workspaces_list";
  if (canonical.startsWith("rzbrowse_")) return "dlh_browser_" + canonical.slice("rzbrowse_".length);
  return null;
}

function withLegacyAliases(tools) {
  const aliases = [];
  for (const tool of tools) {
    const alias = legacyAliasName(tool.name);
    if (!alias) continue;
    aliases.push({
      ...tool,
      name: alias,
      description: `${tool.description} (alias of ${tool.name}; prefer ${tool.name}).`
    });
  }
  return [...tools, ...aliases];
}

function withLegacyMap(map) {
  const out = { ...map };
  for (const [k, v] of Object.entries(map)) {
    const alias = legacyAliasName(k);
    if (alias) out[alias] = v;
  }
  return out;
}

/** Last claim token per process — auto-attach on motors (H20). */
let sessionLeaseToken = null;
let sessionLeaseTabId = null;

const MOTOR_TOOL_NAMES_CANONICAL = [
  "rzbrowse_navigate",
  "rzbrowse_tab_activate",
  "rzbrowse_tab_open",
  "rzbrowse_tab_close",
  "rzbrowse_next_tab",
  "rzbrowse_previous_tab",
  "rzbrowse_reload",
  "rzbrowse_back",
  "rzbrowse_forward",
  "rzbrowse_reopen_closed_tab",
  "rzbrowse_hotkey",
  "rzbrowse_click_at",
  "rzbrowse_click",
  "rzbrowse_type",
  "rzbrowse_fill",
  "rzbrowse_select",
  "rzbrowse_scroll",
  "rzbrowse_insert_text",
  "rzbrowse_press_keys",
  "rzbrowse_evaluate"
];
const MOTOR_TOOL_NAMES = new Set([
  ...MOTOR_TOOL_NAMES_CANONICAL,
  ...MOTOR_TOOL_NAMES_CANONICAL.map((n) => legacyAliasName(n)).filter(Boolean)
]);

function withLeaseProps(properties = {}) {
  return { ...properties, ...leaseProps };
}

const CANONICAL_TOOLS = [
  {
    name: "rzbrowse_tabs",
    description:
      "List tabs in the current Vivaldi window. Default: workspace-scoped list (same as the side panel). Set currentWorkspaceOnly:false for all runnable tabs in the window.",
    inputSchema: {
      type: "object",
      properties: {
        currentWorkspaceOnly: {
          type: "boolean",
          description: "Default true — filter to the active Vivaldi workspace (or group/tile/window fallback)."
        }
      }
    }
  },
  {
    name: "rzbrowse_context",
    description:
      "Read the same browser context the side panel attaches to chat: tab metadata, page excerpt, selection, outline, blocks. Use target=all-tabs-context for every open workspace tab.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: ["active-tab", "selected-tab", "all-tabs-context"],
          description: "Default active-tab. selected-tab requires tabId."
        },
        tabId: { type: "number", description: "Required when target is selected-tab." }
      }
    }
  },
  {
    name: "rzbrowse_bridge_status",
    description: "RZBrowse bridge and extension link status (connected, automation ON/OFF, version).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "rzbrowse_workspaces_list",
    description: "List RZBrowse project workspaces (same list as the side panel project picker). Read-only.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "rzbrowse_navigate",
    description:
      "Navigate the target tab to a URL. Use fast:true (or waitUntil:commit) to return when navigation starts instead of waiting for full page load.",
    inputSchema: {
      type: "object",
      properties: withLeaseProps({
        url: { type: "string" },
        tabId: { type: "number" },
        fast: { type: "boolean", description: "Return after navigation commit (~12s max), not full load." },
        waitUntil: { type: "string", enum: ["complete", "commit", "fast"] },
        timeoutMs: { type: "number" }
      }),
      required: ["url"]
    }
  },
  {
    name: "rzbrowse_tab_activate",
    description: "Activate/focus a browser tab by tabId.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "number" } },
      required: ["tabId"]
    }
  },
  {
    name: "rzbrowse_tab_open",
    description: "Open a new browser tab. Optional url; defaults to browser new tab/blank behavior.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        active: { type: "boolean" },
        windowId: { type: "number" },
        index: { type: "number" }
      }
    }
  },
  {
    name: "rzbrowse_tab_close",
    description: "Close a browser tab by tabId, or the active tab if tabId is omitted.",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "number" } }
    }
  },
  {
    name: "rzbrowse_next_tab",
    description: "Activate the next tab in the current Vivaldi window.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "rzbrowse_previous_tab",
    description: "Activate the previous tab in the current Vivaldi window.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "rzbrowse_reload",
    description: "Reload the target tab. Optional bypassCache and wait=false.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        bypassCache: { type: "boolean" },
        wait: { type: "boolean" },
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "rzbrowse_back",
    description: "Navigate the target tab one step back in history.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        wait: { type: "boolean" },
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "rzbrowse_forward",
    description: "Navigate the target tab one step forward in history.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        wait: { type: "boolean" },
        timeoutMs: { type: "number" }
      }
    }
  },
  {
    name: "rzbrowse_reopen_closed_tab",
    description: "Reopen the most recently closed tab when the browser sessions API is available.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "rzbrowse_hotkey",
    description:
      "Execute a semantic browser shortcut action using RZBrowse browser APIs. action = next_tab, previous_tab, new_tab, close_tab, reopen_closed_tab, reload, back, or forward.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string" },
        shortcut: { type: "string" },
        tabId: { type: "number" },
        url: { type: "string" },
        active: { type: "boolean" },
        wait: { type: "boolean" },
        timeoutMs: { type: "number" }
      },
      required: ["action"]
    }
  },
  {
    name: "rzbrowse_snapshot",
    description:
      "Capture interactive tree (@ refs). Default: top frame only (fast). Set allFrames:true only for iframe-heavy pages. Escalates to CDP only when the tree is thin or frames are missing.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        allFrames: {
          type: "boolean",
          description: "Default false (top frame). Set true only when controls live in iframes."
        },
        ifUnchanged: {
          type: "boolean",
          description:
            "When true, skip snapshot if URL and DOM generation match the last snapshot for this tab (much faster)."
        }
      }
    }
  },
  {
    name: "rzbrowse_click_at",
    description: "Click viewport coordinates (canvas/WebGL). Uses CDP when needed.",
    inputSchema: {
      type: "object",
      properties: {
        x: { type: "number" },
        y: { type: "number" },
        button: { type: "string", enum: ["left", "right"] },
        tabId: { type: "number" }
      },
      required: ["x", "y"]
    }
  },
  {
    name: "rzbrowse_find",
    description:
      "Search interactive elements by label/role/ref text. Uses the latest snapshot index when available; otherwise snapshots once.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
        tabId: { type: "number" },
        frameId: frameProps.frameId
      },
      required: ["query"]
    }
  },
  {
    name: "rzbrowse_screenshot",
    description: "Capture viewport PNG of the tab window as a data URL.",
    inputSchema: { type: "object", properties: { tabId: { type: "number" } } }
  },
  {
    name: "rzbrowse_click",
    description: "Click an element by @ ref from the latest snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        button: { type: "string", enum: ["left", "right"] },
        clickCount: { type: "number" },
        tabId: { type: "number" },
        ...frameProps
      },
      required: ["ref", "refGeneration"]
    }
  },
  {
    name: "rzbrowse_type",
    description:
      "Type text into an element by @ ref (best for React, LinkedIn, contenteditable). Requires refGeneration from latest snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean" },
        tabId: { type: "number" },
        ...frameProps
      },
      required: ["ref", "text", "refGeneration"]
    }
  },
  {
    name: "rzbrowse_fill",
    description:
      "Replace input value by @ ref. On React/SPA sites prefer rzbrowse_type if fill does not stick. Requires refGeneration from latest snapshot.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        text: { type: "string" },
        tabId: { type: "number" },
        ...frameProps
      },
      required: ["ref", "text", "refGeneration"]
    }
  },
  {
    name: "rzbrowse_select",
    description: "Select an option on a <select> by value or visible label.",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string" },
        value: { type: "string" },
        tabId: { type: "number" },
        ...frameProps
      },
      required: ["ref", "value", "refGeneration"]
    }
  },
  {
    name: "rzbrowse_scroll",
    description: "Scroll the target frame up or down.",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
        amount: { type: "number" },
        tabId: { type: "number" },
        frameId: frameProps.frameId
      }
    }
  },
  {
    name: "rzbrowse_wait",
    description: "Wait milliseconds in page context.",
    inputSchema: {
      type: "object",
      properties: { ms: { type: "number" }, tabId: { type: "number" }, frameId: frameProps.frameId }
    }
  },
  {
    name: "rzbrowse_insert_text",
    description:
      "Insert text into the focused editor via CDP. Prefers monaco.editor.setValue when Monaco is present (Supabase SQL Editor).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string" },
        tabId: { type: "number" }
      },
      required: ["text"]
    }
  },
  {
    name: "rzbrowse_press_keys",
    description: "Send key chords via CDP (OLM human-parity). Supported: enter, tab, escape, arrows, space, backspace, delete, ctrl+enter, ctrl+a; comma-separated sequences ok.",
    inputSchema: {
      type: "object",
      properties: {
        keys: { type: "string" },
        tabId: { type: "number" }
      },
      required: ["keys"]
    }
  },
  {
    name: "rzbrowse_evaluate",
    description: "Run a JavaScript expression in the page via CDP Runtime.evaluate (returnByValue).",
    inputSchema: {
      type: "object",
      properties: withLeaseProps({
        expression: { type: "string" },
        awaitPromise: { type: "boolean" },
        tabId: { type: "number" }
      }),
      required: ["expression"]
    }
  },
  {
    name: "rzbrowse_lease_list",
    description: "List active L2 tab leases (who owns which tabId).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "rzbrowse_lease_claim",
    description:
      "Claim a tab for a mission/actor. Returns leaseToken required on motor tools. Use named missionId for multi-job; default browser-mission-current for single-job.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        windowId: { type: "number" },
        missionId: { type: "string" },
        actor: { type: "string" },
        sticky: { type: "boolean" },
        ttlMs: { type: "number" }
      },
      required: ["tabId"]
    }
  },
  {
    name: "rzbrowse_lease_release",
    description: "Release a tab lease by leaseToken, leaseId, or tabId+actor.",
    inputSchema: {
      type: "object",
      properties: {
        leaseToken: { type: "string" },
        leaseId: { type: "string" },
        tabId: { type: "number" },
        actor: { type: "string" }
      }
    }
  },
  {
    name: "rzbrowse_lease_steal",
    description: "Steal a tab lease when idle/expired/non-sticky (agents only).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        windowId: { type: "number" },
        missionId: { type: "string" },
        actor: { type: "string" },
        sticky: { type: "boolean" },
        ttlMs: { type: "number" }
      },
      required: ["tabId"]
    }
  },
  {
    name: "rzbrowse_lease_transfer",
    description: "Owner transfers a lease to another actor (rotates leaseToken).",
    inputSchema: {
      type: "object",
      properties: {
        leaseToken: { type: "string" },
        toActor: { type: "string" },
        toMissionId: { type: "string" },
        ttlMs: { type: "number" }
      },
      required: ["leaseToken", "toActor"]
    }
  },
  {
    name: "rzbrowse_lease_wait",
    description: "Wait until a tab lease is free or stealable (HTTP-only; does not block other browser jobs).",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        timeoutMs: { type: "number" }
      },
      required: ["tabId"]
    }
  }
];

const TOOLS = withLegacyAliases(CANONICAL_TOOLS);

const COMMAND_MAP_CANONICAL = {
  rzbrowse_tabs: "tabs",
  rzbrowse_context: "context",
  rzbrowse_navigate: "navigate",
  rzbrowse_tab_activate: "tab_activate",
  rzbrowse_tab_open: "tab_open",
  rzbrowse_tab_close: "tab_close",
  rzbrowse_next_tab: "next_tab",
  rzbrowse_previous_tab: "previous_tab",
  rzbrowse_reload: "reload",
  rzbrowse_back: "back",
  rzbrowse_forward: "forward",
  rzbrowse_reopen_closed_tab: "reopen_closed_tab",
  rzbrowse_hotkey: "hotkey",
  rzbrowse_snapshot: "snapshot",
  rzbrowse_find: "find",
  rzbrowse_click_at: "click_at",
  rzbrowse_screenshot: "screenshot",
  rzbrowse_click: "click",
  rzbrowse_type: "type",
  rzbrowse_fill: "fill",
  rzbrowse_select: "select",
  rzbrowse_scroll: "scroll",
  rzbrowse_wait: "wait",
  rzbrowse_insert_text: "insert_text",
  rzbrowse_press_keys: "press_keys",
  rzbrowse_evaluate: "evaluate"
};

const COMMAND_MAP = withLegacyMap(COMMAND_MAP_CANONICAL);

const LEASE_POST_TOOLS_CANONICAL = {
  rzbrowse_lease_claim: "/browser/leases/claim",
  rzbrowse_lease_release: "/browser/leases/release",
  rzbrowse_lease_steal: "/browser/leases/steal",
  rzbrowse_lease_transfer: "/browser/leases/transfer",
  rzbrowse_lease_wait: "/browser/leases/wait"
};
const LEASE_POST_TOOLS = withLegacyMap(LEASE_POST_TOOLS_CANONICAL);

function rememberLease(result) {
  const token = result?.leaseToken || result?.result?.leaseToken;
  const tabId = result?.tabId ?? result?.result?.tabId;
  if (token) {
    sessionLeaseToken = token;
    if (tabId !== undefined && tabId !== null) sessionLeaseTabId = Number(tabId);
  }
}

function attachLeaseArgs(toolName, args = {}) {
  const next = { ...args };
  if (MOTOR_TOOL_NAMES.has(toolName) && !next.leaseToken && sessionLeaseToken) {
    next.leaseToken = sessionLeaseToken;
    if ((next.tabId === undefined || next.tabId === null) && sessionLeaseTabId != null) {
      next.tabId = sessionLeaseTabId;
    }
  }
  return next;
}

async function bridgePost(path, body) {
  let response;
  try {
    response = await fetch(`${BRIDGE_URL}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {})
    });
  } catch (error) {
    throw new Error(`RZBrowse bridge is unreachable at ${BRIDGE_URL}: ${error?.message || String(error)}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = data?.code ? ` [${data.code}]` : "";
    throw new Error(`${data?.error || `Bridge request failed (${response.status}).`}${code}`);
  }
  return data.result ?? data;
}

async function bridgeExec(command, params) {
  let response;
  try {
    response = await fetch(`${BRIDGE_URL}/browser/exec`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command, params })
    });
  } catch (error) {
    throw new Error(`RZBrowse bridge is unreachable at ${BRIDGE_URL}: ${error?.message || String(error)}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body?.code ? ` [${body.code}]` : "";
    const status = body?.status ? ` ${JSON.stringify(body.status)}` : "";
    throw new Error(`${body?.error || `Bridge browser exec failed (${response.status}).`}${code}${status}`);
  }
  if (body.autoClaimed && body.leaseToken) {
    sessionLeaseToken = body.leaseToken;
    if (params?.tabId != null) sessionLeaseTabId = Number(params.tabId);
  }
  if (body.lease?.leaseToken) {
    sessionLeaseToken = body.lease.leaseToken;
    if (body.lease.tabId != null) sessionLeaseTabId = Number(body.lease.tabId);
  }
  return body.result ?? body;
}

async function bridgeGet(path) {
  let response;
  try {
    response = await fetch(`${BRIDGE_URL}${path}`);
  } catch (error) {
    throw new Error(`RZBrowse bridge is unreachable at ${BRIDGE_URL}: ${error?.message || String(error)}`);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `Bridge request failed (${response.status}).`);
  }
  return body;
}

const BRIDGE_GET_TOOLS_CANONICAL = {
  rzbrowse_bridge_status: "/browser/status",
  rzbrowse_workspaces_list: "/workspaces"
};
const BRIDGE_GET_TOOLS = withLegacyMap(BRIDGE_GET_TOOLS_CANONICAL);

function toolText(result) {
  const text =
    result?.mimeType === "image/png" && result?.dataUrl
      ? `Screenshot captured (${result.dataUrl.length} chars data URL).`
      : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
  return { content: [{ type: "text", text }] };
}

function runMcpServer() {
  const transport = createStdioTransport();

  function handleMessage(message) {
    const hasId = Object.hasOwn(message || {}, "id");
    if (!message?.method && !hasId) return;

    if (message.method === "initialize") {
      transport.write({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion || "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "rzbrowse", version: "0.4.24" }
        }
      });
      return;
    }

    if (message.method === "notifications/initialized") return;

    if (message.method === "ping") {
      transport.write({ jsonrpc: "2.0", id: message.id, result: {} });
      return;
    }

    if (message.method === "tools/list") {
      transport.write({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
      return;
    }

    if (message.method === "resources/list") {
      transport.write({ jsonrpc: "2.0", id: message.id, result: { resources: [] } });
      return;
    }

    if (message.method === "prompts/list") {
      transport.write({ jsonrpc: "2.0", id: message.id, result: { prompts: [] } });
      return;
    }

    if (message.method === "tools/call") {
      const toolName = message.params?.name;
      const rawArgs = message.params?.arguments || {};
      const args = attachLeaseArgs(toolName, rawArgs);
      const bridgePath = BRIDGE_GET_TOOLS[toolName];
      const leasePath = LEASE_POST_TOOLS[toolName];
      let work;
      if (bridgePath) {
        work = bridgeGet(bridgePath);
      } else if (toolName === "rzbrowse_lease_list" || toolName === "dlh_browser_lease_list") {
        work = bridgeGet("/browser/leases");
      } else if (leasePath) {
        work = bridgePost(leasePath, args).then((result) => {
          rememberLease(result);
          return result;
        });
      } else {
        const command = COMMAND_MAP[toolName];
        if (!command) work = Promise.reject(new Error(`Unknown tool: ${toolName}`));
        else work = bridgeExec(command, args);
      }

      return Promise.resolve(work)
        .then((result) => {
          transport.write({ jsonrpc: "2.0", id: message.id, result: toolText(result) });
        })
        .catch((error) => {
          transport.write({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32000, message: error.message }
          });
        });
    }

    if (hasId) {
      transport.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Method not found: ${message.method}` }
      });
    }
  }

  function loop() {
    transport
      .read()
      .then((message) => Promise.resolve(handleMessage(message)).then(loop))
      .catch((error) => {
        console.error(error?.stack || error?.message || String(error));
        process.exit(1);
      });
  }

  loop();
}

runMcpServer();
