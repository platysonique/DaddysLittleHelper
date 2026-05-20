import http from "node:http";
import { mkdir } from "node:fs/promises";
import { AcpClient } from "./acp-client.js";
import { DATA_DIR, DEFAULT_HOST, DEFAULT_MODEL, DEFAULT_PORT, THREAD_DIR } from "./config.js";
import { listModels } from "./models.js";
import { buildPrintPrompt, buildPrompt } from "./prompt.js";
import {
  eventTextFromStreamEvent,
  filterStreamEvent,
  isFullAssistantSnapshot,
  isLeakedPromptText
} from "./stream-filter.js";
import { addWorkspace, loadWorkspaces, resolveWorkspace } from "./workspaces.js";
import { createCursorChat, listCursorThreads, renameCursorThread } from "./cursor-threads.js";
import { loadCursorTranscript } from "./cursor-transcript.js";
import { pickFolder } from "./folder-picker.js";
import { appendMessage, createThread, listThreads, loadThread, saveThread } from "./threads.js";
import {
  completeBrowserCommand,
  extensionStatus,
  getBrowserActivity,
  markExtensionAlive,
  runBrowserCommand,
  waitForJob
} from "./browser-hub.js";
import { cancelChatSession, createChatSession, endChatSession } from "./chat-sessions.js";
import { loadSettings, saveSettings } from "./settings.js";
import { startPrintAgent } from "./print-runner.js";

const acpClients = new Map();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(`${payload}\n`);
}

function sendError(res, status, error) {
  sendJson(res, status, { error: error?.message || String(error) });
}

function normalizeBrowserUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) throw new Error("Missing URL.");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sse(res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "access-control-allow-origin": "*"
  });
  return (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
}

function clientKey({ workspace, model, permissionMode }) {
  return [workspace.path, model || DEFAULT_MODEL, permissionMode || "allow-once"].join("::");
}

async function getAcpClient(options) {
  const key = clientKey(options);
  let client = acpClients.get(key);
  if (!client) {
    client = new AcpClient({
      cwd: options.workspace.path,
      model: options.model || DEFAULT_MODEL,
      permissionMode: options.permissionMode || "allow-once"
    });
    acpClients.set(key, client);
  }
  if (!client.ready) await client.initialize();
  return client;
}

function eventText(event) {
  const update = event?.params?.update;
  if (update?.sessionUpdate === "agent_message_chunk" && update.content?.text) return update.content.text;
  if (event?.type === "assistant") {
    return event.message?.content?.map((block) => block.text || "").join("") || "";
  }
  if (event?.type === "stdout" || event?.type === "stderr") return event.text || "";
  return "";
}

function toolActivityFromEvent(event) {
  const name =
    event?.tool?.name ||
    event?.name ||
    event?.params?.toolName ||
    event?.params?.name;
  if (!name) return null;
  return { tool: name, args: event?.tool?.args || event?.params?.arguments || null };
}

