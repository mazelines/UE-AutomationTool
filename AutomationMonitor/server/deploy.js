import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

// Artifacts come from _postbuild.bat's build_summary_<ts>.txt files; only the
// newest successful build physically exists (the output directory is reused).
function parseSummary(text) {
  const record = {};
  for (const line of text.split(/\r?\n/)) {
    const kv = /^\s{2}([A-Za-z ]+):\s*(.*)$/.exec(line);
    if (kv) record[kv[1].trim()] = kv[2].trim();
  }
  return record;
}

const sevenZip = fssync.existsSync("C:\\Program Files\\7-Zip\\7z.exe") ? "C:\\Program Files\\7-Zip\\7z.exe" : "7z";

export function createDeployManager({ repoRoot, monitorLogRoot, store, getTargets, getAutoDeploy, getFormat, getInstallConfig, appendMonitorLog, machineUser, getOutputBytes }) {
  let activeDeploy = null;

  const resolveDir = (value, fallback) => {
    const rel = value || fallback;
    return path.isAbsolute(rel) ? rel : path.join(repoRoot, rel);
  };

  async function listArtifacts() {
    const config = await getInstallConfig();
    const logDir = resolveDir(config?.Paths?.LogDirectory, "LocalBuilds\\Logs");
    const outDir = resolveDir(config?.Paths?.OutputDirectory, "LocalBuilds\\Engine");

    let names = [];
    try {
      names = (await fs.readdir(logDir)).filter((n) => /^build_summary_.+\.txt$/.test(n)).sort().reverse();
    } catch {
      return [];
    }

    const artifacts = [];
    let currentAssigned = false;
    for (const name of names.slice(0, 12)) {
      try {
        const record = parseSummary(await fs.readFile(path.join(logDir, name), "utf8"));
        const ok = record.Status === "SUCCESS";
        const timestamp = record.Timestamp || name.replace(/^build_summary_|\.txt$/g, "");
        const isCurrent = ok && !currentAssigned && fssync.existsSync(outDir);
        if (isCurrent) currentAssigned = true;
        artifacts.push({
          id: `${record.Version || "?"}.${record["Build Number"] || timestamp}`,
          timestamp,
          label: record["Build Label"] || "-",
          platform: record.Platform || "-",
          gameConfigs: record["Game Configurations"] || "-",
          withDDC: record["With DDC"] === "true",
          ok,
          current: isCurrent,
          path: isCurrent ? outDir : null,
          sizeBytes: isCurrent ? getOutputBytes() : null,
          builtAt: timestamp
        });
      } catch {}
    }
    return artifacts;
  }

  async function startDeploy({ targetId, auto = false }) {
    if (activeDeploy) return { ok: false, error: `Deploy already running (PID ${activeDeploy.pid}).` };
    const target = (await getTargets()).find((t) => t.id === targetId);
    if (!target) return { ok: false, error: `Unknown deploy target: ${targetId}` };
    if (!target.real) return { ok: false, error: `${target.name || target.id} 타깃은 아직 스텁입니다 (SMB만 실배포 지원).` };
    if (!target.path) return { ok: false, error: "타깃 경로가 설정되지 않았습니다. Distribution Targets에서 경로를 입력하세요." };

    const artifacts = await listArtifacts();
    const current = artifacts.find((a) => a.current);
    if (!current) return { ok: false, error: "배포 가능한 CURRENT 아티팩트가 없습니다." };

    await fs.mkdir(monitorLogRoot, { recursive: true });
    const format = (await getFormat()) === "zip" ? "zip" : "7z";
    const archivePath = path.join(target.path, `Engine.${format}`);
    const partialPath = `${archivePath}.partial`;
    try {
      await fs.mkdir(target.path, { recursive: true });
      // 7z 'a' appends to an existing archive — a stale partial from a failed run must go first.
      await fs.rm(partialPath, { force: true });
    } catch (error) {
      return { ok: false, error: `타깃 경로 준비 실패: ${error.message}` };
    }
    const logPath = path.join(monitorLogRoot, `deploy-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    const args = ["a", `-t${format}`, "-mx=5", "-mmt=on", "-y", "-bsp0", partialPath, path.join(current.path, "*")];
    const child = spawn(sevenZip, args, { windowsHide: true });
    const startedAt = new Date().toISOString();
    activeDeploy = { pid: child.pid, artifactId: current.id, targetId, targetName: target.name || target.path, startedAt, logPath, auto };
    await appendMonitorLog(`Deploy started${auto ? " (auto)" : ""}: ${current.id} -> ${archivePath} (7z PID ${child.pid})`);
    const appendDeployLog = (data) => fs.appendFile(logPath, data.toString(), "utf8").catch(() => {});
    child.stdout?.on("data", appendDeployLog);
    child.stderr?.on("data", appendDeployLog);

    child.on("close", async (code) => {
      let ok = code === 0;
      if (ok) {
        try {
          await fs.rename(partialPath, archivePath);
        } catch (error) {
          ok = false;
          await appendMonitorLog(`Deploy PID ${child.pid}: Engine.7z 교체 실패 — ${error.message}`);
        }
      } else {
        await fs.rm(partialPath, { force: true }).catch(() => {});
      }
      const finished = new Date().toISOString();
      await appendMonitorLog(`Deploy PID ${child.pid} finished with 7z code ${code} (${ok ? "ok" : "FAILED"})`);
      try {
        const current2 = await store.load();
        current2.deployHistory = [
          {
            action: `${auto ? "Auto-deployed" : "Deployed"} ${activeDeploy?.artifactId || ""}`,
            target: activeDeploy?.targetName || target.path,
            targetId,
            at: finished,
            by: machineUser,
            ok,
            code
          },
          ...(current2.deployHistory || [])
        ].slice(0, 40);
        await store.save();
      } catch {}
      activeDeploy = null;
    });
    child.on("error", async (error) => {
      await appendMonitorLog(`Deploy failed to start: ${error.message}`);
      activeDeploy = null;
    });

    return { ok: true, pid: child.pid, message: `${current.id} → ${archivePath} 압축 배포 시작 (7z PID ${child.pid})` };
  }

  // Polled from index.js — deploys each new successful build exactly once when auto-deploy is on.
  // Covers both monitor-started runs and scheduled-task builds (both end in a build_summary file).
  async function checkAutoDeploy() {
    if (activeDeploy) return;
    const auto = await getAutoDeploy();
    if (!auto?.enabled) return;
    const current = (await listArtifacts()).find((a) => a.current);
    if (!current) return;
    const state = await store.load();
    if (state.lastAutoDeploy === current.timestamp) return;
    // Mark before deploying — one attempt per build, no retry loop when the target share is down.
    state.lastAutoDeploy = current.timestamp;
    await store.save();
    const result = await startDeploy({ targetId: auto.targetId || "smb", auto: true });
    if (!result.ok) await appendMonitorLog(`Auto-deploy skipped for ${current.id}: ${result.error}`);
  }

  return { listArtifacts, startDeploy, checkAutoDeploy, getActive: () => activeDeploy };
}
