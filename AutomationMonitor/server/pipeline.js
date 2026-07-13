import fs from "node:fs/promises";
import path from "node:path";

// Stage names must match Invoke-LoggedStep names in Automation/SyncAndBuildInstalled.ps1.
export const STAGE_NAMES = [
  "Validate repository state",
  "Configure upstream remote",
  "Fetch origin and upstream",
  "Checkout build branch",
  "Merge upstream into local branch",
  "Push synced branch to fork origin",
  "Sync Unreal dependencies",
  "Generate project files",
  "Install build pre-processing",
  "Build Win64 installed engine",
  "Install build post-processing"
];

// Relative weight of each stage in the overall progress bar (build dominates).
const STAGE_WEIGHTS = [4, 2, 8, 12, 3, 4, 8, 20, 3, 160, 6];
const TOTAL_WEIGHT = STAGE_WEIGHTS.reduce((a, b) => a + b, 0);
const BUILD_STAGE = "Build Win64 installed engine";

const STEP_LINE = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\] (START|DONE)\s+(.+)$/;
const TRANSCRIPT_END = /Windows PowerShell (기록 끝|transcript end)/;

function toIso(stamp) {
  const date = new Date(stamp.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseWrapperLog(text) {
  const stages = [];
  let pid = null;
  let branch = "";
  let buildOutputLog = "";
  for (const line of text.split(/\r?\n/)) {
    const step = STEP_LINE.exec(line);
    if (step) {
      const at = toIso(step[1]);
      if (step[2] === "START") {
        stages.push({ name: step[3].trim(), startAt: at, endAt: null, seconds: null });
      } else {
        const done = /^(.*?)\s*\((\d+)s\)$/.exec(step[3].trim());
        const name = done ? done[1] : step[3].trim();
        const open = [...stages].reverse().find((s) => s.name === name && !s.endAt);
        if (open) {
          open.endAt = at;
          open.seconds = done ? Number(done[2]) : null;
        }
      }
      continue;
    }
    if (pid === null && /^(프로세스 ID|Process ID):/.test(line)) pid = Number(line.split(":")[1]);
    else if (!branch && line.startsWith("Branch: ")) branch = line.slice(8).trim();
    else if (!buildOutputLog && line.startsWith("Build output log: ")) buildOutputLog = line.slice(18).trim();
  }
  const times = stages.flatMap((s) => [s.startAt, s.endAt]).filter(Boolean).sort();
  return {
    pid,
    branch,
    buildOutputLog: buildOutputLog ? path.basename(buildOutputLog) : "",
    stages,
    ended: TRANSCRIPT_END.test(text),
    startedAt: times[0] || null,
    lastAt: times[times.length - 1] || null
  };
}

// monitor.log correlation: "Run Now requested with args: ..." then "Run Now process <pid> exited with code <n>".
export function parseMonitorLog(text) {
  const byPid = new Map();
  let pendingArgs = null;
  for (const line of text.split(/\r?\n/)) {
    const requested = /Run Now requested with args: (.*)$/.exec(line);
    if (requested) {
      pendingArgs = requested[1];
      continue;
    }
    const exited = /Run Now process (\d+) exited with code (-?\d+)/.exec(line);
    if (exited) {
      byPid.set(Number(exited[1]), { exitCode: Number(exited[2]), args: pendingArgs });
      pendingArgs = null;
    }
  }
  return byPid;
}

const fileCache = new Map();

async function readParsed(fullPath, parser) {
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch {
    return null;
  }
  const hit = fileCache.get(fullPath);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value;
  const value = parser(await fs.readFile(fullPath, "utf8"));
  fileCache.set(fullPath, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}

function runIdFromName(name) {
  return /SyncAndBuildInstalled-(\d{8}-\d{6})\.log/.exec(name)?.[1] || name;
}

function modeFromArgs(args) {
  if (!args) return "Manual";
  return /-NoClean\b/.test(args) ? "NoClean" : "Clean";
}

async function readBuildExit(logRoot, buildLogName, tailFile) {
  if (!buildLogName) return null;
  try {
    const tail = await tailFile(buildLogName, 40);
    const exits = [...tail.matchAll(/ExitCode=(-?\d+)/g)];
    if (!exits.length) return null;
    return Number(exits[exits.length - 1][1]);
  } catch {
    return null;
  }
}

const finishedRuns = new Map();

export async function buildPipelineStatus({ logRoot, logs, tailFile, isMonitorRunActive, isTaskRunning }) {
  const wrapperLogs = logs.filter((log) => log.name.startsWith("SyncAndBuildInstalled-"));
  const monitorMap = await readParsed(path.join(logRoot, "..", "AutomationMonitor", "monitor.log"), parseMonitorLog) || new Map();

  const runs = [];
  for (const log of wrapperLogs.slice(0, 30)) {
    const cachedRun = finishedRuns.get(log.name);
    if (cachedRun) {
      runs.push(cachedRun);
      continue;
    }
    const parsed = await readParsed(path.join(logRoot, log.name), parseWrapperLog);
    if (!parsed) continue;

    const isLatest = log === wrapperLogs[0];
    const monitorHit = parsed.pid != null ? monitorMap.get(parsed.pid) : null;
    const recentlyTouched = Date.now() - new Date(log.modifiedAt).getTime() < 3 * 60 * 1000;
    const buildStage = parsed.stages.find((s) => s.name === BUILD_STAGE);

    let result;
    let reason = "";
    if (!parsed.ended) {
      const running = isLatest && (isMonitorRunActive || isTaskRunning || recentlyTouched);
      result = running ? "running" : "aborted";
      if (result === "aborted") reason = "Aborted — process terminated";
    } else if (monitorHit) {
      result = monitorHit.exitCode === 0 ? "success" : "failed";
    } else {
      const exitCode = await readBuildExit(logRoot, parsed.buildOutputLog, tailFile);
      if (exitCode !== null) result = exitCode === 0 ? "success" : "failed";
      else if (buildStage?.endAt && parsed.stages.every((s) => s.endAt)) result = "success";
      else result = "failed";
    }

    if (!reason) {
      if (result === "success") reason = "Installed build complete";
      else if (result === "running") reason = "In progress";
      else if (result === "failed") {
        const openStage = parsed.stages.find((s) => !s.endAt);
        if (openStage) reason = `${openStage.name} failed`;
        else if (buildStage) {
          const exitCode = await readBuildExit(logRoot, parsed.buildOutputLog, tailFile);
          reason = exitCode !== null && exitCode !== 0 ? `Build exited with code ${exitCode}` : "Build failed";
        } else reason = "Failed before build stage";
      }
    }

    const endAt = parsed.ended ? parsed.lastAt : result === "running" ? null : log.modifiedAt;
    const run = {
      id: runIdFromName(log.name),
      logName: log.name,
      buildLogName: parsed.buildOutputLog || null,
      branch: parsed.branch,
      startedAt: parsed.startedAt,
      endedAt: endAt,
      durationSeconds:
        parsed.startedAt && (endAt || result === "running")
          ? Math.max(0, Math.round(((endAt ? new Date(endAt) : new Date()) - new Date(parsed.startedAt)) / 1000))
          : null,
      result,
      reason,
      mode: monitorHit ? modeFromArgs(monitorHit.args) : "Nightly"
    };
    runs.push(run);
    if (result !== "running" && parsed.ended) finishedRuns.set(log.name, run);
  }

  // Pipeline detail for the latest run.
  let pipeline = null;
  const latest = wrapperLogs[0];
  if (latest) {
    const parsed = await readParsed(path.join(logRoot, latest.name), parseWrapperLog);
    const run = runs.find((r) => r.logName === latest.name);
    if (parsed && run) {
      const running = run.result === "running";
      const stages = STAGE_NAMES.map((name) => {
        const hit = parsed.stages.find((s) => s.name === name);
        if (!hit) return { name, status: running ? "pending" : "skipped", seconds: null };
        if (hit.endAt) return { name, status: "done", seconds: hit.seconds };
        return {
          name,
          status: running ? "active" : "stopped",
          seconds: Math.max(0, Math.round((Date.now() - new Date(hit.startAt)) / 1000))
        };
      });

      let buildProgress = null;
      const activeIdx = stages.findIndex((s) => s.status === "active" || s.status === "stopped");
      if (parsed.buildOutputLog && stages[STAGE_NAMES.indexOf(BUILD_STAGE)].status !== "pending") {
        try {
          const tail = await tailFile(parsed.buildOutputLog, 60);
          const actions = [...tail.matchAll(/\[(\d+)\/(\d+)\]\s*(.*)/g)];
          if (actions.length) {
            const last = actions[actions.length - 1];
            buildProgress = { done: Number(last[1]), total: Number(last[2]), line: last[3].trim() };
          }
        } catch {}
      }

      let weightDone = 0;
      stages.forEach((stage, index) => {
        if (stage.status === "done" || stage.status === "skipped") weightDone += STAGE_WEIGHTS[index];
        else if (stage.status === "active" || stage.status === "stopped") {
          let fraction = 0.5;
          if (stage.name === BUILD_STAGE && buildProgress?.total) fraction = buildProgress.done / buildProgress.total;
          weightDone += STAGE_WEIGHTS[index] * Math.min(1, fraction);
        }
      });

      pipeline = {
        buildId: run.id,
        logName: latest.name,
        branch: run.branch,
        mode: run.mode,
        result: run.result,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        durationSeconds: run.durationSeconds,
        currentStage: activeIdx >= 0 ? activeIdx : run.result === "success" ? STAGE_NAMES.length - 1 : null,
        stages,
        buildProgress,
        overallPct: run.result === "success" ? 100 : Math.round((weightDone / TOTAL_WEIGHT) * 100)
      };
    }
  }

  return { pipeline, runs };
}
