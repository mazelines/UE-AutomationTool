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

export function createDeployManager({ repoRoot, monitorLogRoot, store, getTargets, getInstallConfig, appendMonitorLog, machineUser, getOutputBytes }) {
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

  async function startDeploy({ targetId }) {
    if (activeDeploy) return { ok: false, error: `Deploy already running (PID ${activeDeploy.pid}).` };
    const target = (await getTargets()).find((t) => t.id === targetId);
    if (!target) return { ok: false, error: `Unknown deploy target: ${targetId}` };
    if (!target.real) return { ok: false, error: `${target.name || target.id} 타깃은 아직 스텁입니다 (SMB만 실배포 지원).` };
    if (!target.path) return { ok: false, error: "타깃 경로가 설정되지 않았습니다. Distribution Targets에서 경로를 입력하세요." };

    const artifacts = await listArtifacts();
    const current = artifacts.find((a) => a.current);
    if (!current) return { ok: false, error: "배포 가능한 CURRENT 아티팩트가 없습니다." };

    await fs.mkdir(monitorLogRoot, { recursive: true });
    const logPath = path.join(monitorLogRoot, `deploy-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    const args = [current.path, target.path, "/MIR", "/MT:16", "/R:2", "/W:5", "/NP", "/NFL", "/NDL", `/LOG:${logPath}`];
    const child = spawn("robocopy", args, { windowsHide: true });
    const startedAt = new Date().toISOString();
    activeDeploy = { pid: child.pid, artifactId: current.id, targetId, targetName: target.name || target.path, startedAt, logPath };
    await appendMonitorLog(`Deploy started: ${current.id} -> ${target.path} (PID ${child.pid})`);

    child.on("close", async (code) => {
      // robocopy: 0-7 are success-ish (bitmask), >=8 means failures occurred.
      const ok = code < 8;
      const finished = new Date().toISOString();
      await appendMonitorLog(`Deploy PID ${child.pid} finished with robocopy code ${code} (${ok ? "ok" : "FAILED"})`);
      try {
        const current2 = await store.load();
        current2.deployHistory = [
          {
            action: `Deployed ${activeDeploy?.artifactId || ""}`,
            target: activeDeploy?.targetName || target.path,
            targetId,
            at: finished,
            by: machineUser,
            ok,
            robocopyCode: code
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

    return { ok: true, pid: child.pid, message: `${current.id} → ${target.path} 배포 시작 (robocopy PID ${child.pid})` };
  }

  return { listArtifacts, startDeploy, getActive: () => activeDeploy };
}
