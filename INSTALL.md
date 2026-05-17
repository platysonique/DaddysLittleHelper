# Install DaddysLittleHelper

Three commands. Safe to rerun.

## Requirements

- Linux (Vivaldi or Chromium-based browser)
- Node.js 20+
- `curl`, `openssl`, `systemd` (user session)

Optional: `chromium` or `google-chrome` on PATH — packs a `.crx` so Vivaldi installs the extension **without** using *Load unpacked*.

## Install

```bash
git clone https://github.com/YOUR_USER/DaddysLittleHelper.git
cd DaddysLittleHelper
./install.sh
```

Or:

```bash
npm install
```

(`npm install` runs the same `install.sh`.)

## One-time after install

```bash
agent login
agent mcp enable dlh-browser   # if install did not already
```

Restart **Vivaldi** (or start it with `vivaldi-dlh`). The extension should appear automatically.

## Security toggle

In the side panel, turn **Browser automation** **On** when you want Cursor agents to control the browser. It defaults to **Off** so nothing can click or snapshot until you allow it. Chat and project context still work when Off.

## Verify

```bash
npm run doctor
```

Expect **Extension registered for Vivaldi** and (with Vivaldi open) **Extension linked to bridge**.

## What install does

| Step | Result |
|------|--------|
| `~/.config/daddyslittlehelper/install.env` | Records your clone path |
| `~/.local/share/daddyslittlehelper/extension` | Stable extension copy |
| `~/.config/vivaldi/External Extensions/<id>.json` | Auto-load on browser start |
| `~/.cursor/mcp.json` | Registers `dlh-browser` MCP |
| `systemd --user` `daddyslittlehelper` | Bridge on `http://127.0.0.1:3847` |
| `~/.local/bin/vivaldi-dlh` | Fallback: always `--load-extension` |

## Flatpak Vivaldi

Install also writes:

`~/.var/app/com.vivaldi.Vivaldi/config/vivaldi/External Extensions/`

Restart the Flatpak app after install.

## Troubleshooting

**Extension not listed**

1. Rerun `./install.sh`
2. Install `chromium` for CRX packaging: `sudo apt install chromium` (Debian/Ubuntu)
3. Start with: `vivaldi-dlh`
4. Last resort: `vivaldi://extensions` → Developer mode → Load unpacked → `~/.local/share/daddyslittlehelper/extension`

**Bridge not running**

```bash
systemctl --user status daddyslittlehelper
systemctl --user restart daddyslittlehelper
```

**MCP not ready**

```bash
agent mcp list
agent mcp enable dlh-browser
```

## Uninstall

```bash
systemctl --user disable --now daddyslittlehelper
rm -f ~/.config/systemd/user/daddyslittlehelper.service
rm -rf ~/.local/share/daddyslittlehelper
rm -f ~/.config/daddyslittlehelper/install.env ~/.config/daddyslittlehelper/extension.json
rm -f ~/.local/bin/vivaldi-dlh
# Remove External Extensions/*.json under your Vivaldi config (see extension.json registeredDirs)
systemctl --user daemon-reload
```

Remove `dlh-browser` from `~/.cursor/mcp.json` manually if desired.
