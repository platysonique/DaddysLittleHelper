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
    ? "- Browser automation is ON. Use dlh-browser MCP tools (dlh_browser_snapshot, dlh_browser_click, dlh_browser_type, dlh_browser_navigate, etc.) against the user's daily Vivaldi tabs. Escalation to CDP is automatic on hard pages."
    : "- Browser automation is OFF (user security toggle in the side panel). Do NOT call dlh-browser or any browser control tools. Answer using text and project context only.";

  const browserPlaybook = browserAutomationEnabled
    ? `- For browser actions: call dlh_browser_snapshot before interacting, re-snapshot after navigation or DOM changes, use @ refs with matching refGeneration and frameId, stop after repeated failed clicks.
- Tools: dlh_browser_find, dlh_browser_select, dlh_browser_screenshot; dlh_browser_click_at for canvas coordinates.`
    : "";

  return `You are DaddysLittleHelper, running through Cursor CLI for the user's selected local project.

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
- DaddysLittleHelper local thread ID: ${thread?.id || "none"}
- Prior messages in DaddysLittleHelper store: ${thread?.messages?.length || 0}

User request:
${userText}`;
}
