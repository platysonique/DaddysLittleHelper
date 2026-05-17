import { randomUUID } from "node:crypto";
import { isBrowserAutomationEnabled } from "./settings.js";

const AUTOMATION_OFF_MSG =
  "Browser automation is OFF. Turn it on in the DaddysLittleHelper side panel (Browser automation toggle).";

const DEFAULT_TIMEOUT_MS = 45_000;
const queue = [];
const waiters = [];
const pending = new Map();
const activityLog = [];

let lastExtensionPing = 0;

export function markExtensionAlive() {
  lastExtensionPing = Date.now();
}

export function extensionStatus() {
  const connected = Date.now() - lastExtensionPing < 60_000;
  return {
    connected,
    lastSeenMs: lastExtensionPing || null,
    queueDepth: queue.length
  };
}

export function logBrowserActivity(entry) {
  activityLog.push({ at: Date.now(), ...entry });
  while (activityLog.length > 120) activityLog.shift();
}

export function getBrowserActivity(since = 0) {
  return activityLog.filter((item) => item.at > since);
}

function notifyWaiters() {
  while (queue.length && waiters.length) {
    const waiter = waiters.shift();
    const job = queue.shift();
    waiter(job);
  }
}

export function waitForJob(timeoutMs = 25_000) {
  markExtensionAlive();
  return new Promise((resolve) => {
    if (queue.length) {
      resolve(queue.shift());
      return;
    }
    const timer = setTimeout(() => {
      const index = waiters.indexOf(onJob);
      if (index >= 0) waiters.splice(index, 1);
      resolve(null);
    }, timeoutMs);
    const onJob = (job) => {
      clearTimeout(timer);
      resolve(job);
    };
    waiters.push(onJob);
  });
}

export async function runBrowserCommand(command, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!(await isBrowserAutomationEnabled())) {
    logBrowserActivity({ phase: "blocked", command, reason: "automation_off" });
    throw new Error(AUTOMATION_OFF_MSG);
  }

  const id = randomUUID();
  logBrowserActivity({ phase: "start", command, params });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      logBrowserActivity({ phase: "timeout", command });
      reject(new Error(`Browser command timed out after ${timeoutMs}ms. Is Vivaldi open with DaddysLittleHelper enabled?`));
    }, timeoutMs);

    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer);
        pending.delete(id);
        logBrowserActivity({ phase: "done", command, ok: true });
        resolve(result ?? {});
      },
      reject: (error) => {
        clearTimeout(timer);
        pending.delete(id);
        logBrowserActivity({ phase: "done", command, ok: false, error: error.message });
        reject(error);
      }
    });

    queue.push({ id, command, params });
    notifyWaiters();
  });
}

export function completeBrowserCommand(id, result, error) {
  const entry = pending.get(id);
  if (!entry) return false;
  if (error) entry.reject(new Error(error));
  else entry.resolve(result ?? {});
  return true;
}
