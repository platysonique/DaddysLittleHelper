#!/usr/bin/env node
import { createStdioTransport } from "./stdio.js";

const BRIDGE_URL = process.env.DLH_BRIDGE_URL || "http://127.0.0.1:3847";

const frameProps = {
  frameId: { type: "number", description: "Frame id from snapshot (0 = top)." },
  refGeneration: { type: "number", description: "refGeneration from the latest snapshot for that frame." }
};

const TOOLS = [
  {
    name: "dlh_browser_tabs",
    description: "List open tabs in the current Vivaldi window.",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "dlh_browser_navigate",
    description: "Navigate the target tab to a URL.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, tabId: { type: "number" } },
      required: ["url"]
    }
  },
  {
    name: "dlh_browser_snapshot",
    description:
      "Capture interactive tree (@ refs). Tries fast content-script path first; auto-escalates to CDP/Accessibility when frames are missing or the tree is thin.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "number" },
        allFrames: { type: "boolean", description: "Set false to snapshot top frame only." }
      }
    }
  },
  {
    name: "dlh_browser_click_at",
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
    name: "dlh_browser_find",
    description: "Search interactive elements by label/role/ref text. Returns ranked @ refs (runs a fresh snapshot).",
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
    name: "dlh_browser_screenshot",
    description: "Capture viewport PNG of the tab window as a data URL.",
    inputSchema: { type: "object", properties: { tabId: { type: "number" } } }
  },
  {
    name: "dlh_browser_click",
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
    name: "dlh_browser_type",
    description: "Type text into an element by @ ref.",
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
    name: "dlh_browser_fill",
    description: "Replace input value by @ ref.",
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
    name: "dlh_browser_select",
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
    name: "dlh_browser_scroll",
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
    name: "dlh_browser_wait",
    description: "Wait milliseconds in page context.",
    inputSchema: {
      type: "object",
      properties: { ms: { type: "number" }, tabId: { type: "number" }, frameId: frameProps.frameId }
    }
  }
];

const COMMAND_MAP = {
  dlh_browser_tabs: "tabs",
  dlh_browser_navigate: "navigate",
  dlh_browser_snapshot: "snapshot",
  dlh_browser_find: "find",
  dlh_browser_click_at: "click_at",
  dlh_browser_screenshot: "screenshot",
  dlh_browser_click: "click",
  dlh_browser_type: "type",
  dlh_browser_fill: "fill",
  dlh_browser_select: "select",
  dlh_browser_scroll: "scroll",
  dlh_browser_wait: "wait"
};

async function bridgeExec(command, params) {
  const response = await fetch(`${BRIDGE_URL}/browser/exec`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, params })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || `Bridge browser exec failed (${response.status}).`);
  }
  return body.result ?? body;
}

function toolText(result) {
  const text =
    result?.mimeType === "image/png" && result?.dataUrl
      ? `Screenshot captured (${result.dataUrl.length} chars data URL).`
      : typeof result === "string"
        ? result
        : JSON.stringify(result, null, 2);
  return { content: [{ type: "text", text }] };
}

const transport = createStdioTransport();

while (true) {
  const message = await transport.read();
  if (!message?.method && !message?.id) continue;

  if (message.method === "initialize") {
    transport.write({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "dlh-browser", version: "0.3.1" }
      }
    });
    continue;
  }

  if (message.method === "notifications/initialized") continue;

  if (message.method === "tools/list") {
    transport.write({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
    continue;
  }

  if (message.method === "tools/call") {
    const toolName = message.params?.name;
    const args = message.params?.arguments || {};
    try {
      const command = COMMAND_MAP[toolName];
      if (!command) throw new Error(`Unknown tool: ${toolName}`);
      const result = await bridgeExec(command, args);
      transport.write({ jsonrpc: "2.0", id: message.id, result: toolText(result) });
    } catch (error) {
      transport.write({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: error.message }
      });
    }
    continue;
  }

  if (message.id) {
    transport.write({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` }
    });
  }
}
