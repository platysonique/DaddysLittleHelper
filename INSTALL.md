# Install & update DaddysLittleHelper

One script does everything: **install**, **update**, and **repair**. Safe to rerun.

```bash
./install.sh
```

Run `npm run setup` or `npm run update` (same script). For dependencies only: `npm ci --ignore-scripts`.

When `install.sh` finishes, it prints **FINISHED — you can close this terminal window.** The bridge runs as a background user service; you do not need to keep the terminal open.

## Requirements

- Linux (Vivaldi or Chromium-based browser)
- Node.js 20+
- `curl`, `openssl`, `systemd` (user session)
- `git` (optional, for in-place updates via pull)

Optional: `chromium` or `google-chrome` on PATH — packs a `.crx` for silent extension install.

## First install

```bash
git clone https://github.com/platysonique/DaddysLittleHelper.git
cd DaddysLittleHelper
./install.sh
agent login
```

Restart Vivaldi. In the side panel, turn **Browser automation** **On** (default is off for security).

## Update (same script)

After `git pull` or copying new files into your clone:

```bash
cd DaddysLittleHelper
./install.sh
```

On **update**, the script by default:

1. Runs `git pull --ff-only` if the repo is clean (no local uncommitted changes)
2. Refreshes npm dependencies
3. Re-syncs the extension to `~/.local/share/daddyslittlehelper/extension`
4. Re-registers Vivaldi External Extensions / CRX
5. Updates MCP config and **restarts** the bridge (`systemd --user`)

Then restart Vivaldi once so the extension reloads.

### Options

| Flag | Effect |
|------|--------|
| `--pull` | Always `git pull --ff-only` (install or update) |
| `--no-pull` | Never pull; use files already on disk |
| `--no-git` | Skip all git operations |
| `--skip-doctor` | Skip health check at the end |
| `--help` | Show usage |

Examples:

```bash
./install.sh --pull          # update from remote, then apply
./install.sh --no-pull       # you already git pull'd; just sync services
```

## Verify

```bash
npm run doctor
```

## State file

`~/.config/daddyslittlehelper/install.env` records:

- `DLH_ROOT` — your clone path  
- `DLH_VERSION` — last applied package version  
- `INSTALLED_AT` / `UPDATED_AT`  

Second and later runs are detected as **update mode** automatically.

## Security toggle

Side panel → **Browser automation** → **On** when agents may control the browser. Off by default.

## Uninstall

```bash
systemctl --user disable --now daddyslittlehelper
rm -f ~/.config/systemd/user/daddyslittlehelper.service
rm -rf ~/.local/share/daddyslittlehelper
rm -rf ~/.config/daddyslittlehelper
rm -f ~/.local/bin/vivaldi-dlh
# Remove External Extensions/*.json under Vivaldi config (see extension.json)
systemctl --user daemon-reload
```

Remove `dlh-browser` from `~/.cursor/mcp.json` if desired.
