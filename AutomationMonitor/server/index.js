import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPipelineStatus } from "./pipeline.js";
import { computeAlerts } from "./alerts.js";
import { createStore } from "./store.js";
import { createDeployManager } from "./deploy.js";
import { createWorkspace, DEFAULT_RUN_OPTIONS } from "./workspace.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "..");
const automationRoot = path.join(repoRoot, "Automation");
const logRoot = path.join(repoRoot, "LocalBuilds", "AutomationLogs");
const monitorLogRoot = path.join(repoRoot, "LocalBuilds", "AutomationMonitor");
const distRoot = path.join(appRoot, "dist");
const installConfigPath = path.join(repoRoot, "install_build_config.ini");
const taskName = "UE6 Nightly Upstream Sync And Installed Build";
const port = Number(process.env.UE6_MONITOR_PORT || 4174);
const host = process.env.UE6_MONITOR_HOST || "0.0.0.0";
const isDev = process.argv.includes("--dev");

let activeRun = null;

const pkg = JSON.parse(fssync.readFileSync(path.join(appRoot, "package.json"), "utf8"));
const machineInfo = {
  host: os.hostname(),
  user: `${os.hostname()}\\${os.userInfo().username}`,
  os: Number(os.release().split(".")[2]) >= 22000 ? "Win 11" : `Windows ${os.release()}`,
  monitorVersion: pkg.version
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

async function appendMonitorLog(message) {
  await fs.mkdir(monitorLogRoot, { recursive: true });
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await fs.appendFile(path.join(monitorLogRoot, "monitor.log"), line, "utf8");
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function runPowerShell(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], {
      cwd: repoRoot,
      windowsHide: true,
      ...options
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.stderr?.on("data", (data) => { stderr += data.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: String(error) }));
  });
}

function boolArg(enabled, name) {
  return enabled ? [name] : [];
}

// git.exe direct spawn — a powershell.exe wrapper per git call costs seconds when UBA saturates the CPU.
function runGit(args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: repoRoot, windowsHide: true });
    let stdout = "";
    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.on("close", () => resolve(stdout));
    child.on("error", () => resolve(""));
  });
}

// Like runGit but surfaces exit code + stderr — used by write operations (remote add, fetch) that must report failure.
function runGitChecked(args) {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: repoRoot, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.stderr?.on("data", (data) => { stderr += data.toString(); });
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.on("error", (error) => resolve({ code: -1, stdout, stderr: String(error) }));
  });
}

