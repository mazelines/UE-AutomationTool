import { spawn } from "node:child_process";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";

// An OPENAI_API_KEY inherited from the launcher shell takes precedence over the CLI's
// own ChatGPT OAuth login (codex routes/bills the env key when present), which breaks
// runs meant to reuse the session created by `codex login`. Strip it so the CLI always
// falls back to its stored login.
const SCRUBBED_ENV_VARS = ["OPENAI_API_KEY"];

function buildCleanEnv() {
  const env = { ...process.env };
  for (const key of SCRUBBED_ENV_VARS) delete env[key];
  return env;
}

function findCodexExecutable(customPath) {
  if (customPath && fssync.existsSync(customPath)) return customPath;
  if (customPath) {
    const withExe = customPath.endsWith(".exe") ? customPath : `${customPath}.exe`;
    if (fssync.existsSync(withExe)) return withExe;
  }

  // Try PATH. On Windows the CLI may be exposed as .cmd/.exe shims; check those first.
  const names = process.platform === "win32" ? ["codex.cmd", "codex.exe", "codex.bat", "codex"] : ["codex"];
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
      // OpenAI's native Windows installer places codex.exe here.
      path.join(home, "AppData", "Local", "Programs", "OpenAI", "Codex", "bin", "codex.exe"),
      path.join(home, "AppData", "Roaming", "npm", "codex.cmd")
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

export function createProvider(config) {
  const exe = findCodexExecutable(config.cliPath);
  if (!exe) return null;

  return {
    id: config.id,
    name: config.name,
    async diagnose(prompt) {
      const flags = Array.isArray(config.flags) ? config.flags : [];
      const modelArgs = typeof config.model === "string" && config.model.trim() ? ["--model", config.model.trim()] : [];
      // The prompt rides on stdin (`codex exec` reads it when no positional prompt is
      // given): a positional argv prompt blows past the 32k Windows command-line limit
      // once log tails are attached. `-o` writes the agent's final message to a file,
      // cleanly separated from the progress narration on stdout.
      const lastMessageFile = path.join(os.tmpdir(), `codex-diagnosis-${process.pid}-${Date.now()}.txt`);
      const { command, args } = getSpawnTarget(exe, [
        "exec", ...modelArgs, ...flags, "--output-last-message", lastMessageFile
      ]);

      return new Promise((resolve) => {
        const child = spawn(command, args, {
          windowsHide: true,
          env: buildCleanEnv(),
          stdio: ["pipe", "pipe", "pipe"],
          // Run from the monitor repo root so Codex doesn't pick up the target UE repo as cwd.
          cwd: process.cwd()
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (data) => { stdout += data.toString(); });
        child.stderr?.on("data", (data) => { stderr += data.toString(); });
        child.on("close", (code) => {
          let text = "";
          try { text = fssync.readFileSync(lastMessageFile, "utf8").trim(); } catch {}
          try { fssync.unlinkSync(lastMessageFile); } catch {}
          if (code !== 0) {
            resolve({ ok: false, error: `Codex CLI exited with code ${code}: ${stderr.trim() || stdout.trim().slice(-500) || "unknown error"}` });
            return;
          }
          if (!text) text = stdout.trim();
          if (!text) {
            resolve({ ok: false, error: "Codex CLI returned no output" });
            return;
          }
          resolve({ ok: true, text });
        });
        child.on("error", (error) => {
          resolve({ ok: false, error: `Failed to start Codex CLI: ${error.message}` });
        });
        child.stdin?.on("error", () => {}); // EPIPE if the CLI exits before reading stdin
        child.stdin?.end(prompt);
      });
    }
  };
}

export { findCodexExecutable, buildCleanEnv, getSpawnTarget };
