import http from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch (error) {
          reject(error);
        }
      });
    }).on("error", reject);
  });
}

function commandOk(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "ignore" });
    child.once("exit", (code) => resolve(code === 0));
    child.once("error", () => resolve(false));
  });
}

const checks = [];

checks.push(["agent CLI", await commandOk("agent", ["--version"])]);
checks.push(["node >= 20", Number(process.versions.node.split(".")[0]) >= 20]);

try {
  const health = await getJson("http://127.0.0.1:3847/health");
  checks.push(["bridge /health", health.ok === true]);
} catch {
  checks.push(["bridge /health", false]);
}

try {
  const mcp = JSON.parse(await readFile(new URL("../.cursor/mcp.json", import.meta.url), "utf8"));
  const dlh = mcp?.mcpServers?.["dlh-browser"];
  checks.push(["DLH browser MCP configured", dlh?.command === "node" && Array.isArray(dlh?.args) && dlh.args.length > 0]);
} catch {
  checks.push(["DLH browser MCP configured", false]);
}

try {
  const status = await getJson("http://127.0.0.1:3847/browser/status");
  checks.push(["extension bridge link", status.connected === true]);
} catch {
  checks.push(["extension bridge link", false]);
}

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) failed += 1;
}

process.exit(failed === 0 ? 0 : 1);
