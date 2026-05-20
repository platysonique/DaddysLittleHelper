import { execFile } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function querySqlite(dbPath, sql) {
  const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
    maxBuffer: 16 * 1024 * 1024
  });
  return stdout.trim();
}

export async function readJsonValue(dbPath, key) {
  const escaped = key.replace(/'/g, "''");
  const raw = await querySqlite(dbPath, `SELECT value FROM ItemTable WHERE key='${escaped}' LIMIT 1;`);
  if (!raw) return null;
  return JSON.parse(raw);
}

export async function writeJsonValue(dbPath, key, value) {
  const backupPath = `${dbPath}.dlh-backup-${Date.now()}`;
  await copyFile(dbPath, backupPath);
  const escapedKey = key.replace(/'/g, "''");
  const escapedValue = JSON.stringify(value).replace(/'/g, "''");
  await querySqlite(
    dbPath,
    `INSERT OR REPLACE INTO ItemTable (key, value) VALUES ('${escapedKey}', '${escapedValue}');`
  );
  return { backupPath };
}
