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

export function createDeployManager({ repoRoot, monitorLogRoot, store, getTargets, getAutoDeploy, getFormat, getInstallConfig, appendMonitorLog, machineUser, getOutputBytes, spawnProcess = spawn }) {
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
        const isCurrent = ok && name === names[0] && !currentAssigned && fssync.existsSync(outDir);
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
          builtAt: timestamp,
          releaseNotesPath: path.join(logDir, `releasseNote_${name.replace(/^build_summary_|\.txt$/g, "")}.txt`)
        });
      } catch {}
    }
    return artifacts;
  }

  async function startDeploy({ targetId, auto = false }) {
    if (activeDeploy) return { ok: false, error: `Deploy already running (PID ${activeDeploy.pid}).` };
    activeDeploy = { phase: "preparing", targetId };
    try {
      return await prepareDeploy({ targetId, auto });
    } catch (error) {
      return { ok: false, error: error.message };
    } finally {
      if (activeDeploy?.phase === "preparing") activeDeploy = null;
    }
  }

  async function prepareDeploy({ targetId, auto }) {
    const target = (await getTargets()).find((t) => t.id === targetId);
    if (!target) return { ok: false, error: `Unknown deploy target: ${targetId}` };
    if (!target.real) return { ok: false, error: `${target.name || target.id} 타깃은 아직 스텁입니다 (SMB만 실배포 지원).` };
    if (!target.path) return { ok: false, error: "타깃 경로가 설정되지 않았습니다. Distribution Targets에서 경로를 입력하세요." };
    const isDrive = target.id === "gdrive";
    if (isDrive && !path.isAbsolute(target.path)) {
      return { ok: false, error: "Google Drive 데스크톱 앱의 동기화 폴더 절대 경로를 지정하세요." };
    }

    const artifacts = await listArtifacts();
    const current = artifacts.find((a) => a.current);
    if (!current) return { ok: false, error: "배포 가능한 CURRENT 아티팩트가 없습니다." };
    if (isDrive && !fssync.existsSync(current.releaseNotesPath)) return { ok: false, error: "릴리스 노트가 아직 없거나 생성 중입니다. releasseNote 파일 생성 후 다시 배포하세요." };

    await fs.mkdir(monitorLogRoot, { recursive: true });
    const format = (await getFormat()) === "zip" ? "zip" : "7z";
    const stagingDir = isDrive ? await fs.mkdtemp(path.join(monitorLogRoot, "gdrive-")) : target.path;
    const archivePath = path.join(stagingDir, `Engine.${format}`);
    const destination = isDrive ? path.join(target.path, `Engine-${current.timestamp.replace(/[^\w-]/g, "_")}.${format}`) : archivePath;
    if (isDrive) {
      try {
        const targetStat = await fs.stat(target.path);
        if (!targetStat.isDirectory()) throw new Error("폴더가 아닙니다.");
      } catch (error) {
        await fs.rmdir(stagingDir).catch(() => {});
        return { ok: false, error: `Google Drive 동기화 폴더에 접근할 수 없습니다. Drive 앱과 로그인 상태를 확인하세요: ${error.message}` };
      }
    }
    const partialPath = `${archivePath}.partial`;
    try {
      await fs.mkdir(stagingDir, { recursive: true });
      // 7z 'a' appends to an existing archive — a stale partial from a failed run must go first.
      await fs.rm(partialPath, { force: true });
    } catch (error) {
      return { ok: false, error: `타깃 경로 준비 실패: ${error.message}` };
    }
    const logPath = path.join(monitorLogRoot, `deploy-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    const args = ["a", `-t${format}`, "-mx=5", "-mmt=on", "-y", "-bsp0", partialPath, path.join(current.path, "*")];
    const child = spawnProcess(sevenZip, args, { windowsHide: true });
    const startedAt = new Date().toISOString();
    activeDeploy = { phase: "compressing", pid: child.pid, artifactId: current.id, targetId, targetName: target.name || target.path, startedAt, logPath, auto };
    const appendDeployLog = (data) => fs.appendFile(logPath, data.toString(), "utf8").catch(() => {});
    child.stdout?.on("data", appendDeployLog);
    child.stderr?.on("data", appendDeployLog);

    let spawnError = null;
    child.on("error", (error) => { spawnError = error; appendDeployLog(error.message); });
    child.on("close", async (code) => {
      let ok = code === 0;
      let failure = spawnError?.message || null;
      if (ok) {
        try {
          await fs.rename(partialPath, archivePath);
        } catch (error) {
          ok = false;
          failure = error.message;
          await appendMonitorLog(`Deploy PID ${child.pid}: Engine.7z 교체 실패 — ${error.message}`);
        }
      } else {
        await fs.rm(partialPath, { force: true }).catch(() => {});
      }
      if (ok && isDrive) {
        activeDeploy.phase = "copying";
        try {
          for (const [source, outputPath] of [[archivePath, destination], [current.releaseNotesPath, path.join(target.path, path.basename(current.releaseNotesPath))]]) {
            const copyPartial = `${outputPath}.partial`;
            try {
              await fs.copyFile(source, copyPartial);
              await fs.rename(copyPartial, outputPath);
            } finally {
              await fs.rm(copyPartial, { force: true }).catch(() => {});
            }
          }
        } catch (error) {
          ok = false;
          failure = error.message;
          appendDeployLog(`\n${failure}\n`);
        }
      }
      if (isDrive) {
        await fs.rm(partialPath, { force: true }).catch(() => {});
        await fs.rm(archivePath, { force: true }).catch(() => {});
        await fs.rmdir(stagingDir).catch(() => {});
      }
      const finished = new Date().toISOString();
      await appendMonitorLog(`Deploy finished: ${destination} (${ok ? "ok" : `FAILED: ${failure || `7z code ${code}`}`})`);
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
            code,
            error: failure,
            destination,
            delivery: isDrive ? "desktop-sync" : "filesystem"
          },
          ...(current2.deployHistory || [])
        ].slice(0, 40);
        await store.save();
      } catch {}
      activeDeploy = null;
    });

    await appendMonitorLog(`Deploy started${auto ? " (auto)" : ""}: ${current.id} -> ${destination} (7z PID ${child.pid})`).catch(() => {});
    return { ok: true, pid: child.pid, message: `${current.id} → ${destination} 압축 배포 시작 (7z PID ${child.pid})` };
  }

  // Polled from index.js — deploys each new successful build exactly once when auto-deploy is on.
  // Covers both monitor-started runs and scheduled-task builds (both end in a build_summary file).
  async function checkAutoDeploy() {
    if (activeDeploy) return;
    const auto = await getAutoDeploy();
    if (!auto?.enabled) return;
    const current = (await listArtifacts()).find((a) => a.current);
    if (!current) return;
    if (auto.targetId === "gdrive" && !fssync.existsSync(current.releaseNotesPath)) return;
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
