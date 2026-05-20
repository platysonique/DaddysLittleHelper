#!/usr/bin/env node
/**
 * Idempotent Vivaldi/Chromium extension registration (Linux).
 * Syncs extension to ~/.local/share/daddyslittlehelper/extension,
 * registers the unpacked extension path via External Extensions.
 */
import { spawn } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extensionIdFromManifestKey } from "./lib/extension-id.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dlhHome = process.env.DLH_HOME || join(homedir(), ".local", "share", "daddyslittlehelper");
const flatpakDlhHome = join(homedir(), ".var", "app", "com.vivaldi.Vivaldi", "data", "daddyslittlehelper");
const extSrc = join(projectRoot, "extension");
const extDest = join(dlhHome, "extension");
const flatpakExtDest = join(flatpakDlhHome, "extension");
const pemPath = join(dlhHome, "packaging", "extension.pem");
const crxPath = join(dlhHome, "daddyslittlehelper.crx");

const PACK_BROWSERS = [
  "chromium",
  "chromium-browser",
  "google-chrome-stable",
  "google-chrome",
  "vivaldi-stable",
  "vivaldi"
];

function run(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => (stdout += c));
    child.stderr?.on("data", (c) => (stderr += c));
    child.once("exit", (code) => resolve({ ok: code === 0, code, stdout, stderr }));
    child.once("error", (error) => resolve({ ok: false, code: -1, stdout, stderr: error.message }));
  });
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function syncExtensionTree() {
  const build = await run(process.execPath, [join(projectRoot, "scripts", "build-content.js")]);
  if (!build.ok) {
    throw new Error(`Could not build content script: ${build.stderr || build.stdout}`);
  }
  if (build.stdout.trim()) console.log(build.stdout.trim());
  await mkdir(extDest, { recursive: true });
  await cp(extSrc, extDest, { recursive: true, force: true });
}

async function ensurePem() {
  await mkdir(dirname(pemPath), { recursive: true });
  if (await exists(pemPath)) return;
  const gen = await run("openssl", ["genrsa", "-out", pemPath, "2048"]);
  if (!gen.ok) throw new Error(`Could not generate extension key: ${gen.stderr}`);
  console.log(`Generated extension signing key: ${pemPath}`);
}

async function publicKeyBase64FromPem() {
  const der = await new Promise((resolve, reject) => {
    const child = spawn("openssl", ["rsa", "-in", pemPath, "-pubout", "-outform", "DER"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    let stderr = "";
    child.stdout.on("data", (c) => chunks.push(c));
    child.stderr.on("data", (c) => (stderr += c));
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(stderr || `openssl exited ${code}`));
      else resolve(Buffer.concat(chunks));
    });
  });
  return der.toString("base64");
}

