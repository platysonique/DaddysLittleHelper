import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcpEntry = join(projectRoot, "mcp", "dlh-browser.js");
const mcpLauncher = join(projectRoot, "scripts", "run-mcp.sh");
const globalTarget = join(homedir(), ".cursor", "mcp.json");
const projectTarget = join(projectRoot, ".cursor", "mcp.json");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveNodeCommand() {
  if (process.env.DLH_NODE_BIN && await exists(process.env.DLH_NODE_BIN)) return process.env.DLH_NODE_BIN;
  for (const candidate of ["/usr/bin/node", "/usr/local/bin/node", "/opt/node/bin/node"]) {
    if (await exists(candidate)) return candidate;
  }
  return "node";
}

const desired = {
  command: "/bin/bash",
  args: [mcpLauncher],
  env: {
    DLH_ROOT: projectRoot,
    DLH_NODE_BIN: await resolveNodeCommand(),
    DLH_BRIDGE_URL: "http://127.0.0.1:3847"
  }
};

async function readConfig(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { mcpServers: {} };
    throw error;
  }
}

async function writeConfig(path, config) {
  config.mcpServers ||= {};
  config.mcpServers["dlh-browser"] = desired;
  delete config.mcpServers.playwright;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

const globalConfig = await readConfig(globalTarget);
await writeConfig(globalTarget, globalConfig);
console.log(`Ensured dlh-browser MCP in ${globalTarget}`);

const projectConfig = await readConfig(projectTarget);
await writeConfig(projectTarget, projectConfig);
console.log(`Ensured dlh-browser MCP in ${projectTarget}`);
