import test from "node:test";
import assert from "node:assert/strict";
import { createPiManager } from "./ai/pi.js";

function fixture({ busy = false, failingRole, hold = false } = {}) {
  const calls = [];
  const sessions = [];
  let finish;
  const manager = createPiManager({
    getContext: async (logName) => ({ repoRoot: "/ue", logName: logName || "run.log", evidence: "build failed", config: { providers: { zai: { apiKey: "private-key" } } } }),
    isBusy: async () => busy,
    makeSession: async ({ role, allowChanges }) => {
      if (role === failingRole) throw new Error("credential missing private-key");
      const session = {
        messages: [], subscribe: () => () => {}, dispose() {},
        async prompt(text) { calls.push({ role, text, allowChanges }); if (hold && role === "zai") await new Promise((resolve) => { finish = resolve; }); },
        getLastAssistantText: () => `${role} evidence private-key`,
        async abort() { finish?.(); }
      };
      sessions.push(session);
      return session;
    }
  });
  return { manager, calls, sessions };
}

async function settled(manager) {
  for (let i = 0; i < 30 && manager.isActive(); i++) await new Promise((r) => setImmediate(r));
  assert.equal(manager.isActive(), false);
}

test("Pi CI/CD report reaches development lead; credentials are redacted", async () => {
  const f = fixture();
  assert.equal((await f.manager.send({ message: "inspect failure" })).ok, true);
  await settled(f.manager);
  assert.deepEqual(f.calls.map((c) => c.role), ["zai", "codex"]);
  assert.match(f.calls[1].text, /zai evidence/);
  assert.equal(f.calls[0].allowChanges, false);
  const state = f.manager.getState();
  assert.equal(state.status, "completed");
  assert.equal(JSON.stringify(state).includes("private-key"), false);
  assert.equal("secrets" in state, false);
});

test("busy pipeline and invalid requests never start agents", async () => {
  const f = fixture({ busy: true });
  assert.equal((await f.manager.send({ message: "inspect" })).ok, false);
  assert.equal(f.calls.length, 0);
  assert.equal(f.manager.isActive(), false);
  assert.equal((await f.manager.send({ message: "" })).ok, false);
});

test("both credentials are checked before any model can execute tools", async () => {
  const f = fixture({ failingRole: "codex" });
  const result = await f.manager.send({ message: "inspect" });
  assert.equal(result.ok, false);
  assert.equal(result.error.includes("private-key"), false);
  assert.equal(f.calls.length, 0);
});

test("stopping team work prevents lead handoff and reset while running", async () => {
  const f = fixture({ hold: true });
  await f.manager.send({ message: "inspect" });
  assert.equal((await f.manager.send({ message: "again" })).ok, false);
  assert.equal((await f.manager.reset()).ok, false);
  await f.manager.stop();
  await settled(f.manager);
  assert.equal(f.calls.length, 1);
  assert.equal(f.manager.getState().status, "cancelled");
  assert.equal((await f.manager.reset()).ok, true);
  assert.equal(f.manager.getState().messages.length, 0);
});

test("changing edit permission or target requires a fresh conversation", async () => {
  const f = fixture();
  await f.manager.send({ message: "inspect" });
  await settled(f.manager);
  assert.equal((await f.manager.send({ message: "edit", allowChanges: true })).ok, false);
  assert.equal((await f.manager.send({ message: "inspect", logName: "other.log" })).ok, false);
  await f.manager.reset();
  assert.equal((await f.manager.send({ message: "edit", allowChanges: true })).ok, true);
  await settled(f.manager);
  assert.equal(f.calls.at(-1).allowChanges, true);
});
