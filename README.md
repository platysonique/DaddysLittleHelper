# DaddysLittleHelper

Vivaldi side panel + local bridge + **Cursor CLI** browser automation. No Playwright extension on your daily profile.

- **Side panel** chat tied to your selected project
- **`dlh-browser` MCP** for agents (`dlh_browser_snapshot`, `click`, `navigate`, …)
- **Automatic hard-page escalation** (content script → CDP when needed)

## Quick start

```bash
git clone https://github.com/YOUR_USER/DaddysLittleHelper.git
cd DaddysLittleHelper
./install.sh
agent login
agent mcp enable dlh-browser   # if needed
```

Restart Vivaldi. In the side panel, turn **Browser automation** **On** (off by default for security). Run `npm run doctor`.

Full details: [INSTALL.md](INSTALL.md)

## Daily use

- Bridge runs as user service: `http://127.0.0.1:3847`
- Open the DaddysLittleHelper side panel in Vivaldi
- In Cursor CLI / agents, use `dlh-browser` tools against the active tab

## Develop

```bash
npm test
npm run doctor
./install.sh    # idempotent after changes
```

Extension source: `extension/` (installed copy under `~/.local/share/daddyslittlehelper/extension`).

## Layout

| Path | Role |
|------|------|
| `install.sh` | Idempotent installer |
| `extension/` | MV3 extension |
| `bridge/` | Node HTTP bridge + chat |
| `mcp/dlh-browser.js` | MCP stdio server |
| `scripts/` | doctor, extension register, systemd |

## License

See repository license file when published.
