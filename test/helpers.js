import { JSDOM } from "jsdom";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export function setupDom(html) {
  const dom = new JSDOM(html, { url: "https://example.com" });
  const doc = dom.window.document;
  const view = dom.window;
  // jsdom often returns null from elementFromPoint; treat elements as reachable in unit tests.
  doc.elementFromPoint = (x, y) => {
    const stack = doc.elementsFromPoint?.(x, y);
    if (stack?.length) return stack[0];
    const el = doc.elementFromPoint?.call(doc, x, y);
    if (el) return el;
    return doc.body;
  };
  if (!view.Node) view.Node = { ELEMENT_NODE: 1 };
  return dom;
}

export function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    }
  };
}

export async function enableAutomationForTests() {
  const dataDir = join(projectRoot, "data");
  await mkdir(dataDir, { recursive: true });
  await writeFile(
    join(dataDir, "settings.json"),
    `${JSON.stringify({ browserAutomationEnabled: true, quickPrompts: [] }, null, 2)}\n`,
    "utf8"
  );
}
