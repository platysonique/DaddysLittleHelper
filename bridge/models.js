import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AGENT_BIN } from "./config.js";

const execFileAsync = promisify(execFile);

function parseModels(output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/no models available|available models|^tip:/i.test(line));

  const models = [];
  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s*/, "");
    if (!cleaned.includes(" - ")) continue;
    const [idPart, ...labelParts] = cleaned.split(" - ");
    const id = idPart?.trim();
    if (!id || id.includes(":")) continue;
    const label = labelParts.join(" - ").replace(/\s+\((current|default)\)$/i, "").trim() || id;
    models.push({ id, label });
  }

  const seen = new Set();
  return [{ id: "auto", label: "Auto" }, ...models].filter((model) => {
    if (seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

export async function listModels() {
  const attempts = [
    [AGENT_BIN, ["models"]],
    [AGENT_BIN, ["--list-models"]]
  ];

  for (const [cmd, args] of attempts) {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, { timeout: 10000 });
      const parsed = parseModels(`${stdout}\n${stderr}`);
      if (parsed.length > 1) return parsed;
    } catch {
      // Try the next documented command shape.
    }
  }

  return [
    {
      id: "auto",
      label: "Auto"
    }
  ];
}