async function injectManifestKey() {
  const manifestPath = join(extDest, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.key = await publicKeyBase64FromPem();
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return { manifest, extensionId: extensionIdFromManifestKey(manifest.key) };
}

async function syncFlatpakExtensionTree() {
  await mkdir(dirname(flatpakExtDest), { recursive: true });
  await rm(flatpakExtDest, { recursive: true, force: true });
  await cp(extDest, flatpakExtDest, { recursive: true, force: true });
}

async function packCrx(version) {
  for (const browser of PACK_BROWSERS) {
    const which = await run("which", [browser]);
    if (!which.ok) continue;

    const staged = `${extDest}.crx`;
    await rm(staged, { force: true }).catch(() => {});

    const packed = await run(browser, [`--pack-extension=${extDest}`, `--pack-extension-key=${pemPath}`]);
    if (!packed.ok) continue;
    if (!(await exists(staged))) continue;

    await copyFile(staged, crxPath);
    await rm(staged, { force: true }).catch(() => {});
    console.log(`Packed CRX with ${browser} → ${crxPath}`);
    return { ok: true, browser, version };
  }
  return { ok: false };
}

function vivaldiConfigRoots() {
  const home = homedir();
  const roots = new Set([
    join(home, ".config", "vivaldi"),
    join(home, ".config", "vivaldi-beta"),
    join(home, ".config", "vivaldi-snapshot"),
    join(home, ".var", "app", "com.vivaldi.Vivaldi", "config", "vivaldi"),
    join(home, ".var", "app", "com.vivaldi.Vivaldi", "config", "vivaldi-beta")
  ]);

  if (process.env.XDG_CONFIG_HOME) {
    roots.add(join(process.env.XDG_CONFIG_HOME, "vivaldi"));
  }

  return [...roots];
}

function extensionPathForRoot(root) {
  return root.includes(join(".var", "app", "com.vivaldi.Vivaldi", "config")) ? flatpakExtDest : extDest;
}

async function writeExternalExtension(extensionId) {
  let wrote = 0;

  for (const root of vivaldiConfigRoots()) {
    const payload = { path: extensionPathForRoot(root) };
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    const dir = join(root, "External Extensions");
    await mkdir(dir, { recursive: true });
    const jsonPath = join(dir, `${extensionId}.json`);
    await writeFile(jsonPath, body, "utf8");
    wrote += 1;
    console.log(`Registered extension → ${jsonPath}`);
  }

  return wrote;
}

async function writeWrapperScript(extensionId) {
  const binDir = join(homedir(), ".local", "bin");
  const wrapper = join(binDir, "vivaldi-dlh");
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'EXT_DIR="${DLH_HOME:-$HOME/.local/share/daddyslittlehelper}/extension"',
    'FLATPAK_EXT_DIR="$HOME/.var/app/com.vivaldi.Vivaldi/data/daddyslittlehelper/extension"',
    'if command -v flatpak >/dev/null 2>&1 && flatpak info com.vivaldi.Vivaldi >/dev/null 2>&1; then',
    '  exec flatpak run com.vivaldi.Vivaldi --load-extension="$FLATPAK_EXT_DIR" "$@"',
    "fi",
    'if command -v vivaldi-stable >/dev/null 2>&1; then',
    '  exec vivaldi-stable --load-extension="$EXT_DIR" "$@"',
    "fi",
    'if command -v vivaldi >/dev/null 2>&1; then',
    '  exec vivaldi --load-extension="$EXT_DIR" "$@"',
    "fi",
    'echo "Vivaldi not found. Install Vivaldi or use vivaldi://extensions." >&2',
    "exit 1",
    ""
  ];
  await mkdir(binDir, { recursive: true });
  await writeFile(wrapper, lines.join("\n"), { mode: 0o755 });
  console.log(`Optional launcher: ${wrapper} (forces --load-extension if CRX registration fails)`);
  return wrapper;
}

async function writeInstallMeta({ extensionId, manifest, packed, registeredDirs }) {
  const metaDir = join(homedir(), ".config", "daddyslittlehelper");
  await mkdir(metaDir, { recursive: true });
  const meta = {
    extensionId,
    version: manifest.version || null,
    name: manifest.name || "DaddysLittleHelper",
    extensionPath: extDest,
    flatpakExtensionPath: flatpakExtDest,
    crxPath: packed ? crxPath : null,
    registeredDirs,
    packed: Boolean(packed),
    updatedAt: new Date().toISOString()
  };
  await writeFile(join(metaDir, "extension.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
}

export async function installExtension() {
  if (!(await exists(join(extSrc, "manifest.json")))) {
    throw new Error(`Missing extension source at ${extSrc}`);
  }

  await syncExtensionTree();
  await ensurePem();
  const { manifest, extensionId } = await injectManifestKey();
  await syncFlatpakExtensionTree();
  const version = manifest.version || "0.0.0";

  const shouldPackCrx = process.env.DLH_PACK_CRX === "1";
  const packed = shouldPackCrx ? await packCrx(version) : { ok: false };

  const registeredDirs = await writeExternalExtension(extensionId);
  if (registeredDirs === 0) {
    console.warn("No Vivaldi config directories found yet. Extension files are ready; open Vivaldi once and rerun ./install.sh");
  }

  await writeWrapperScript(extensionId);
  await writeInstallMeta({ extensionId, manifest, packed: false, registeredDirs });

  return { extensionId, extDest, crxPath: shouldPackCrx && packed.ok ? crxPath : null, packed: false, registeredDirs };
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  installExtension()
    .then((result) => {
      console.log(`Extension ID: ${result.extensionId}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exit(1);
    });
}
