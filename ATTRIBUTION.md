# Attribution and lineage

DaddysLittleHelper is an **original implementation** for Vivaldi + Cursor CLI. It is **not** a fork of BrowserOS and does not ship BrowserOS source code.

## What we studied (not copied)

During planning, we reviewed open-source projects for **architecture patterns only**:

| Project | License | What we took |
|---------|---------|----------------|
| [BrowserOS](https://github.com/browseros-ai/BrowserOS) / BrowserOS-agent | AGPL-3.0 | Ideas only: side panel + localhost bridge + MCP-shaped browser tools. No BrowserOS server, Klavis, CDP :9000 stack, or `chrome.browserOS` APIs. |
| `vivaldi-workspace-mcp` (local reference) | Unknown | Early inspiration for Vivaldi `vivExtData.workspaceId` tab metadata. **Removed** in favor of session storage + messaging. |

See `../DaddysLittleHelper-Research/BROWSEROS_OSS_REUSE_REPORT.md` for the research audit.

## What is ours

| Component | Notes |
|-----------|--------|
| `bridge/` | Cursor CLI ACP/print runner, thread store, browser command hub (HTTP long-poll, not BrowserOS WebSocket controller). |
| `mcp/dlh-browser.js` | DLH-specific MCP tool surface (`dlh_browser_*`). |
| `extension/page/` | **DLH-native** modules: `context.js` (structured page extract), `snapshot.js` (scored `dlh-tree-v1`, `@` refs), `actions.js` (pointer-first interaction). |
| `extension/sidepanel.*` | Custom UI; not BrowserOS React/WXT agent app. |

## Deliberately removed (borrowed-era hacks)

- Invisible scroll-helper buttons injected for **Playwright MCP** — deleted; scrolling uses `dlh_browser_scroll` only.
- Hidden DOM workspace meta tag for external automation — replaced with `chrome.storage.session` tab workspace map.

## Distribution note

If you **publish** this repository publicly, keep this file accurate. AGPL-3.0 applies to BrowserOS itself if you copy its source; our clean-room implementation here is intended to avoid that dependency. When in doubt, consult counsel before redistributing combined works.
