import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureSevenZip } from "./seven-zip.js";

const options = { platform: "win32", log: () => {} };
const missing = () => Object.assign(new Error("Not found"), { code: "ENOENT" });

test("existing absolute installation skips winget", async () => {
  assert.equal(await ensureSevenZip({ ...options, resolve: () => "installed/7z.exe", run: () => assert.fail() }), "installed/7z.exe");
});
test("PATH installation skips winget", async () => {
  assert.equal(await ensureSevenZip({ ...options, resolve: () => "7z", run: async (command) => assert.equal(command, "7z") }), "7z");
});
test("missing 7-Zip installs and validates executable", async () => {
  let installed = false;
  const calls = [];
  const result = await ensureSevenZip({ ...options, resolve: () => installed ? "installed/7z.exe" : "7z",
    run: async (command, args) => {
      calls.push(command);
      if (command === "7z") throw missing();
      if (command === "winget.exe") {
        assert.ok(args.includes("7zip.7zip"));
        installed = true;
      }
    }
  });
  assert.equal(result, "installed/7z.exe");
  assert.deepEqual(calls, ["7z", "winget.exe", "installed/7z.exe"]);
});
test("installation failure provides actionable error", async () => {
  await assert.rejects(ensureSevenZip({ ...options, resolve: () => "7z", run: async () => { throw missing(); } }), /winget install --id 7zip.7zip --exact/);
});
test("broken installed executable does not trigger reinstall", async () => {
  await assert.rejects(ensureSevenZip({ ...options, resolve: () => "7z", run: async () => { throw new Error("Access denied"); } }), /Access denied/);
});
