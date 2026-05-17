import crypto from "node:crypto";

/** Chrome extension ID from manifest "key" (base64 SPKI DER). */
export function extensionIdFromManifestKey(keyBase64) {
  const der = Buffer.from(String(keyBase64).replace(/\s/g, ""), "base64");
  const hash = crypto.createHash("sha256").update(der).digest("hex");
  return hash
    .slice(0, 32)
    .replace(/[a-f0-9]/g, (hex) => String.fromCharCode(97 + parseInt(hex, 16)));
}