async function handleChat(req, res) {
  const body = await readBody(req);
  const emit = sse(res);
  let printRun = null;
  let acpClient = null;
  const chatSessionId = createChatSession(() => {
    printRun?.cancel();
    acpClient?.stop();
  });
  emit("chat-started", { chatSessionId });

  const workspace = await resolveWorkspace(body.workspaceId || body.workspacePath);
  const model = body.model || DEFAULT_MODEL;
  const permissionMode = body.permissionMode || "allow-once";
  let cursorChatId = body.cursorChatId || null;
  if (!cursorChatId && body.useCursorThreads !== false) {
    try {
      cursorChatId = await createCursorChat();
      emit("cursor-thread", { cursorChatId, created: true });
    } catch (error) {
      emit("error", { message: `Could not create Cursor thread: ${error.message}` });
      res.end();
      return;
    }
  }
  const useCursorThread = Boolean(cursorChatId);
  const settings = await loadSettings();
  const browserAutomationEnabled = Boolean(settings.browserAutomationEnabled);
  // Resume mode (`agent -p --resume`) does not load MCP tools; use ACP when automation is on.
  const preferAcp = browserAutomationEnabled || !useCursorThread;

  let thread = null;
  if (!useCursorThread) {
    thread = body.threadId ? await loadThread(body.threadId) : null;
    if (!thread) {
      thread = await createThread({
        title: body.context?.page?.title || body.context?.tab?.title || body.message?.slice(0, 60) || "New thread",
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        model,
        context: body.context
      });
    }
    await appendMessage(thread, { role: "user", content: body.message || "", context: body.context || null });
    emit("thread", { thread });
  } else {
    emit("cursor-thread", { cursorChatId });
  }

  const userMessage = body.message || "";
  const acpPrompt = buildPrompt({
    userText: userMessage,
    workspace,
    model,
    context: body.context || {},
    thread,
    cursorChatId,
    browserAutomationEnabled
  });
  const printPrompt = buildPrintPrompt({
    userText: userMessage,
    workspace,
    model,
    context: body.context || {},
    browserAutomationEnabled,
    cursorChatId
  });

  let assistantText = "";
  let lastAssistantSnapshot = "";

  const onEvent = (event) => {
    const filtered = filterStreamEvent(event);
    if (!filtered) return;

    const text = eventTextFromStreamEvent(filtered) || eventText(filtered);
    if (text) {
      if (isFullAssistantSnapshot(filtered)) {
        assistantText = text;
        lastAssistantSnapshot = text;
      } else if (!isLeakedPromptText(text) && text !== lastAssistantSnapshot) {
        assistantText += text;
      }
    }

    const tool = toolActivityFromEvent(filtered);
    if (tool) emit("tool-activity", tool);
    emit("agent-event", filtered);
  };

  const runPrint = (reason) => {
    if (reason) emit("status", { phase: "print", detail: reason });
    printRun = startPrintAgent({
      cwd: workspace.path,
      model,
      prompt: printPrompt,
      cursorChatId: cursorChatId || undefined,
      onEvent
    });
    return printRun.promise;
  };

  try {
    if (!preferAcp && (useCursorThread || body.forcePrintMode)) {
      const result = await runPrint(useCursorThread ? "cursor-thread-resume" : "print-forced");
      emit("agent-result", result);
    } else {
      acpClient = await getAcpClient({ workspace, model, permissionMode });
      const result = await acpClient.prompt({ text: acpPrompt, onEvent });
      emit("agent-result", result || {});
    }
  } catch (acpError) {
    if (browserAutomationEnabled) {
      const detail = acpError?.message || String(acpError);
      emit("error", {
        message: `Browser automation requires Cursor ACP with dlh-browser MCP. ACP failed: ${detail}`
      });
      return;
    }
    emit("fallback", { reason: acpError.message });
    try {
      const result = await runPrint("acp-unavailable");
      emit("agent-result", result);
    } catch (printError) {
      const cancelled = /SIGTERM|killed/i.test(printError.message);
      const message = cancelled
        ? "Request cancelled."
        : `Cursor CLI failed. Run 'agent login' and verify model/MCP access. Details: ${printError.message}`;
      emit("error", { message, cancelled });
      if (thread) {
        await appendMessage(thread, { role: "assistant", content: message, model, error: true });
        emit("done", { threadId: thread.id, error: true, cancelled });
      } else {
        emit("done", { cursorChatId, error: true, cancelled });
      }
      endChatSession(chatSessionId);
      res.end();
      return;
    }
  }

  if (thread) {
    thread = await loadThread(thread.id);
    await appendMessage(thread, { role: "assistant", content: assistantText || "(No assistant text captured.)", model });
    emit("done", { threadId: thread.id });
  } else {
    emit("done", { cursorChatId });
  }
  endChatSession(chatSessionId);
  res.end();
}

