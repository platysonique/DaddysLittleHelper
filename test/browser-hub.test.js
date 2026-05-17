import test from "node:test";
import assert from "node:assert/strict";
import {
  completeBrowserCommand,
  getBrowserActivity,
  logBrowserActivity,
  runBrowserCommand,
  waitForJob
} from "../bridge/browser-hub.js";
import { enableAutomationForTests } from "./helpers.js";

test("browser hub queues and completes commands", async () => {
  await enableAutomationForTests();
  const waitPromise = waitForJob(2000);
  const runPromise = runBrowserCommand("snapshot", {}, { timeoutMs: 3000 });
  const job = await waitPromise;
  assert.equal(job.command, "snapshot");
  const ok = completeBrowserCommand(job.id, { refGeneration: 1, snapshot: "@1 [button] Go" });
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
