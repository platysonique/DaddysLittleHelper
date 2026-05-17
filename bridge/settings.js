import { readJson, writeJson } from "./json-store.js";
import { SETTINGS_FILE } from "./config.js";

const DEFAULT_SETTINGS = {
  /** Master switch: when false, bridge and extension reject all browser automation. */
  browserAutomationEnabled: false,
  quickPrompts: [
    { id: "summarize", label: "Summarize tab", text: "Summarize the current page for me in bullet points." },
    { id: "next-steps", label: "Suggest next steps", text: "Based on this page and project, what should I do next?" }
  ]
};

export async function loadSettings() {
  const settings = await readJson(SETTINGS_FILE, DEFAULT_SETTINGS);
  settings.quickPrompts ||= DEFAULT_SETTINGS.quickPrompts;
  if (settings.browserAutomationEnabled === undefined) {
    settings.browserAutomationEnabled = DEFAULT_SETTINGS.browserAutomationEnabled;
  }
  return settings;
}

export async function isBrowserAutomationEnabled() {
  const settings = await loadSettings();
  return Boolean(settings.browserAutomationEnabled);
}

export async function saveSettings(patch) {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  await writeJson(SETTINGS_FILE, next);
  return next;
}
