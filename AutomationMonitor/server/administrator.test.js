import { test } from "node:test";
import assert from "node:assert/strict";
import { requireAdministrator } from "./administrator.js";
test("administrator token permits startup", async () => {
  await requireAdministrator({ platform: "win32", run: async () => ({ stdout: "True\r\n" }) });
});
test("ordinary token blocks startup with launcher instructions", async () => {
  await assert.rejects(requireAdministrator({ platform: "win32", run: async () => ({ stdout: "False\r\n" }) }), /Start-Dev.cmd/);
});
test("permission probe failure does not allow startup", async () => {
  await assert.rejects(requireAdministrator({ platform: "win32", run: async () => { throw new Error("probe failed"); } }), /probe failed/);
});
