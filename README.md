# DaddysLittleHelper

Vivaldi side panel + local bridge + **Cursor CLI** browser automation. No Playwright extension on your daily profile.

- **Side panel** chat tied to your selected project
- **`dlh-browser` MCP** for agents (`dlh_browser_snapshot`, `click`, `navigate`, …)
- **Automatic hard-page escalation** (content script → CDP when needed)

<p align="center">
  <img src="docs/images/sidepanel-light.png" alt="DaddysLittleHelper side panel — light theme" width="360">
  &nbsp;
  <img src="docs/images/sidepanel-dark.png" alt="DaddysLittleHelper side panel — dark theme" width="360">
</p>

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
