import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

export function createUpstreamFetcher({ getContext, isBusy, onUpdated, log,
  intervalMs = 5 * 60 * 1000, now = Date.now,
  run = (args, cwd) => execute("git", args, { cwd, windowsHide: true, timeout: 120000,
    maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" } })
}) {
  let active = false;
  const attempts = new Map();
  async function check() {
    if (active) return;
    active = true;
    try {
      const context = await getContext();
      if (!context || context.disabled || await isBusy()) return;
      const { root, remote, branch } = context;
      const key = JSON.stringify([root, remote, branch]);
      if (attempts.has(key) && now() - attempts.get(key) < intervalMs) return;
      attempts.set(key, now());
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(remote) || !/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(branch)) {
        await log("Periodic upstream fetch skipped: invalid remote or branch.");
        return;
      }
      try {
        await run(["-c", "http.version=HTTP/1.1", "fetch", "--no-tags", remote,
          `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], root);
        await onUpdated(context);
        await log(`Periodic upstream fetch completed: ${remote}/${branch}`);
      } catch (error) {
        await log(`Periodic upstream fetch failed: ${remote}/${branch}: ${error.stderr || error.message}`);
      }
    } finally { active = false; }
  }
  return { check, isActive: () => active };
}
