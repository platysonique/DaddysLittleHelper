# Packaging

`install.sh` generates `~/.local/share/daddyslittlehelper/packaging/extension.pem` on first run (machine-local signing key).

The public key is injected into the installed extension manifest so the **extension ID stays stable** across reinstalls.

Do not commit `extension.pem`.
