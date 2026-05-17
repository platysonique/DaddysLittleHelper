import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const scriptDir = dirname(fileURLToPath(import.meta.url));
let projectRoot = resolve(scriptDir, "..");
const serviceName = "daddyslittlehelper.service";
const templatePath = join(scriptDir, serviceName);
const unitDir = join(homedir(), ".config", "systemd", "user");
const unitPath = join(unitDir, serviceName);
const statePath = join(homedir(), ".config", "daddyslittlehelper", "install.env");

async function loadProjectRoot() {
  try {
    const env = await readFile(statePath, "utf8");
    const match = env.match(/^DLH_ROOT=(.+)$/m);
    if (match) return resolve(match[1].trim());
  } catch {
    // use script-relative root
  }
  return projectRoot;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
    child.once("error", reject);
  });
}

projectRoot = await loadProjectRoot();
const bridgeEntry = join(projectRoot, "bridge", "server.js");

let unit = await readFile(templatePath, "utf8");
unit = unit.replace(/^WorkingDirectory=.*$/m, `WorkingDirectory=${projectRoot}`);
unit = unit.replace(/^ExecStart=.*$/m, `ExecStart=${process.execPath} ${bridgeEntry}`);
unit = unit.replace(
  /^Environment=DLH_HOST=.*$/m,
  `Environment=DLH_HOST=127.0.0.1\nEnvironment=DLH_ROOT=${projectRoot}`
);

await mkdir(unitDir, { recursive: true });
await writeFile(unitPath, unit, "utf8");
console.log(`Wrote ${unitPath}`);

await run("systemctl", ["--user", "daemon-reload"]);
await run("systemctl", ["--user", "enable", "--now", serviceName]);
await run("systemctl", ["--user", "restart", serviceName]);
console.log("DaddysLittleHelper bridge service is enabled and running.");
