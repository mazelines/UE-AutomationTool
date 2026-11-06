import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createArtifactNotesManager, resolveArtifactRevisions } from "./artifact-notes.js";

const a = "a".repeat(40), b = "b".repeat(40), c = "c".repeat(40);
async function fixture(t) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "artifact-notes-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const artifact = { timestamp: "20261105-152945", ok: true, current: true, releaseNotesExists: false, releaseNotesPath: path.join(repoRoot, "releasseNote_20261105-152945.md") };
  return { repoRoot, artifact, artifacts: [artifact] };
}
const wait = async (manager) => {
  for (let i = 0; manager.isActive() && i < 100; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.isActive(), false);
};

test("saved build revisions win over today's HEAD", async (t) => {
  const f = await fixture(t);
  const directory = path.join(f.repoRoot, "LocalBuilds", "AutomationLogs");
  await fs.mkdir(directory, { recursive: true });
  const saved = { timestamp: f.artifact.timestamp, base: a, head: b, branch: "local-build", upstream: "origin/main" };
  await fs.writeFile(path.join(directory, `release-context_${f.artifact.timestamp}.json`), JSON.stringify(saved));
  assert.deepEqual(await resolveArtifactRevisions({ ...f, git: () => assert.fail("Must not guess HEAD") }), saved);
});
test("legacy recovery uses checkout history at build time and discloses limited comparison", async (t) => {
  const f = await fixture(t);
  const before = new Date(2026, 10, 5, 15, 0, 0).toISOString();
  const after = new Date(2026, 10, 6, 12, 0, 0).toISOString();
  const result = await resolveArtifactRevisions({ ...f, git: async (args) => {
    if (args[0] === "reflog") return `${c}\tHEAD@{${after}}\n${b}\tHEAD@{${before}}\n`;
    assert.deepEqual(args, ["rev-parse", "--verify", `${b}^`]);
    return a;
  } });
  assert.equal(result.head, b);
  assert.equal(result.base, a);
  assert.match(result.evidenceNote, /전체 빌드 간 변경 목록은 아닙니다/);
});
test("missing historical revisions fail rather than describing the current checkout", async (t) => {
  const f = await fixture(t);
  await assert.rejects(resolveArtifactRevisions({ ...f, git: async () => "" }), /빌드 시점의 Git 기록/);
});
test("generation is single-flight and writes the artifact note before becoming ready", async (t) => {
  const f = await fixture(t);
  let finish;
  const hold = new Promise((resolve) => { finish = resolve; });
  let options;
  const manager = createArtifactNotesManager({ getContext: async () => f, isBusy: async () => false,
    resolve: async () => ({ base: a, head: b, timestamp: f.artifact.timestamp }),
    generate: async (input) => { options = input; await hold; await fs.writeFile(f.artifact.releaseNotesPath, "notes"); return { generated: true }; }
  });
  assert.equal((await manager.start({ timestamp: f.artifact.timestamp })).ok, true);
  assert.equal(manager.getState(f.repoRoot).status, "running");
  assert.equal((await manager.start({ timestamp: f.artifact.timestamp })).ok, false);
  assert.equal(manager.getState("another-repo"), null);
  finish();
  // fs I/O may take longer than a microtask; wait on the output before settling state.
  for (let i = 0; manager.isActive() && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(manager.getState(f.repoRoot).status, "completed");
  assert.equal(options.head, b);
  assert.equal(await fs.readFile(f.artifact.releaseNotesPath, "utf8"), "notes");
});
test("failed generation can be retried; busy and stale artifact requests are rejected", async (t) => {
  const f = await fixture(t);
  let busy = true, calls = 0;
  const manager = createArtifactNotesManager({ getContext: async () => f, isBusy: async () => busy,
    resolve: async () => ({ base: a, head: b }), generate: async () => { if (++calls === 1) throw new Error("generation failed"); return { generated: false }; }
  });
  assert.equal((await manager.start({ timestamp: f.artifact.timestamp })).ok, false);
  busy = false;
  assert.equal((await manager.start({ timestamp: "stale" })).ok, false);
  await manager.start({ timestamp: f.artifact.timestamp });
  await wait(manager);
  assert.equal(manager.getState(f.repoRoot).status, "failed");
  await manager.start({ timestamp: f.artifact.timestamp });
  await wait(manager);
  assert.equal(manager.getState(f.repoRoot).status, "completed");
});
