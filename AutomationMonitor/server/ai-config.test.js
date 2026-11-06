import test from "node:test";
import assert from "node:assert/strict";
import { mergeProviderConfig } from "./ai/config.js";

const saved = { enabled: true, apiKey: "stored-test-secret", model: "test-model", baseUrl: "https://example.invalid/v1" };
test("partial AI settings preserve enabled provider and stored credentials", () => {
  const result = mergeProviderConfig("zai", saved, { model: "updated-model", apiKey: "[REDACTED]" });
  assert.equal(result.enabled, true);
  assert.equal(result.apiKey, saved.apiKey);
  assert.equal(result.baseUrl, saved.baseUrl);
  assert.equal(result.model, "updated-model");
  assert.equal(mergeProviderConfig("zai", saved, {}).enabled, true);
});
test("explicit provider disable and key removal remain supported", () => {
  const result = mergeProviderConfig("zai", saved, { enabled: false, apiKey: "" });
  assert.equal(result.enabled, false);
  assert.equal(result.apiKey, "");
  assert.equal(mergeProviderConfig("codex", saved, { enabled: false }).enabled, true);
});
