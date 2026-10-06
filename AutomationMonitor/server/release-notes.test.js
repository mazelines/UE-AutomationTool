import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeReleaseNotes } from "./release-notes.js";
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "release-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const config = path.join(root, "LocalBuilds", "AutomationMonitor");
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(path.join(config, "workspace.json"), JSON.stringify({ ai: { providers: { zai: {
    enabled: true, baseUrl: "https://example.test/v4", model: "glm-5.3-flash", apiKey: "test-only"
  } } } }));
  return { repoRoot: root, outputDirectory: root, base: "a".repeat(40), head: "b".repeat(40),
    timestamp: "20261007-120000", branch: "main", upstream: "upstream/main", log: () => {},
    git: async (args) => args[0] === "rev-list" ? "1" : args.includes("--name-only") ? "Engine/test.cpp" : "abc123 Fix example\n+changed code" };
}
test("AI sees commit bodies and net diff and saves Markdown atomically", async (t) => {
  const options = await fixture(t);
  const result = await writeReleaseNotes({ ...options, request: async (url, init) => {
    assert.equal(url, "https://example.test/v4/chat/completions");
    const body = JSON.parse(init.body);
    assert.equal(body.max_tokens, 8192);
    assert.equal(body.reasoning_effort, "low");
    assert.deepEqual(body.thinking, { type: "enabled" });
    assert.match(body.messages[1].content, /abc123 Fix example/);
    assert.match(body.messages[1].content, /Diff/);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "## 주요 변경\n\n빌드 개선 (abc123)." } }] }) };
  } });
  assert.equal(result.generated, true);
  assert.match(result.destination, /\.md$/);
  assert.match(await fs.readFile(result.destination, "utf8"), /빌드 개선/);
  assert.equal((await fs.readdir(options.outputDirectory)).some((name) => name.endsWith("partial")), false);
});
test("AI failure records explicit fallback without failing successful build", async (t) => {
  const options = await fixture(t);
  const result = await writeReleaseNotes({ ...options, request: async () => ({ ok: false, status: 429 }) });
  assert.equal(result.generated, false);
  assert.match(result.text, /AI 요약을 생성하지 못했습니다/);
  assert.ok(!result.text.includes("test-only"));
});
test("no merged changes do not call AI", async (t) => {
  const options = await fixture(t);
  const result = await writeReleaseNotes({ ...options, git: async (args) => args[0] === "rev-list" ? "0" : "", request: () => assert.fail() });
  assert.match(result.text, /새로 머지된 커밋이나 파일 변경이 없습니다/);
});
