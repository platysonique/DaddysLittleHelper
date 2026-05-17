import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mcpEntry = join(projectRoot, "mcp", "dlh-browser.js");
const globalTarget = join(homedir(), ".cursor", "mcp.json");
const projectTarget = join(projectRoot, ".cursor", "mcp.json");

const desired = {
  command: "node",
  args: [mcpEntry],
  env: {
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
