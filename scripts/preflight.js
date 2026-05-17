import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import http from "node:http";

function command(command, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.once("exit", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
    child.once("error", (error) => resolve({ ok: false, code: -1, stdout, stderr: error.message }));
  });
}

function get(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", (error) => resolve({ ok: false, body: error.message }));
  });
}

function line(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  return ok ? 0 : 1;
}

let failures = 0;

const agentVersion = await command("agent", ["--version"]);
failures += line(agentVersion.ok, "Cursor CLI installed", agentVersion.stdout.trim() || agentVersion.stderr.trim());

const agentStatus = await command("agent", ["status"]);
failures += line(agentStatus.ok && /logged in/i.test(agentStatus.stdout), "Cursor CLI logged in", agentStatus.stdout.trim());

const mcpList = await command("agent", ["mcp", "list"]);
failures += line(/dlh-browser:\s+ready/i.test(`${mcpList.stdout}\n${mcpList.stderr}`), "DLH browser MCP approved", "expected dlh-browser: ready");

const mcpConfig = JSON.parse(await readFile(new URL("../.cursor/mcp.json", import.meta.url), "utf8"));
const dlhMcp = mcpConfig?.mcpServers?.["dlh-browser"];
failures += line(Boolean(dlhMcp?.command === "node" && dlhMcp?.args?.length), "Project MCP uses built-in dlh-browser");

const bridge = await get("http://127.0.0.1:3847/health");
failures += line(bridge.ok, "Bridge is running", bridge.body.trim());

const models = await get("http://127.0.0.1:3847/models");
let modelCount = 0;
try {
  modelCount = JSON.parse(models.body).models?.length || 0;
} catch {
  modelCount = 0;
}
failures += line(models.ok && modelCount > 1, "Model list populated", `${modelCount} models`);

const browser = await get("http://127.0.0.1:3847/browser/status");
let extensionConnected = false;
try {
  extensionConnected = JSON.parse(browser.body).connected === true;
} catch {
  extensionConnected = false;
}
failures += line(browser.ok && extensionConnected, "Extension connected to bridge", browser.body.trim());

console.log("\nManual checks:");
console.log("1. DaddysLittleHelper extension is loaded unpacked from ./extension.");
console.log("2. Reload DaddysLittleHelper after code changes.");
console.log("3. Vivaldi should be open so the extension can attach to the bridge.");

process.exit(failures === 0 ? 0 : 1);
