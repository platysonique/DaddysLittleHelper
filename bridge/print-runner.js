import { spawn } from "node:child_process";
import readline from "node:readline";
import { AGENT_BIN, DEFAULT_MODEL } from "./config.js";

export function startPrintAgent({ cwd, model = DEFAULT_MODEL, prompt, cursorChatId, onEvent }) {
  const args = [
    "-p",
    "--trust",
    "--approve-mcps",
    "--output-format",
    "stream-json",
    "--stream-partial-output"
  ];

  if (model && model !== "auto") args.push("--model", model);
  if (cursorChatId) args.push("--resume", cursorChatId);
  args.push("--workspace", cwd, prompt);

  const child = spawn(AGENT_BIN, args, {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });

  const final = [];
  child.stderr.on("data", (chunk) => {
    onEvent?.({ type: "stderr", text: String(chunk) });
  });

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      onEvent?.(event);
      if (event.type === "result") final.push(event);
    } catch {
      onEvent?.({ type: "stdout", text: line });
    }
  });

  const promise = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ status: "finished", events: final });
      else reject(new Error(`agent -p exited (${code ?? signal})`));
    });
  });

  return {
    child,
    promise,
    cancel() {
      child.kill("SIGTERM");
    }
  };
}

export function runPrintAgent(options) {
  const run = startPrintAgent(options);
  return run.promise;
}