// "Add & Fetch Upstream" — register/update the upstream remote and fetch its branch on demand,
// so the branch picker and ahead count populate without waiting for a full build run.
async function registerUpstream(input = {}) {
  const cfg = (await workspace.load()).build || {};
  const remote = (input.remote || cfg.Run?.UpstreamRemote || "upstream").trim();
  const url = (input.url || cfg.Run?.UpstreamUrl || "https://github.com/EpicGames/UnrealEngine.git").trim();
  const branch = (input.branch || cfg.Run?.UpstreamBranch || "ue6-main").trim();
  if (!remote || !url) return { ok: false, error: "Upstream remote 이름과 URL이 필요합니다." };

  const remotes = (await runGitChecked(["remote"])).stdout.split(/\r?\n/).map((s) => s.trim());
  const exists = remotes.includes(remote);
  const setRemote = exists
    ? await runGitChecked(["remote", "set-url", remote, url])
    : await runGitChecked(["remote", "add", remote, url]);
  if (setRemote.code !== 0) {
    return { ok: false, error: `git remote ${exists ? "set-url" : "add"} 실패: ${setRemote.stderr.trim()}` };
  }

  // Fetch only the configured branch — a full remote fetch on Epic's repo would pull tens of GB.
  // -c http.version=HTTP/1.1: git's HTTP/2 multiplexing corrupts large packfiles on Windows
  // ("inflate: data stream error"); force HTTP/1.1 so the fetch survives regardless of repo config.
  const fetched = await runGitChecked(["-c", "http.version=HTTP/1.1", "fetch", "--prune", remote, branch]);
  if (fetched.code !== 0) {
    return { ok: false, error: `git fetch ${remote} ${branch} 실패: ${fetched.stderr.trim()}` };
  }

  // Enumerate the remote's heads (refs only, no object download) to fill the branch picker.
  const ls = await runGitChecked(["ls-remote", "--heads", remote]);
  const branches = ls.code === 0
    ? ls.stdout.split(/\r?\n/).map((line) => line.split("\t")[1]).filter(Boolean)
        .map((ref) => ref.replace(/^refs\/heads\//, "")).sort()
    : [];

  ttlCache.delete("gitSummary");
  ttlCache.delete("branches");
  await appendMonitorLog(`Upstream registered: ${remote} -> ${url} (fetched ${branch})`);
  return { ok: true, remote, url, branch, branches, message: `Upstream '${remote}' 등록 및 ${branch} fetch 완료 (${branches.length} branches)` };
}

// Build settings now live in workspace.json (migrated from install_build_config.ini).
async function getInstallConfig() {
  return (await workspace.load()).build || {};
}

async function updateInstallConfig(patch) {
  const ws = await workspace.load();
  ws.build = ws.build || {};
  for (const [section, keys] of Object.entries(patch || {})) {
    ws.build[section] = { ...ws.build[section], ...keys };
  }
  await workspace.save();
  return ws.build;
}

function buildAutomationArgs(input = {}) {
  // ponytail: no hardcoded fallbacks — omit the args so the ps1 resolves Run.Branch / Paths.OutputDirectory from install_build_config.ini.
  const args = ["-File", path.join(automationRoot, "SyncAndBuildInstalled.ps1")];
  if (input.branch) args.push("-Branch", input.branch);
  if (input.builtDirectory) args.push("-BuiltDirectory", input.builtDirectory);
  args.push(...boolArg(input.skipSetup, "-SkipSetup"));
  args.push(...boolArg(input.skipGenerateProjectFiles, "-SkipGenerateProjectFiles"));
  args.push(...boolArg(input.noClean, "-NoClean"));
  args.push(...boolArg(input.skipUpstreamSync, "-SkipUpstreamSync"));
  args.push(...boolArg(input.skipPushOrigin, "-SkipPushOrigin"));
  args.push(...boolArg(input.allowMergeCommit, "-AllowMergeCommit"));
  if (input.noDdc) args.push("-NoDDC");
  return args;
}

function getBranches() {
  return cached("branches", 30000, getBranchesUncached);
}

async function getBranchesUncached() {
  const [refsOut, remotesOut] = await Promise.all([
    runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"]),
    runGit(["remote"])
  ]);
  const remoteNames = new Set(remotesOut.split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
  const seen = new Map();

  for (const line of refsOut.split(/\r?\n/)) {
    const raw = line.trim().replace(/^'|'$/g, "");
    if (!raw || raw.endsWith("/HEAD") || remoteNames.has(raw)) continue;

    const slashIndex = raw.indexOf("/");
    const possibleRemote = slashIndex >= 0 ? raw.slice(0, slashIndex) : "";
    const isRemote = remoteNames.has(possibleRemote);
    const remote = isRemote ? possibleRemote : "local";
    const name = isRemote ? raw.slice(slashIndex + 1) : raw;
    if (!name) continue;

    const existing = seen.get(name) || { name, remotes: [], hasLocal: false };
    if (isRemote) existing.remotes.push(remote);
    else existing.hasLocal = true;
    seen.set(name, existing);
  }

  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// Small TTL cache to keep the 5s status poll from respawning PowerShell for slow-changing data.
const ttlCache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = ttlCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  const value = await fn();
  ttlCache.set(key, { at: Date.now(), value });
  return value;
}

function getGitSummary() {
  return cached("gitSummary", 10000, async () => {
    // Upstream remote/branch are configurable (workspace.json build.Run.*); fall back to the fork's origin.
    const cfg = (await workspace.load()).build || {};
    const upstreamRemote = cfg.Run?.UpstreamRemote || "upstream";
    const upstreamBranch = cfg.Run?.UpstreamBranch || "ue6-main";
    const upstreamSyncDisabled = String(cfg.Run?.SkipUpstreamSync || "").toLowerCase() === "true";
    const upstreamRef = `${upstreamRemote}/${upstreamBranch}`;
    const [branch, head, remotes, ahead] = await Promise.all([
      runGit(["branch", "--show-current"]),
      runGit(["log", "-1", "--pretty=format:%h %cs %s"]),
      runGit(["remote", "-v"]),
      // rev-list returns "" when the upstream ref is absent (skip-sync branches, unfetched upstream) → null below.
      upstreamSyncDisabled ? Promise.resolve("") : runGit(["rev-list", "--count", `HEAD..${upstreamRef}`])
    ]);
    const aheadCount = Number(ahead.trim());
    return {
      branch: branch.trim(),
      head: head.trim(),
      remotes: remotes.trim().split(/\r?\n/).filter(Boolean),
      upstreamRef,
      upstreamSyncDisabled,
      upstreamAhead: Number.isFinite(aheadCount) && ahead.trim() !== "" ? aheadCount : null
    };
  });
}

function getDisk() {
  return cached("disk", 60000, async () => {
    const drive = repoRoot.slice(0, 2);
    const result = await runPowerShell(["-Command",
      `Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}'" | Select-Object FreeSpace,Size | ConvertTo-Json -Compress`]);
    try {
      const parsed = JSON.parse(result.stdout);
      return { drive, freeBytes: Number(parsed.FreeSpace), totalBytes: Number(parsed.Size) };
    } catch {
      return { drive, freeBytes: null, totalBytes: null };
    }
  });
}

// Output directory size is expensive to walk (200+ GB), so refresh it in the background.
let outputSize = { bytes: null, updatedAt: null };
async function refreshOutputSize() {
  try {
    const config = await getInstallConfig();
    const rel = config?.Paths?.OutputDirectory || "LocalBuilds\\Engine";
    const dir = path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
    const escaped = dir.replaceAll("'", "''");
    const result = await runPowerShell(["-Command",
      `if (Test-Path -LiteralPath '${escaped}') { (Get-ChildItem -LiteralPath '${escaped}' -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum } else { 0 }`]);
    const bytes = Number(result.stdout.trim());
    if (Number.isFinite(bytes)) outputSize = { bytes, updatedAt: new Date().toISOString() };
  } catch {}
}
setTimeout(refreshOutputSize, 15 * 1000);
setInterval(refreshOutputSize, 30 * 60 * 1000);

// monitor-state.json now holds machine state only (acks, deploy history);
// all settings moved to AutomationMonitor/workspace.json.
const stateStore = createStore(path.join(monitorLogRoot, "monitor-state.json"), {
  acked: {},
  deployHistory: []
});

const workspace = createWorkspace({
  filePath: path.join(appRoot, "workspace.json"),
  iniPath: installConfigPath,
  statePath: path.join(monitorLogRoot, "monitor-state.json"),
  hostname: machineInfo.host
});

const deployManager = createDeployManager({
  repoRoot,
  monitorLogRoot,
  store: stateStore,
  getTargets: async () => (await workspace.load()).deploy?.targets || [],
  getInstallConfig,
  appendMonitorLog,
  machineUser: machineInfo.user,
  getOutputBytes: () => outputSize.bytes
});

function getTaskSummary() {
  return cached("taskSummary", 5000, getTaskSummaryUncached);
}

async function getTaskSummaryUncached() {
  const script = `$name = '${taskName.replaceAll("'", "''")}'; ` +
    `$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue; ` +
    `if ($null -eq $task) { @{ exists = $false } | ConvertTo-Json -Compress; exit 0 }; ` +
    `$info = Get-ScheduledTaskInfo -TaskName $name; ` +
    `@{ exists = $true; state = $task.State.ToString(); lastRunTime = $info.LastRunTime; nextRunTime = $info.NextRunTime; lastTaskResult = $info.LastTaskResult } | ConvertTo-Json -Compress`;
  const result = await runPowerShell(["-Command", script]);
  try {
    return JSON.parse(result.stdout || "{}");
  } catch {
    return { exists: false, error: result.stderr || result.stdout };
  }
}

async function listLogs() {
  try {
    const entries = await fs.readdir(logRoot, { withFileTypes: true });
    const logs = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".log"))
      .map(async (entry) => {
        const fullPath = path.join(logRoot, entry.name);
        const stat = await fs.stat(fullPath);
        return { name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() };
      }));
    try {
      const stat = await fs.stat(path.join(monitorLogRoot, "monitor.log"));
      logs.push({ name: "monitor.log", size: stat.size, modifiedAt: stat.mtime.toISOString() });
    } catch {}
    return logs.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  } catch {
    return [];
  }
}

