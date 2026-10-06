import { test } from "node:test";
import assert from "node:assert/strict";
import { createUpstreamFetcher } from "./upstream-fetch.js";
function fixture() {
  let time = 0, busy = false;
  let context = { root: "repo", remote: "upstream", branch: "ue6-main" };
  const calls = [], logs = [];
  let updates = 0;
  const fetcher = createUpstreamFetcher({ getContext: async () => context, isBusy: async () => busy,
    now: () => time, log: async (message) => logs.push(message), onUpdated: async () => updates++,
    run: async (...args) => calls.push(args) });
  return { fetcher, calls, logs, get updates() { return updates; }, advance: () => time += 300000,
    busy: (value) => busy = value, context: (value) => context = value };
}
test("fetches configured branch immediately and every five minutes", async () => {
  const f = fixture();
  await f.fetcher.check(); await f.fetcher.check();
  assert.equal(f.calls.length, 1);
  assert.ok(f.calls[0][0].includes("+refs/heads/ue6-main:refs/remotes/upstream/ue6-main"));
  assert.equal(f.calls[0][1], "repo");
  f.advance(); await f.fetcher.check();
  assert.equal(f.calls.length, 2); assert.equal(f.updates, 2);
});
test("busy and disabled repositories are skipped without consuming attempt", async () => {
  const f = fixture(); f.busy(true); await f.fetcher.check(); f.busy(false); await f.fetcher.check();
  assert.equal(f.calls.length, 1);
  f.context({ root: "other", disabled: true }); await f.fetcher.check();
  assert.equal(f.calls.length, 1);
});
test("failures release lock and are throttled", async () => {
  let calls = 0;
  const logs = [];
  const f = createUpstreamFetcher({ getContext: async () => ({root: "repo", remote: "upstream", branch: "main"}),
    isBusy: async () => false, now: () => 0, onUpdated: () => assert.fail(), log: async (line) => logs.push(line),
    run: async () => { calls++; throw new Error("offline"); } });
  await Promise.all([f.check(), f.check()]); await f.check();
  assert.equal(calls, 1); assert.equal(f.isActive(), false); assert.match(logs[0], /offline/);
});
