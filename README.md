# DaddysLittleHelper

Vivaldi side panel + local bridge + **Cursor CLI** browser automation. No Playwright extension on your daily profile.

- **Side panel** chat tied to your selected project
- **`dlh-browser` MCP** for agents (`dlh_browser_snapshot`, `click`, `navigate`, …)
- **Automatic hard-page escalation** (content script → CDP when needed)
- **Your real browser** — agents drive the Vivaldi profile you already use (cookies, SSO, extensions). No spinning up a clean agentic browser and logging into everything again.

<p align="center">
  <img src="docs/images/sidepanel-light.png" alt="DaddysLittleHelper side panel — light theme" width="360">
  &nbsp;
  <img src="docs/images/sidepanel-dark.png" alt="DaddysLittleHelper side panel — dark theme" width="360">
</p>

## How it works

DLH connects three pieces on your machine — **your Vivaldi browser**, a **local Node bridge**, and the **Cursor CLI** — so agents can see and control the tabs you already have open.

```mermaid
flowchart LR
  subgraph vivaldi [Your Vivaldi]
    SP[Side panel UI]
    SW[Extension service worker]
    CS[Content scripts on pages]
    SP --> SW
    SW --> CS
  end
  subgraph local [Localhost]
    BR[Bridge :3847]
    MCP[dlh-browser MCP]
  end
  subgraph cursor [Cursor CLI]
    AG[Agent / ACP session]
  end
  AG <-->|stdio MCP tools| MCP
  MCP -->|HTTP| BR
  SW <-->|poll + commands| BR
  AG -.->|side panel chat SSE| BR
  SP -.-> BR
```

1. **`./install.sh`** copies the MV3 extension into Vivaldi, registers it, starts the **bridge** as a user `systemd` service (`http://127.0.0.1:3847`), and wires **`dlh-browser`** into Cursor’s MCP config.
2. **Extension (background)** keeps a long-lived link to the bridge. When automation is **On**, it accepts queued commands (navigate, snapshot, click, list tabs, …) and runs them against **your** Vivaldi profile.
3. **Page automation** tries a fast path first (content scripts build an interactive `@ref` tree). Hard pages (thin trees, cross-origin frames, canvas/WebGL) **escalate to CDP** inside the same tab — still your browser, not a second automation profile.
4. **Cursor agents** call `dlh_browser_*` tools via the MCP server → bridge → extension. The side panel can also chat through the bridge, which spawns **`agent acp`** sessions against your chosen project folder.
5. **Perplexity MCP** (optional) complements this: Perplexity answers from the web; DLH operates on whatever is already loaded and signed in in Vivaldi.

Nothing leaves your machine except Cursor’s own API traffic for models/chat. Browser cookies and logins stay in Vivaldi.

## Why it pairs well with Perplexity MCP

DLH is especially useful alongside the **[Perplexity MCP](https://github.com/perplexityai/modelcontextprotocol)** in Cursor: Perplexity handles grounded search and research; `dlh-browser` acts on the pages already open in **your** Vivaldi window. You keep one logged-in environment instead of juggling a separate automation browser where every site wants a fresh sign-in.

Recommended Cursor MCP stack:

- `dlh-browser` — snapshot, click, navigate in Vivaldi
- `perplexity` (or your Perplexity MCP server) — web-grounded answers and research

Enable both in Cursor (`agent mcp enable dlh-browser` and your Perplexity server) after `agent login`.

## Requirements

- **Cursor account** — you must be logged into the [Cursor CLI](https://cursor.com) (`agent login`). Chat, models, and MCP tools all go through Cursor.
- Linux with a Chromium-based browser (developed and tested on **Pop!_OS Cosmic** with **Vivaldi Flatpak**)
- Node.js 20+, `curl`, `openssl`, `systemd` (user session)

## Known limitations (Vivaldi)

| Feature | Status |
|--------|--------|
| **Tab tiling** (stacked/split tabs in Vivaldi) | **Fully functional** for automation and targeting |
| **“Current workspace” tab list** | **Not fully functional** — Vivaldi does not expose a stable workspace API to extensions. The dropdown may list **all tabs in the current window** instead of only the active workspace. Individual tabs can still be found and targeted (by title/URL, tiling, or active tab). |

## Quick start

```bash
git clone https://github.com/platysonique/DaddysLittleHelper.git
cd DaddysLittleHelper
./install.sh
agent login
agent mcp enable dlh-browser   # if needed
```

Restart Vivaldi. In the side panel, turn **Browser automation** **On** (off by default for security). Run `npm run doctor`.

**Update later:** `cd DaddysLittleHelper && ./install.sh` (pulls from git when already installed and the tree is clean). Use `npm run setup` / `npm run update` as aliases.

Full details: [INSTALL.md](INSTALL.md)

## Daily use

- Bridge runs as user service: `http://127.0.0.1:3847`
- Open the DaddysLittleHelper side panel in Vivaldi
- In Cursor CLI / agents, use `dlh-browser` tools against the active tab
- Use Perplexity MCP when you need external facts; use DLH when you need to interact with tabs you already have open and authenticated

## Develop

```bash
npm test
npm run doctor
./install.sh    # install, update, or repair (idempotent)
```

Extension source: `extension/` (installed copy under `~/.local/share/daddyslittlehelper/extension`).

## Layout

| Path | Role |
|------|------|
| `install.sh` | Install, update, and repair (all-in-one) |
| `extension/` | MV3 extension |
| `bridge/` | Node HTTP bridge + chat |
| `mcp/dlh-browser.js` | MCP stdio server |
| `scripts/` | doctor, extension register, systemd |

## License

MIT — see [LICENSE](LICENSE).
