import { strict as assert } from "node:assert";
import test from "node:test";
import { extensionIdFromManifestKey } from "../scripts/lib/extension-id.js";

test("extensionIdFromManifestKey is 32 chars a-p", () => {
  const sampleKey =
    "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAuI8t3Vz8x5QZ8n0mK9fH2pL3wR4sT6uV1yX0cA7bD5eF9gH1iJ2kL3mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uVwIDAQAB";
  const id = extensionIdFromManifestKey(sampleKey);
  assert.equal(id.length, 32);
  assert.match(id, /^[a-p]{32}$/);
});
