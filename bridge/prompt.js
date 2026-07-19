export function buildPrompt({
  userText,
  workspace,
  model,
  context,
  thread,
  cursorChatId,
  browserAutomationEnabled = false
}) {
  const tab = context?.tab || {};
  const page = context?.page || {};
  const target = context?.target || "active-tab";
  const allTabs = Array.isArray(context?.allTabs)
    ? context.allTabs.map((item, index) => {
        const tabInfo = item.tab || {};
        const pageInfo = item.page || {};
        return `Tab ${index + 1}: ${tabInfo.title || pageInfo.title || "Untitled"}\nURL: ${tabInfo.url || pageInfo.url || "unknown"}\nTab ID: ${tabInfo.id ?? "unknown"}\nExcerpt: ${(pageInfo.excerpt || pageInfo.error || "none").slice(0, 4000)}`;
      }).join("\n\n")
    : "";

  const automationLine = browserAutomationEnabled
    ? "- Browser automation is ON. You MUST use rzbrowse MCP tools (rzbrowse_navigate, rzbrowse_snapshot, rzbrowse_click, etc.) for any browser action. Do not claim tools are missing if rzbrowse is configured. Legacy dlh_browser_* aliases still work. Escalation to CDP is automatic on hard pages."
    : "- Browser automation is OFF (user security toggle in the side panel). Do NOT call rzbrowse / dlh-browser or any browser control tools. Answer using text and project context only.";

  const browserPlaybook = browserAutomationEnabled
    ? `- For browser actions: call rzbrowse_snapshot before interacting, re-snapshot after navigation or DOM changes, use @ refs with matching refGeneration and frameId, stop after repeated failed clicks.
- Tools: rzbrowse_find, rzbrowse_select, rzbrowse_screenshot; rzbrowse_click_at for canvas coordinates.
- Tab leases (always on): claim with rzbrowse_lease_claim before multi-job work (named missionId). Single-job may auto-claim default mission. Motors need leaseToken (MCP auto-attaches last claim). Use lease_steal/transfer/wait/release — agents only, no human gate. Claim/click OK is not "done".`
    : "";

  return `You are RZBrowse, running through Cursor CLI for the user's selected local project.

Hard constraints:
- Use Cursor CLI tools and configured MCP servers only.
${automationLine}
- Work only in the selected project unless the user explicitly instructs otherwise.
${browserPlaybook}

Selected project:
- Name: ${workspace.name}
- Path: ${workspace.path}
- Model requested: ${model || "auto"}

Browser target:
- Target mode: ${target}
- Vivaldi workspace ID: ${context?.workspaceId ?? "unknown"}
- Tab ID: ${tab.id ?? "unknown"}
- Window ID: ${tab.windowId ?? "unknown"}
- URL: ${page.url || tab.url || "unknown"}
- Title: ${page.title || tab.title || "unknown"}

Page context:
${page.selection ? `Selected text:\n${page.selection}\n` : "Selected text: none\n"}
${page.excerpt ? `Excerpt:\n${page.excerpt}\n` : "Excerpt: none\n"}
${allTabs ? `All open tab contexts:\n${allTabs}\n` : ""}

Thread:
- Cursor thread resume ID: ${cursorChatId || "new"}
- RZBrowse local thread ID: ${thread?.id || "none"}
- Prior messages in RZBrowse store: ${thread?.messages?.length || 0}

User request:
${userText}`;
}

/**
 * Prompt for `agent -p` (print mode). Never pass the full ACP wall on --resume —
 * Cursor already has thread context and echoing it floods the side panel.
 */
export function buildPrintPrompt({
  userText,
  workspace,
  model,
  context,
  browserAutomationEnabled = false,
  cursorChatId = null
}) {
  const page = context?.page || {};
  const tab = context?.tab || {};
  const hints = [];

  if (page.url || tab.url) {
    hints.push(`Active tab: ${page.title || tab.title || "Untitled"} — ${page.url || tab.url}`);
  }
  if (page.selection) {
    hints.push(`Selected text: ${page.selection.slice(0, 1200)}`);
  } else if (page.excerpt) {
    hints.push(`Page excerpt: ${page.excerpt.slice(0, 1200)}`);
  }

  if (cursorChatId) {
    if (!hints.length) return userText;
    return `${hints.join("\n")}\n\n${userText}`;
  }

  const automation = browserAutomationEnabled
    ? "Browser automation is ON (rzbrowse MCP)."
    : "Browser automation is OFF — do not use rzbrowse tools.";

  return `[RZBrowse · ${workspace.path} · ${automation}]
${hints.join("\n")}

${userText}`;
}
