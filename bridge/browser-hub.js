import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isBrowserAutomationEnabled } from "./settings.js";

const AUTOMATION_OFF_MSG =
  "Browser automation is OFF. Turn it on in the DaddysLittleHelper side panel (Browser automation toggle).";

const DEFAULT_TIMEOUT_MS = 45_000;
const queue = [];
const waiters = [];
const pending = new Map();
const activityLog = [];
const extensionMetaPath = join(homedir(), ".config", "daddyslittlehelper", "extension.json");

let lastExtensionPing = 0;
let connectedIdentity = null;
let expectedExtensionOverride = null;

export function setExpectedExtensionForTests(expected) {
  expectedExtensionOverride = expected;
}

function readExpectedExtension() {
  if (expectedExtensionOverride) return expectedExtensionOverride;
  try {
    const meta = JSON.parse(readFileSync(extensionMetaPath, "utf8"));
    return {
      extensionId: meta.extensionId || null,
      version: meta.version || meta.extensionVersion || null,
      name: meta.name || "DaddysLittleHelper",
      extensionPath: meta.extensionPath || null,
      updatedAt: meta.updatedAt || null
    };
  } catch {
    return null;
  }
}

function normalizeIdentity(input = {}) {
  const identity = input.identity || input;
  if (!identity || typeof identity !== "object") return null;
  return {
    extensionId: identity.extensionId || identity.id || null,
    version: identity.version || null,
    name: identity.name || null,
    runtimeSessionId: identity.runtimeSessionId || identity.sessionId || null
  };
}

function identityState({ connected, expected, actual }) {
  if (!connected) return "not_connected";
  if (!actual?.extensionId) return "unknown_extension";
  if (!expected?.extensionId) return "no_expected_extension";
  if (actual.extensionId !== expected.extensionId) return "wrong_extension";
  if (expected.version && actual.version && actual.version !== expected.version) return "wrong_version";
  return "matched";
}

export function markExtensionAlive(identity = {}) {
  lastExtensionPing = Date.now();
  const nextIdentity = normalizeIdentity(identity);
  if (nextIdentity?.extensionId) {
    connectedIdentity = {
      ...nextIdentity,
      connectedAt: connectedIdentity?.runtimeSessionId === nextIdentity.runtimeSessionId ? connectedIdentity.connectedAt : lastExtensionPing,
      lastSeenAt: lastExtensionPing
    };
  }
}

export async function extensionStatus() {
  const connected = Date.now() - lastExtensionPing < 60_000;
  const expected = readExpectedExtension();
  const identity = connected ? connectedIdentity : null;
  const status = identityState({ connected, expected, actual: identity });
  const browserAutomationEnabled = await isBrowserAutomationEnabled();
  return {
    connected,
    status,
    automationActive: connected && status === "matched" && browserAutomationEnabled,
    browserAutomationEnabled,
    lastSeenMs: lastExtensionPing || null,
    identity,
    expected,
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
    const jobIndex = queue.findIndex((job) =>
      waiters.some((waiter) => waiter.runtimeSessionId && job.runtimeSessionId === waiter.runtimeSessionId)
    );
    if (jobIndex < 0) return;
    const job = queue.splice(jobIndex, 1)[0];
    const waiterIndex = waiters.findIndex((waiter) => waiter.runtimeSessionId && job.runtimeSessionId === waiter.runtimeSessionId);
    const waiter = waiters.splice(waiterIndex, 1)[0];
    clearTimeout(waiter.timer);
    waiter.resolve(job);
  }
}

export function waitForJob(timeoutMs = 25_000, identity = {}) {
  markExtensionAlive(identity);
  const actual = normalizeIdentity(identity);
  return new Promise((resolve) => {
    const index = queue.findIndex((job) => actual?.runtimeSessionId && job.runtimeSessionId === actual.runtimeSessionId);
    if (index >= 0) {
      resolve(queue.splice(index, 1)[0]);
      return;
    }
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      resolve(null);
    }, timeoutMs);
    const waiter = { resolve, timer, runtimeSessionId: actual?.runtimeSessionId || null };
    waiters.push(waiter);
  });
}

export async function runBrowserCommand(command, params = {}, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!(await isBrowserAutomationEnabled())) {
    logBrowserActivity({ phase: "blocked", command, reason: "automation_off" });
    throw new Error(AUTOMATION_OFF_MSG);
  }

  const status = await extensionStatus();
  if (!status.connected) {
    throw new Error("DaddysLittleHelper extension is not connected. Open Vivaldi with the installed extension, then reload the side panel.");
  }
  if (status.status !== "matched") {
    const actual = status.identity?.extensionId || "unknown";
    const expected = status.expected?.extensionId || "unknown";
    throw new Error(`Wrong DaddysLittleHelper extension connected: ${actual} expected ${expected}.`);
  }

  const id = randomUUID();
  const runtimeSessionId = status.identity?.runtimeSessionId || null;
  logBrowserActivity({ phase: "start", command, params, runtimeSessionId });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      logBrowserActivity({ phase: "timeout", command });
      reject(new Error(`Browser command timed out after ${timeoutMs}ms. Is Vivaldi open with DaddysLittleHelper enabled?`));
    }, timeoutMs);

    pending.set(id, {
      runtimeSessionId,
      resolve: (result) => {
        clearTimeout(timer);
        pending.delete(id);
        logBrowserActivity({ phase: "done", command, ok: true, runtimeSessionId });
        resolve(result ?? {});
      },
      reject: (error) => {
        clearTimeout(timer);
        pending.delete(id);
        logBrowserActivity({ phase: "done", command, ok: false, error: error.message, runtimeSessionId });
        reject(error);
      }
    });

    queue.push({ id, command, params, runtimeSessionId });
    notifyWaiters();
  });
}

export function completeBrowserCommand(id, result, error, identity = {}) {
  const entry = pending.get(id);
  if (!entry) return false;
  const actual = normalizeIdentity(identity);
  if (entry.runtimeSessionId && actual?.runtimeSessionId && entry.runtimeSessionId !== actual.runtimeSessionId) {
    entry.reject(new Error(`Ignoring stale browser result from extension session ${actual.runtimeSessionId}.`));
    return true;
  }
  if (error) entry.reject(new Error(error));
  else entry.resolve(result ?? {});
  return true;
}
