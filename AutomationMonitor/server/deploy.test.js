import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import { createDeployManager, resolveSevenZip } from "./deploy.js";

test("detects 7-Zip installed after the server started", () => {
  let installed = false;
  const exists = () => installed;
  assert.equal(resolveSevenZip(exists), "7z");
  installed = true;
  assert.match(resolveSevenZip(exists), /7-Zip[\\/]7z.exe$/);
});

async function fixture(t, { notes = true, compressionFails = false, missingDrive = false, installFails = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ue-deploy-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const logs = path.join(root, "logs");
  const output = path.join(root, "engine");
  await fs.mkdir(logs);
  await fs.mkdir(output);
  const drive = path.join(root, "내 드라이브", "PublicShare", "UnrealEngine6");
  if (!missingDrive) await fs.mkdir(drive, { recursive: true });
  const timestamp = "20261005-123456";
  await fs.writeFile(path.join(logs, `build_summary_${timestamp}.txt`), `  Status: SUCCESS\n  Timestamp: ${timestamp}\n  Version: 6\n`);
  if (notes) await fs.writeFile(path.join(logs, `releasseNote_${timestamp}.txt`), "Merged commits:\n한글 수정 사항");
  const state = { deployHistory: [] };
  const calls = [];
  const manager = createDeployManager({
    repoRoot: root, monitorLogRoot: logs,
    store: { load: async () => state, save: async () => {} },
    getTargets: async () => [{ id: "gdrive", real: true, path: drive }],
    getAutoDeploy: async () => ({ enabled: true, targetId: "gdrive" }),
    getFormat: async () => "zip",
    getInstallConfig: async () => ({ Paths: { LogDirectory: logs, OutputDirectory: output } }),
    appendMonitorLog: async () => {}, machineUser: "test", getOutputBytes: () => 0,
    ensureCompressor: async () => { if (installFails) throw new Error("7-Zip installation failed"); return "7z"; },
    spawnProcess(command, args) {
      calls.push({ command, args });
      const child = new EventEmitter();
      child.pid = calls.length;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      setTimeout(async () => {
        if (!compressionFails) await fs.writeFile(args[6], "archive");
        child.emit("close", compressionFails ? 1 : 0);
      }, 10);
      return child;
    }
  });
  const wait = async () => {
    for (let attempt = 0; attempt < 200 && manager.getActive(); attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(manager.getActive(), null);
  };
  return { manager, state, calls, wait, logs, drive };
}

test("saves archive and UTF-8 notes in desktop sync folder, cleans staging, deploys once", async (t) => {
  const f = await fixture(t);
  await f.manager.checkAutoDeploy();
  await f.wait();
  assert.equal(f.state.deployHistory[0].ok, true);
  assert.deepEqual((await fs.readdir(f.drive)).sort(), ["Engine-20261005-123456.zip", "releasseNote_20261005-123456.txt"]);
  assert.equal(await fs.readFile(path.join(f.drive, "releasseNote_20261005-123456.txt"), "utf8"), "Merged commits:\n한글 수정 사항");
  assert.equal(f.state.deployHistory[0].delivery, "desktop-sync");
  assert.equal((await fs.readdir(f.logs)).some((name) => name.startsWith("gdrive-")), false);
  await f.manager.checkAutoDeploy();
  assert.equal(f.calls.length, 1);
});

test("compression failure is recorded and saves no files to Drive", async (t) => {
  const f = await fixture(t, { compressionFails: true });
  assert.equal((await f.manager.startDeploy({ targetId: "gdrive" })).ok, true);
  await f.wait();
  assert.equal(f.state.deployHistory[0].ok, false);
  assert.deepEqual(await fs.readdir(f.drive), []);
  assert.equal(f.calls.length, 1);
});

test("installer failure releases deployment lock and does not create staging", async (t) => {
  const f = await fixture(t, { installFails: true });
  const result = await f.manager.startDeploy({ targetId: "gdrive" });
  assert.equal(result.ok, false);
  assert.match(result.error, /installation failed/);
  assert.equal(f.manager.getActive(), null);
  assert.equal(f.calls.length, 0);
  assert.equal((await fs.readdir(f.logs)).some((name) => name.startsWith("gdrive-")), false);
});

test("unmounted or missing Drive folder fails before compression", async (t) => {
  const f = await fixture(t, { missingDrive: true });
  assert.equal((await f.manager.startDeploy({ targetId: "gdrive" })).ok, false);
  assert.equal(f.manager.getActive(), null);
  assert.equal(f.calls.length, 0);
});

test("waits for notes without consuming the auto-deploy attempt", async (t) => {
  const f = await fixture(t, { notes: false });
  await f.manager.checkAutoDeploy();
  assert.equal(f.state.lastAutoDeploy, undefined);
  assert.equal((await f.manager.startDeploy({ targetId: "gdrive" })).ok, false);
  assert.equal(f.manager.getActive(), null);
  assert.equal(f.calls.length, 0);
});
