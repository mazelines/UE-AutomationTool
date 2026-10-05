import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createFixManager, runCodexFix } from "./fix.js";

const logName = "SyncAndBuildInstalled-20261005-130936.log";
async function fixture(t, { busy = false, diagnosed = true, execute } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ue-fix-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const state = {};
  const store = { load: async () => state, save: async () => {} };
  const manager = createFixManager({
    repoRoot: root, toolRoot: root, monitorLogRoot: root, store,
    getAiConfig: async () => ({ providers: { codex: {} }, diagnostics: diagnosed ? { [logName]: { ok: true, summary: "Fetch failed" } } : {} }),
    getRun: async (name) => name === logName ? { logName, result: "failed", reason: "Fetch failed" } : null,
    tailFile: async () => "fatal: remote branch missing", isBusy: async () => busy,
    execute: execute || (async ({ onOutput }) => {
      onOutput("checking Git remotes\n");
      return { pid: 123, completion: Promise.resolve({ status: "resolved", summary: "수정 완료", verification: ["git ls-remote succeeded"] }) };
    })
  });
  const wait = async () => {
    for (let i = 0; i < 100 && manager.getActive(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(manager.getActive(), null);
  };
  return { manager, state, wait };
}

test("fix uses diagnosis and log, records result and readable progress", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.manager.start(logName)).ok, true);
  await f.wait();
  const { history } = await f.manager.getState();
  assert.equal(history[0].status, "resolved");
  assert.match(await f.manager.readLog(history[0].id), /checking Git remotes/);
  await assert.rejects(f.manager.readLog("../../outside"), /찾을 수 없습니다/);
});

test("requires successful diagnosis and rejects unknown runs or busy builds", async (t) => {
  for (const options of [{ busy: true }, { diagnosed: false }]) {
    const f = await fixture(t, options);
    assert.equal((await f.manager.start(logName)).ok, false);
    assert.equal(f.manager.getActive(), null);
  }
  const f = await fixture(t);
  assert.equal((await f.manager.start("unknown")).ok, false);
});

test("concurrent fix requests start only one executor", async (t) => {
  let finish;
  const f = await fixture(t, { execute: async () => ({ completion: new Promise((resolve) => { finish = resolve; }) }) });
  const responses = await Promise.all([f.manager.start(logName), f.manager.start(logName)]);
  assert.equal(responses.filter((response) => response.ok).length, 1);
  finish({ status: "blocked", summary: "로그인 필요", nextSteps: ["Git credentials login"] });
  await f.wait();
  assert.equal((await f.manager.getState()).history[0].status, "blocked");
});

test("executor start failure persists failure and releases lock", async (t) => {
  const f = await fixture(t, { execute: async () => { throw new Error("missing executable"); } });
  await f.manager.start(logName);
  await f.wait();
  assert.equal(f.state.aiFixHistory[0].status, "failed");
  assert.match(f.state.aiFixHistory[0].error, /missing executable/);
});

test("Codex writes only with workspace sandbox and validates reported resolution", async () => {
  for (const report of [{ status: "resolved", summary: "done", verification: ["fetch succeeded"] }, { status: "resolved", summary: "unverified" }]) {
    let invocation;
    let prompt;
    const execution = await runCodexFix({
      config: { cliPath: process.execPath }, repoRoot: process.cwd(), toolRoot: process.cwd(), prompt: "fix using diagnosis", onOutput: () => {},
      spawnProcess(command, args, options) {
        invocation = { command, args, options };
        const child = new EventEmitter();
        child.pid = 123;
        child.stdin = new EventEmitter();
        child.stdin.end = (text) => { prompt = text; };
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        setTimeout(async () => {
          await fs.writeFile(args[args.indexOf("--output-last-message") + 1], JSON.stringify(report));
          child.emit("close", 0);
        }, 10);
        return child;
      }
    });
    assert.equal(invocation.args[invocation.args.indexOf("--sandbox") + 1], "workspace-write");
    assert.equal(invocation.args.includes("--dangerously-bypass-approvals-and-sandbox"), false);
    assert.equal(invocation.options.env.OPENAI_API_KEY, undefined);
    assert.equal(prompt, "fix using diagnosis");
    if (report.verification) assert.equal((await execution.completion).status, "resolved");
    else await assert.rejects(execution.completion, /검증 결과/);
  }
});
