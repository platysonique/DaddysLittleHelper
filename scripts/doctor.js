import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function command(cmd, args, options = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (c) => stdout += c);
    child.stderr.on("data", (c) => stderr += c);
    child.once("exit", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
    child.once("error", (error) => resolve({ ok: false, code: -1, stdout, stderr: error.message }));
  });
}

function get(url) {
  return new Promise((resolve) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, body: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", (error) => resolve({ ok: false, body: error.message }));
  });
}

function line(ok, label, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  return ok ? 0 : 1;
}

let failures = 0;

const nodeMajor = Number(process.versions.node.split(".")[0]);
failures += line(nodeMajor >= 20, "Node.js 20+", process.version);

const agentVersion = await command("agent", ["--version"]);
failures += line(agentVersion.ok, "Cursor CLI", agentVersion.stdout.trim() || agentVersion.stderr.trim());

const agentStatus = await command("agent", ["status"]);
failures += line(agentStatus.ok && /logged in/i.test(agentStatus.stdout), "Cursor CLI logged in", agentStatus.stdout.trim());

const mcpList = await command("agent", ["mcp", "list"], { cwd: projectRoot });
failures += line(/dlh-browser:\s+ready/i.test(`${mcpList.stdout}\n${mcpList.stderr}`), "dlh-browser MCP ready");

let mcpConfig;
try {
  mcpConfig = JSON.parse(await readFile(join(projectRoot, ".cursor/mcp.json"), "utf8"));
  failures += line(Boolean(mcpConfig?.mcpServers?.["dlh-browser"]), "Project MCP config");
} catch {
  failures += line(false, "Project MCP config");
}

const systemd = await command("systemctl", ["--user", "is-active", "daddyslittlehelper"]);
failures += line(systemd.stdout.trim() === "active", "Bridge systemd service active", systemd.stdout.trim() || systemd.stderr.trim());

const health = await get("http://127.0.0.1:3847/health");
failures += line(health.ok, "Bridge /health", health.body?.trim?.().slice(0, 80));

const browser = await get("http://127.0.0.1:3847/browser/status");
let extensionConnected = false;
try {
  extensionConnected = JSON.parse(browser.body).connected === true;
} catch {
  extensionConnected = false;
}
let browserStatus = {};
try {
  browserStatus = JSON.parse(browser.body);
} catch {
  browserStatus = {};
}
const automationOn = browserStatus.browserAutomationEnabled === true;
failures += line(
  browser.ok && extensionConnected && automationOn,
  "Extension linked with automation ON",
  browser.body?.trim?.().slice(0, 120)
);
if (browser.ok && extensionConnected && !automationOn) {
  console.log("WARN Browser automation toggle is OFF — enable it in the side panel for agent control.");
}

const models = await get("http://127.0.0.1:3847/models");
let modelCount = 0;
try {
  modelCount = JSON.parse(models.body).models?.length || 0;
} catch {
  modelCount = 0;
}
failures += line(models.ok && modelCount > 1, "Model list", `${modelCount} models`);

let extensionInstalled = false;
let extensionDetail = "not registered";
try {
  const meta = JSON.parse(
    await readFile(join(homedir(), ".config", "daddyslittlehelper", "extension.json"), "utf8")
  );
  await stat(meta.extensionPath);
  extensionInstalled = Boolean(meta.extensionId);
  extensionDetail = `${meta.extensionId} (${meta.packed ? "CRX" : "path"})`;
} catch {
  extensionInstalled = false;
}
failures += line(extensionInstalled, "Extension registered for Vivaldi", extensionDetail);

const tests = await command("npm", ["test"], { cwd: projectRoot });
failures += line(
  tests.ok,
  "Unit tests",
  tests.ok ? "ok" : (tests.stderr.trim() || tests.stdout.trim() || `exit ${tests.code}`)
);

console.log("\nNotes:");
console.log("- After ./install.sh, restart Vivaldi once so External Extensions load.");
console.log("- If extension-linked FAIL: open Vivaldi, or run: vivaldi-dlh");
console.log("- Re-run ./install.sh after pulling updates (idempotent).");

process.exit(failures === 0 ? 0 : 1);
