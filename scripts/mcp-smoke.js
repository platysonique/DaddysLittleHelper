#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const listOnly = process.argv.includes("--list-only");
const url = process.argv.find((arg) => arg.startsWith("--url="))?.slice("--url=".length) || "https://tigertech.net";

const child = spawn(join(projectRoot, "scripts", "run-mcp.sh"), {
  cwd: projectRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    DLH_ROOT: projectRoot,
    DLH_BRIDGE_URL: process.env.DLH_BRIDGE_URL || "http://127.0.0.1:3847"
  }
});

let buffer = Buffer.alloc(0);

function send(message) {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  child.stdin.write(body);
}

function read(timeoutMs = 90_000) {
  return new Promise((resolveRead, rejectRead) => {
    const timer = setTimeout(() => rejectRead(new Error("MCP smoke timed out.")), timeoutMs);
    const tryParse = () => {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = buffer.slice(0, headerEnd).toString("utf8");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) return;
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      if (buffer.length < bodyStart + length) return;
      const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
      buffer = buffer.slice(bodyStart + length);
      clearTimeout(timer);
      child.stdout.off("data", onData);
      resolveRead(JSON.parse(body));
    };
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      tryParse();
    };
    child.stdout.on("data", onData);
    tryParse();
  });
}

try {
  send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
  await read();
  send({ jsonrpc: "2.0", method: "notifications/initialized", params: {} });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  const tools = await read();
  const toolNames = tools.result?.tools?.map((tool) => tool.name) || [];
  if (!toolNames.includes("rzbrowse_navigate")) {
    throw new Error(`rzbrowse_navigate missing. Tools: ${toolNames.join(", ")}`);
  }
  if (listOnly) {
    console.log(`MCP tools OK (${toolNames.length} tools).`);
  } else {
    send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "rzbrowse_navigate", arguments: { url } }
    });
    const navigate = await read(120_000);
    if (navigate.error) throw new Error(navigate.error.message || "MCP navigate failed.");
    console.log(navigate.result?.content?.[0]?.text || JSON.stringify(navigate));
  }
  child.kill();
} catch (error) {
  child.kill();
  const stderr = child.stderr.read()?.toString("utf8") || "";
  console.error(`${error.message}${stderr ? `\n${stderr}` : ""}`);
  process.exit(1);
}