// monitor.log lives under monitorLogRoot; every other served log is in logRoot.
function logFileRoot(name) {
  return name === "monitor.log" ? monitorLogRoot : logRoot;
}

// ponytail: read backward from the end in 64KB chunks — build logs grow to hundreds of MB and the UI polls every 5s, so a full readFile per poll is not acceptable.
async function tailFile(fileName, lineCount = 250) {
  if (!fileName) return "";
  const safeName = path.basename(fileName);
  const fullPath = path.join(logFileRoot(safeName), safeName);
  const handle = await fs.open(fullPath, "r");
  try {
    const { size } = await handle.stat();
    const chunkSize = 64 * 1024;
    const chunks = [];
    let pos = size;
    let newlines = 0;
    while (pos > 0 && newlines <= lineCount) {
      const readSize = Math.min(chunkSize, pos);
      pos -= readSize;
      const buffer = Buffer.alloc(readSize);
      await handle.read(buffer, 0, readSize, pos);
      chunks.unshift(buffer);
      for (const byte of buffer) if (byte === 10) newlines += 1;
    }
    const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
    if (pos > 0) lines.shift();
    return lines.slice(-lineCount).join("\n");
  } finally {
    await handle.close();
  }
}

async function getMonitorLog() {
  try {
    const text = await fs.readFile(path.join(monitorLogRoot, "monitor.log"), "utf8");
    return text.split(/\r?\n/).slice(-120).join("\n");
  } catch {
    return "";
  }
}

