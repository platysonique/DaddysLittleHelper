import { appendFileSync } from "node:fs";

const DEBUG_LOG = process.env.DLH_MCP_DEBUG_LOG || "";

function debug(line) {
  if (!DEBUG_LOG) return;
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Debug logging is best-effort and only active when explicitly enabled.
  }
}

export function createStdioTransport() {
  const pending = [];
  let buffer = Buffer.alloc(0);
  let waiters = [];

  function flushWaiters() {
    while (pending.length && waiters.length) {
      waiters.shift()(pending.shift());
    }
  }

  process.stdin.on("readable", () => {
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        let headerEnd = buffer.indexOf("\r\n\r\n");
        let delimiterLength = 4;
        if (headerEnd === -1) {
          headerEnd = buffer.indexOf("\n\n");
          delimiterLength = 2;
        }
        if (headerEnd === -1) break;
        const header = buffer.slice(0, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = buffer.slice(headerEnd + delimiterLength);
          continue;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + delimiterLength;
        if (buffer.length < bodyStart + length) break;
        const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
        buffer = buffer.slice(bodyStart + length);
        try {
          debug(`read ${body}`);
          pending.push(JSON.parse(body));
          flushWaiters();
        } catch {
          // ignore malformed payloads
        }
      }
    }
  });

  return {
    read() {
      if (pending.length) return Promise.resolve(pending.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
    write(message) {
      const body = JSON.stringify(message);
      debug(`write ${body}`);
      process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    }
  };
}
