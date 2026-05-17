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
        const headerEnd = buffer.indexOf("\r\n\r\n");
        if (headerEnd === -1) break;
        const header = buffer.slice(0, headerEnd).toString("utf8");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          buffer = buffer.slice(headerEnd + 4);
          continue;
        }
        const length = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (buffer.length < bodyStart + length) break;
        const body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
        buffer = buffer.slice(bodyStart + length);
        try {
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
      process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
    }
  };
}
