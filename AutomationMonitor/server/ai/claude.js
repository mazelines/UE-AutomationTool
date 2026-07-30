import { spawn } from "node:child_process";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";

// Auth/routing overrides inherited from the launcher shell take precedence over the
// user's claude.ai OAuth login (a stale ANTHROPIC_API_KEY makes every call fail with
// "Credit balance is too low"), and CLAUDECODE makes the CLI refuse to start inside a
// nested session. Strip both so the CLI falls back to its own login session.
const SCRUBBED_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT"
];

function buildCleanEnv() {
  const env = { ...process.env };
  for (const key of SCRUBBED_ENV_VARS) delete env[key];
  return env;
}

function findClaudeExecutable(customPath) {
  if (customPath && fssync.existsSync(customPath)) return customPath;
  if (customPath) {
    const withExe = customPath.endsWith(".exe") ? customPath : `${customPath}.exe`;
    if (fssync.existsSync(withExe)) return withExe;
  }

  // Try PATH. On Windows the CLI may be exposed as .cmd/.exe shims; check those first.
  const names = process.platform === "win32" ? ["claude.cmd", "claude.exe", "claude.bat", "claude"] : ["claude"];
  const candidates = [];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) candidates.push(path.join(dir, name));
  }
  for (const c of candidates) {
    if (fssync.existsSync(c)) return c;
  }

  // Common Windows install locations.
  if (process.platform === "win32") {
    const home = os.homedir();
    const winCandidates = [
      // Anthropic's native Windows installer places claude.exe here.
      path.join(home, ".local", "bin", "claude.exe"),
      path.join(home, ".local", "bin", "claude"),
      path.join(home, "AppData", "Roaming", "npm", "claude.cmd"),
      path.join("C:", "Program Files", "Claude", "claude.exe"),
      path.join("C:", "Program Files (x86)", "Claude", "claude.exe")
    ];
    for (const c of winCandidates) {
      if (fssync.existsSync(c)) return c;
    }
  }

  return null;
}

// `.cmd`/`.bat` shims cannot be spawned directly on Windows — route through cmd.exe.
// (Node refuses shell:false spawns of batch files on newer versions.)
function getSpawnTarget(exe, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(exe)) {
    const comspec = process.env.ComSpec || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
    return { command: comspec, args: ["/d", "/c", exe, ...args] };
  }
  return { command: exe, args };
}

function parseClaudeJson(output) {
  // `--output-format json` prints a single result envelope:
  // { type: "result", is_error, subtype, result, ... }. Note the CLI exits 0 even when
  // is_error is true (e.g. "Credit balance is too low"), so the envelope decides success.
  const trimmed = output.trim();
  if (!trimmed) return { ok: false, error: "Claude Code returned no output" };
  try {
    const envelope = JSON.parse(trimmed);
    if (envelope?.type === "result" || "is_error" in (envelope || {})) {
      if (envelope.is_error) {
        return { ok: false, error: envelope.result || envelope.subtype || "Claude Code reported an error" };
      }
      return { ok: true, text: typeof envelope.result === "string" ? envelope.result : trimmed };
    }
  } catch {}
  // Fallback: plain text output.
  return { ok: true, text: trimmed };
}

export function createProvider(config) {
  const exe = findClaudeExecutable(config.cliPath);
  if (!exe) return null;

  return {
    id: config.id,
    name: config.name,
    async diagnose(prompt) {
      const flags = Array.isArray(config.flags) ? config.flags : [];
      const modelArgs = typeof config.model === "string" && config.model.trim() ? ["--model", config.model.trim()] : [];
      // The prompt rides on stdin (`claude -p` reads it natively): a positional argv
      // prompt blows past the 32k Windows command-line limit once log tails are attached.
      const { command, args } = getSpawnTarget(exe, ["-p", ...modelArgs, ...flags]);

      return new Promise((resolve) => {
        const child = spawn(command, args, {
          windowsHide: true,
          env: buildCleanEnv(),
          stdio: ["pipe", "pipe", "pipe"],
          // Run from the monitor repo root so Claude doesn't pick up the target UE repo as cwd.
          cwd: process.cwd()
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (data) => { stdout += data.toString(); });
        child.stderr?.on("data", (data) => { stderr += data.toString(); });
        child.on("close", (code) => {
          const parsed = parseClaudeJson(stdout);
          if (code !== 0) {
            resolve({ ok: false, error: `Claude Code exited with code ${code}: ${stderr.trim() || parsed.error || "unknown error"}` });
            return;
          }
          if (!parsed.ok) {
            resolve({ ok: false, error: parsed.error });
            return;
          }
          resolve({ ok: true, text: parsed.text });
        });
        child.on("error", (error) => {
          resolve({ ok: false, error: `Failed to start Claude Code: ${error.message}` });
        });
        child.stdin?.on("error", () => {}); // EPIPE if the CLI exits before reading stdin
        child.stdin?.end(prompt);
      });
    }
  };
}

export { findClaudeExecutable };