async function route(req, res) {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "DaddysLittleHelper bridge", port: DEFAULT_PORT });
      return;
    }
    if (req.method === "GET" && url.pathname === "/models") {
      sendJson(res, 200, { models: await listModels() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/workspaces") {
      sendJson(res, 200, { workspaces: await loadWorkspaces() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/workspaces") {
      sendJson(res, 201, { workspace: await addWorkspace(await readBody(req)) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/workspaces/pick") {
      sendJson(res, 200, await pickFolder());
      return;
    }
    if (req.method === "GET" && url.pathname === "/threads") {
      sendJson(res, 200, { threads: await listThreads({ workspaceId: url.searchParams.get("workspaceId") || undefined }) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/threads") {
      const body = await readBody(req);
      const workspace = await resolveWorkspace(body.workspaceId || body.workspacePath);
      sendJson(res, 201, { thread: await createThread({ ...body, workspaceId: workspace.id, workspacePath: workspace.path }) });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/threads/")) {
      const thread = await loadThread(url.pathname.split("/").at(-1));
      if (!thread) sendError(res, 404, "Thread not found.");
      else sendJson(res, 200, { thread });
      return;
    }
    if (req.method === "GET" && url.pathname === "/cursor-threads") {
      const workspace = await resolveWorkspace(
        url.searchParams.get("workspaceId") || url.searchParams.get("workspacePath")
      );
      sendJson(res, 200, {
        workspacePath: workspace.path,
        threads: await listCursorThreads(workspace.path)
      });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/cursor-threads/") && url.pathname.endsWith("/rename")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const threadId = parts.at(-2);
      const body = await readBody(req);
      const workspace = await resolveWorkspace(body.workspaceId || body.workspacePath);
      sendJson(res, 200, {
        thread: await renameCursorThread({ workspacePath: workspace.path, threadId, title: body.title })
      });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/cursor-threads/") && url.pathname.endsWith("/transcript")) {
      const parts = url.pathname.split("/").filter(Boolean);
      const threadId = parts.at(-2);
      const workspace = await resolveWorkspace(
        url.searchParams.get("workspaceId") || url.searchParams.get("workspacePath")
      );
      sendJson(res, 200, {
        ...(await loadCursorTranscript({ workspacePath: workspace.path, threadId }))
      });
      return;
    }
    if (req.method === "POST" && url.pathname === "/chat") {
      await handleChat(req, res);
      return;
    }
    if (req.method === "POST" && url.pathname === "/chat/cancel") {
      const body = await readBody(req);
      const ok = cancelChatSession(body.chatSessionId);
      sendJson(res, ok ? 200 : 404, { ok, chatSessionId: body.chatSessionId });
      return;
    }
    if (req.method === "GET" && url.pathname === "/browser/activity") {
      const since = Number(url.searchParams.get("since") || 0);
      sendJson(res, 200, { activity: getBrowserActivity(since) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/settings") {
      sendJson(res, 200, await loadSettings());
      return;
    }
    if (req.method === "POST" && url.pathname === "/settings") {
      sendJson(res, 200, { settings: await saveSettings(await readBody(req)) });
      return;
    }
    if (req.method === "GET" && url.pathname === "/browser/status") {
      sendJson(res, 200, await extensionStatus());
      return;
    }
    if (req.method === "POST" && url.pathname === "/browser/self-test") {
      const status = await extensionStatus();
      if (!status.automationActive) {
        sendJson(res, 409, { ok: false, status, error: "Browser automation is not ready." });
        return;
      }
      const result = await runBrowserCommand("tabs", {}, { timeoutMs: 20_000 });
      sendJson(res, 200, { ok: true, status: await extensionStatus(), result });
      return;
    }
    if (req.method === "POST" && url.pathname === "/browser/navigate-test") {
      const body = await readBody(req);
      const targetUrl = normalizeBrowserUrl(body.url || "https://tigertech.net");
      const params = { ...(body.params || {}), url: targetUrl, timeoutMs: Number(body.timeoutMs || 60_000) };
      if (body.tabId !== undefined) params.tabId = body.tabId;
      const navigate = await runBrowserCommand(
        "navigate",
        params,
        { timeoutMs: Number(body.timeoutMs || 75_000) }
      );
      let snapshot = null;
      try {
        snapshot = await runBrowserCommand(
          "snapshot",
          { tabId: navigate.tabId, allFrames: false },
          { timeoutMs: 60_000 }
        );
      } catch (error) {
        snapshot = { error: error?.message || String(error) };
      }
      sendJson(res, 200, { ok: true, status: await extensionStatus(), navigate, snapshot });
      return;
    }
    if (req.method === "GET" && url.pathname === "/browser/wait") {
      const timeoutMs = Math.min(Number(url.searchParams.get("timeoutMs") || 25_000), 60_000);
      const job = await waitForJob(timeoutMs, {
        extensionId: url.searchParams.get("extensionId"),
        version: url.searchParams.get("version"),
        runtimeSessionId: url.searchParams.get("runtimeSessionId")
      });
      if (!job) {
        sendJson(res, 200, { idle: true });
        return;
      }
      sendJson(res, 200, job);
      return;
    }
    if (req.method === "POST" && url.pathname === "/browser/result") {
      const body = await readBody(req);
      const ok = completeBrowserCommand(body.id, body.result, body.error, body.identity || {});
      if (!ok) sendError(res, 404, "Unknown browser command id.");
      else sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/browser/exec") {
      const body = await readBody(req);
      try {
        const result = await runBrowserCommand(body.command, body.params || {}, {
          timeoutMs: Number(body.timeoutMs || 45_000)
        });
        sendJson(res, 200, { ok: true, result });
      } catch (error) {
        sendJson(res, 503, { error: error?.message || String(error), status: await extensionStatus() });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/browser/ping") {
      const body = await readBody(req);
      markExtensionAlive(body.identity || body);
      sendJson(res, 200, { ok: true, status: await extensionStatus() });
      return;
    }
    sendError(res, 404, "Not found.");
  } catch (error) {
    sendError(res, 500, error);
  }
}

try {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(THREAD_DIR, { recursive: true });
  await loadWorkspaces();

  const server = http.createServer(route);
  server.on("error", (error) => {
    console.error(`[dlh-bridge] listen failed on ${DEFAULT_HOST}:${DEFAULT_PORT}:`, error.message);
    process.exit(1);
  });
  server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
    console.log(`DaddysLittleHelper bridge listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
  });
} catch (error) {
  console.error("[dlh-bridge] startup failed:", error?.message || error);
  process.exit(1);
}
