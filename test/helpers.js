import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

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