// Server-side directory browser for the deploy-path picker. Lists fixed drives
// when no path is given, otherwise the immediate subdirectories of `input`.
async function browseDirs(input) {
  if (!input) {
    const result = await runPowerShell(["-Command",
      "Get-PSDrive -PSProvider FileSystem | Select-Object -ExpandProperty Root | ConvertTo-Json -Compress"]);
    try {
      const roots = JSON.parse(result.stdout || "[]");
      const list = (Array.isArray(roots) ? roots : [roots]).filter(Boolean);
      return { current: "", parent: null, entries: list.map((root) => ({ name: root, path: root })) };
    } catch {
      return { current: "", parent: null, entries: [] };
    }
  }
  // Normalize a bare drive letter ("D:") to its root ("D:\") before resolve.
  const dir = path.resolve(/^[A-Za-z]:$/.test(input) ? `${input}\\` : input);
  try {
    const entries = (await fs.readdir(dir, { withFileTypes: true }))
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => ({ name: dirent.name, path: path.join(dir, dirent.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parent = path.dirname(dir);
    return { current: dir, parent: parent && parent !== dir ? parent : null, entries };
  } catch (error) {
    return { current: dir, parent: null, entries: [], error: error.message };
  }
}

async function getStatus() {
  const [git, branches, task, logs, disk] = await Promise.all([getGitSummary(), getBranches(), getTaskSummary(), listLogs(), getDisk()]);
  const latestLog = logs[0];
  let latestLogTail = "";
  if (latestLog) {
    try { latestLogTail = await tailFile(latestLog.name, 80); } catch {}
  }
  let pipelineStatus = { pipeline: null, runs: [] };
  try {
    pipelineStatus = await buildPipelineStatus({
      logRoot,
      logs,
      tailFile,
      isMonitorRunActive: Boolean(activeRun),
      isTaskRunning: task?.state === "Running"
    });
  } catch {}
  let alerts = { list: [], openCount: 0 };
  let runOptions = { ...DEFAULT_RUN_OPTIONS };
  try {
    const [state, ws] = await Promise.all([stateStore.load(), workspace.load()]);
    runOptions = { ...DEFAULT_RUN_OPTIONS, ...ws.runOptions };
    const list = computeAlerts({
      runs: pipelineStatus.runs,
      disk,
      upstreamAhead: git?.upstreamAhead,
      upstreamRef: git?.upstreamRef,
      pipeline: pipelineStatus.pipeline,
      acked: state.acked,
      thresholds: ws.alerts?.thresholds
    });
    alerts = { list, openCount: list.filter((a) => !a.acked).length, thresholds: ws.alerts?.thresholds };
  } catch {}
  return {
    alerts,
    runOptions,
    repoRoot,
    automationRoot,
    logRoot,
    machine: machineInfo,
    pipeline: pipelineStatus.pipeline,
    runs: pipelineStatus.runs,
    disk: { ...disk, outputBytes: outputSize.bytes, outputUpdatedAt: outputSize.updatedAt },
    activeRun: activeRun ? { pid: activeRun.pid, startedAt: activeRun.startedAt, mode: activeRun.mode } : null,
    git,
    branches,
    task,
    logs,
    latestLogTail,
    monitorLogTail: await getMonitorLog()
  };
}

async function startRun(input) {
  if (activeRun) {
    return { ok: false, error: `Automation is already running as PID ${activeRun.pid}.` };
  }

  const args = buildAutomationArgs(input);
  await fs.mkdir(monitorLogRoot, { recursive: true });
  const runLogPath = path.join(monitorLogRoot, `run-now-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  await appendMonitorLog(`Run Now requested with args: ${args.join(" ")}`);
  await fs.appendFile(runLogPath, `Run Now requested at ${new Date().toISOString()}\nArguments: ${args.join(" ")}\n\n`, "utf8");

  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", ...args], {
    cwd: repoRoot,
    windowsHide: false,
    detached: false
  });

  activeRun = {
    child,
    pid: child.pid,
    mode: "now",
    startedAt: new Date().toISOString(),
    runLogPath
  };

  child.stdout?.on("data", async (data) => {
    await fs.appendFile(runLogPath, data.toString(), "utf8").catch(() => {});
  });
  child.stderr?.on("data", async (data) => {
    await fs.appendFile(runLogPath, data.toString(), "utf8").catch(() => {});
  });
  child.on("close", async (code) => {
    await appendMonitorLog(`Run Now process ${child.pid} exited with code ${code}`);
    await fs.appendFile(runLogPath, `\nProcess exited with code ${code}\n`, "utf8").catch(() => {});
    activeRun = null;
  });
  child.on("error", async (error) => {
    await appendMonitorLog(`Run Now process failed to start: ${error.message}`);
    await fs.appendFile(runLogPath, `\nProcess failed to start: ${error.message}\n`, "utf8").catch(() => {});
    activeRun = null;
  });

  return { ok: true, pid: child.pid, message: `Run Now started as PID ${child.pid}.`, runLogPath };
}
async function registerTask(input) {
  const args = [
    "-File", path.join(automationRoot, "Register-NightlyInstalledBuildTask.ps1"),
    "-TaskName", input.taskName || taskName,
    "-At", input.at || "02:00"
  ];
  if (input.branch) args.push("-Branch", input.branch);
  if (input.builtDirectory) args.push("-BuiltDirectory", input.builtDirectory);
  args.push(...boolArg(input.skipSetup, "-SkipSetup"));
  args.push(...boolArg(input.skipGenerateProjectFiles, "-SkipGenerateProjectFiles"));
  args.push(...boolArg(input.noClean, "-NoClean"));
  args.push(...boolArg(input.skipUpstreamSync, "-SkipUpstreamSync"));
  args.push(...boolArg(input.skipPushOrigin, "-SkipPushOrigin"));
  args.push(...boolArg(input.allowMergeCommit, "-AllowMergeCommit"));
  if (input.noDdc) args.push("-NoDDC");

  const result = await runPowerShell(args);
  return { ok: result.code === 0, ...result };
}

async function startScheduledTask() {
  const result = await runPowerShell(["-Command", `Start-ScheduledTask -TaskName '${taskName.replaceAll("'", "''")}'`]);
  return { ok: result.code === 0, ...result };
}

function stopActiveRun() {
  if (!activeRun) return { ok: false, error: "No monitor-started automation process is running." };
  const pid = activeRun.pid;
  // ponytail: SIGTERM only kills powershell.exe; RunUAT->dotnet->UBT survive as orphans and trip the build guard. taskkill /T kills the whole tree.
  spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  activeRun = null;
  return { ok: true, pid };
}

async function serveStatic(req, res) {
  if (isDev) {
    sendJson(res, 404, { error: "Static files are served by Vite in dev mode." });
    return;
  }
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const fullPath = path.resolve(distRoot, requested);
  if (!fullPath.startsWith(distRoot) || !fssync.existsSync(fullPath)) {
    const indexPath = path.join(distRoot, "index.html");
    if (fssync.existsSync(indexPath)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(await fs.readFile(indexPath));
      return;
    }
    sendText(res, 404, "Not found");
    return;
  }
  const ext = path.extname(fullPath).toLowerCase();
  const type = ext === ".html" ? "text/html" : ext === ".js" ? "text/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
  res.writeHead(200, { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store" });
  res.end(await fs.readFile(fullPath));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/status" && req.method === "GET") return sendJson(res, 200, await getStatus());
    if (url.pathname === "/api/branches" && req.method === "GET") return sendJson(res, 200, await getBranches());
    if (url.pathname === "/api/upstream/register" && req.method === "POST") return sendJson(res, 200, await registerUpstream(await readBody(req)));
    if (url.pathname === "/api/run-now" && req.method === "POST") return sendJson(res, 200, await startRun(await readBody(req)));
    if (url.pathname === "/api/register-task" && req.method === "POST") return sendJson(res, 200, await registerTask(await readBody(req)));
    if (url.pathname === "/api/start-task" && req.method === "POST") return sendJson(res, 200, await startScheduledTask());
    if (url.pathname === "/api/stop" && req.method === "POST") return sendJson(res, 200, stopActiveRun());
    const ackMatch = /^\/api\/alerts\/(.+)\/ack$/.exec(url.pathname);
    if (ackMatch && req.method === "POST") {
      const state = await stateStore.load();
      state.acked[decodeURIComponent(ackMatch[1])] = new Date().toISOString();
      await stateStore.save();
      return sendJson(res, 200, { ok: true, message: "Alert acknowledged" });
    }
    if (url.pathname === "/api/channels" && req.method === "GET") {
      return sendJson(res, 200, (await workspace.load()).alerts?.channels || []);
    }
    if (url.pathname === "/api/channels" && req.method === "POST") {
      const body = await readBody(req);
      const ws = await workspace.load();
      if (Array.isArray(body)) {
        ws.alerts = ws.alerts || {};
        ws.alerts.channels = body;
        await workspace.save();
      }
      return sendJson(res, 200, ws.alerts.channels);
    }
    if (url.pathname === "/api/workspace/run-options" && req.method === "POST") {
      const body = await readBody(req);
      const ws = await workspace.load();
      ws.runOptions = { ...DEFAULT_RUN_OPTIONS, ...body };
      await workspace.save();
      return sendJson(res, 200, ws.runOptions);
    }
    if (url.pathname === "/api/deploy" && req.method === "GET") {
      const [state, ws] = await Promise.all([stateStore.load(), workspace.load()]);
      return sendJson(res, 200, {
        artifacts: await deployManager.listArtifacts(),
        targets: ws.deploy?.targets || [],
        history: state.deployHistory,
        active: deployManager.getActive()
      });
    }
    if (url.pathname === "/api/deploy/targets" && req.method === "POST") {
      const body = await readBody(req);
      const ws = await workspace.load();
      if (Array.isArray(body)) {
        // Only path/name are editable from the UI; kind/real stay server-defined.
        ws.deploy.targets = (ws.deploy?.targets || []).map((target) => {
          const patch = body.find((t) => t.id === target.id);
          return patch ? { ...target, name: patch.name ?? target.name, path: patch.path ?? target.path } : target;
        });
        await workspace.save();
      }
      return sendJson(res, 200, ws.deploy.targets);
    }
    if (url.pathname === "/api/deploy/start" && req.method === "POST") {
      return sendJson(res, 200, await deployManager.startDeploy(await readBody(req)));
    }
    if (url.pathname === "/api/browse" && req.method === "GET") {
      return sendJson(res, 200, await browseDirs(url.searchParams.get("path") || ""));
    }
    if (url.pathname === "/api/install-config" && req.method === "GET") return sendJson(res, 200, await getInstallConfig());
    if (url.pathname === "/api/install-config" && req.method === "POST") return sendJson(res, 200, await updateInstallConfig(await readBody(req)));
    if (url.pathname === "/api/logs" && req.method === "GET") return sendJson(res, 200, await listLogs());
    if (url.pathname.startsWith("/api/logs/") && url.pathname.endsWith("/download") && req.method === "GET") {
      const name = path.basename(decodeURIComponent(url.pathname.slice("/api/logs/".length, -"/download".length)));
      const fullPath = path.join(logFileRoot(name), name);
      if (!fssync.existsSync(fullPath)) return sendText(res, 404, "Not found");
      res.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store"
      });
      fssync.createReadStream(fullPath).pipe(res);
      return;
    }
    if (url.pathname.startsWith("/api/logs/") && req.method === "GET") {
      const name = decodeURIComponent(url.pathname.replace("/api/logs/", ""));
      const lines = Number(url.searchParams.get("lines") || 250);
      return sendText(res, 200, await tailFile(name, lines));
    }
    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`UE6 automation monitor server listening on http://${host}:${port}`);
  if (isDev) console.log("Use npm run ui in another terminal for the React dev server.");
});




