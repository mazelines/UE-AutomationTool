import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureDebuggingTools, INSTALL_ARGS } from "./debugging-tools.js";

const options = { platform: "win32", root: "tools", log: () => {} };

test("complete installation does not run installer", async () => {
  const result = await ensureDebuggingTools({ ...options, exists: async () => true, run: () => assert.fail("unexpected installer") });
  assert.equal(result.status, "ready");
});

test("partial installation adds only Debugging Tools and verifies files", async () => {
  let installed = false;
  const result = await ensureDebuggingTools({ ...options,
    exists: async (file) => installed || file.endsWith("dbghelp.dll"),
    run: async (command, args) => {
      assert.equal(command, "winget.exe");
      assert.deepEqual(args, INSTALL_ARGS);
      assert.ok(args.includes("/features OptionId.WindowsDesktopDebuggers /quiet /norestart"));
      installed = true;
      return { stdout: "Success" };
    }
  });
  assert.equal(result.status, "installed");
});

test("installer failure provides recovery without blocking server", async () => {
  const messages = [];
  const result = await ensureDebuggingTools({ ...options, log: (line) => messages.push(line),
    exists: async () => false, run: async () => { throw new Error("winget not found"); }
  });
  assert.equal(result.status, "failed");
  assert.match(messages.join("\n"), /administrator terminal/);
  assert.match(messages.join("\n"), /next server start/);
});

test("installer success is not accepted when files are missing", async () => {
  const result = await ensureDebuggingTools({ ...options, exists: async () => false, run: async () => ({}) });
  assert.equal(result.status, "failed");
});

test("non-Windows hosts skip Windows installation", async () => {
  const result = await ensureDebuggingTools({ ...options, platform: "linux", exists: () => assert.fail("unexpected check") });
  assert.equal(result.status, "unsupported");
});
