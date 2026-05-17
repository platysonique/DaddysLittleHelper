import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import readline from "node:readline";
import { AGENT_BIN, DEFAULT_MODEL } from "./config.js";

export class AcpClient extends EventEmitter {
  constructor({ cwd, model = DEFAULT_MODEL, permissionMode = "allow-once" }) {
    super();
    this.cwd = cwd;
    this.model = model || DEFAULT_MODEL;
    this.permissionMode = permissionMode;
    this.nextId = 1;
    this.pending = new Map();
    this.sessionId = null;
    this.ready = false;
  }

  start() {
    if (this.child) return;
    const args = [];
    if (this.model && this.model !== "auto") args.push("--model", this.model);
    args.push("acp");

    this.child = spawn(AGENT_BIN, args, {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env
    });

    this.child.stderr.on("data", (chunk) => {
      this.emit("stderr", String(chunk));
    });

    this.child.once("exit", (code, signal) => {
      this.ready = false;
      this.emit("exit", { code, signal });
      for (const { reject } of this.pending.values()) {
        reject(new Error(`agent acp exited (${code ?? signal})`));
      }
      this.pending.clear();
    });

    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on("line", (line) => this.handleLine(line));
  }

  handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.emit("notification", { method: "stdout", params: { line } });
      return;
    }

    if (message.id && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
      else waiter.resolve(message.result);
      return;
    }

    if (message.method === "session/request_permission") {
      this.respond(message.id, this.permissionResponse());
      return;
    }

    if (message.method === "cursor/ask_question") {
      this.respond(message.id, { outcome: { outcome: "skipped", reason: "DaddysLittleHelper UI does not yet support blocking questions." } });
      return;
    }

    if (message.method === "cursor/create_plan") {
      this.respond(message.id, { outcome: { outcome: "rejected", reason: "Plan creation is disabled from browser panel tasks." } });
      return;
    }

    this.emit("notification", message);
  }

  permissionResponse() {
    const optionId = this.permissionMode === "allow-always" ? "allow-always" : this.permissionMode === "reject-once" ? "reject-once" : "allow-once";
    return { outcome: { outcome: "selected", optionId } };
  }

  send(method, params = {}) {
    if (!this.child) this.start();
    const id = this.nextId++;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`ACP request timed out: ${method}`));
      }, 30000);
    });
  }

  respond(id, result) {
    if (!id || !this.child) return;
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
  }

  async initialize() {
    this.start();
    await this.send("initialize", {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false
      },
      clientInfo: { name: "DaddysLittleHelper", version: "0.1.0" }
    });
    await this.send("authenticate", { methodId: "cursor_login" });
    const session = await this.send("session/new", { cwd: this.cwd });
    this.sessionId = session?.sessionId;
    if (!this.sessionId) throw new Error("ACP session/new did not return a sessionId.");
    this.ready = true;
    return { sessionId: this.sessionId, model: this.model, cwd: this.cwd };
  }

  async prompt({ text, onEvent }) {
    if (!this.ready) await this.initialize();
    const handler = (message) => onEvent?.(message);
    this.on("notification", handler);
    try {
      return await this.send("session/prompt", {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }]
      });
    } finally {
      this.off("notification", handler);
    }
  }

  stop() {
    this.child?.kill();
    this.child = null;
    this.ready = false;
  }
}
