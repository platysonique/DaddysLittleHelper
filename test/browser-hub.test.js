import test from "node:test";
import assert from "node:assert/strict";
import {
  completeBrowserCommand,
  getBrowserActivity,
  logBrowserActivity,
  markExtensionAlive,
  runBrowserCommand,
  setExpectedExtensionForTests,
  waitForJob
} from "../bridge/browser-hub.js";
import { enableAutomationForTests } from "./helpers.js";

test("browser hub queues and completes commands", async () => {
  await enableAutomationForTests();
  const identity = {
    extensionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    version: "0.0.0",
    runtimeSessionId: "test-session"
  };
  setExpectedExtensionForTests(identity);
  markExtensionAlive(identity);
  const waitPromise = waitForJob(2000, identity);
  const runPromise = runBrowserCommand("snapshot", {}, { timeoutMs: 3000 });
  const job = await waitPromise;
  assert.equal(job.command, "snapshot");
  const ok = completeBrowserCommand(job.id, { refGeneration: 1, snapshot: "@1 [button] Go" }, null, identity);
  assert.equal(ok, true);
  const result = await runPromise;
  assert.equal(result.refGeneration, 1);
});

test("activity log records browser commands", async () => {
  const since = Date.now();
  logBrowserActivity({ phase: "test", command: "click" });
  const items = getBrowserActivity(since - 1);
  assert.ok(items.some((i) => i.command === "click"));
});
