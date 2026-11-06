import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeReleaseNotes } from "./release-notes.js";
const execute = promisify(execFile);
const revision = /^[a-f0-9]{40,64}$/i;

export async function resolveArtifactRevisions({ repoRoot, artifact, artifacts,
  git = async (args) => (await execute("git", args, { cwd: repoRoot, windowsHide: true, encoding: "utf8", timeout: 60000, maxBuffer: 8 * 1024 * 1024 })).stdout
}) {
  const contextPath = path.join(repoRoot, "LocalBuilds", "AutomationLogs", `release-context_${artifact.timestamp}.json`);
  try {
    const context = JSON.parse(await fs.readFile(contextPath, "utf8"));
    if (context.timestamp !== artifact.timestamp || !revision.test(context.base) || !revision.test(context.head)) throw new Error("Invalid saved build revisions");
    return context;
  } catch (error) { if (error.code !== "ENOENT") throw error; }

  // Legacy builds did not save revision metadata. Reconstruct from local checkout history,
  // never from today's HEAD or commit author dates, which may describe a later build.
  const reflog = await git(["reflog", "show", "--format=%H%x09%gD", "--date=iso-strict", "HEAD"]);
  function atBuild(timestamp) {
    const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(timestamp);
    if (!m) throw new Error("Invalid artifact timestamp");
    const time = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    for (const line of reflog.split(/\r?\n/)) {
      const entry = /^([a-f0-9]{40,64})\t.*@\{(.+)\}$/.exec(line.trim());
      if (entry && Date.parse(entry[2]) <= time) return entry[1];
    }
    throw new Error("빌드 시점의 Git 기록이 없습니다. 해당 빌드의 release-context 파일을 복원해야 합니다.");
  }
  const head = atBuild(artifact.timestamp);
  const previous = artifacts.find((item) => item.ok && item.timestamp < artifact.timestamp);
  let base;
  let evidenceNote = "빌드 당시 저장된 비교 정보가 없어 로컬 Git reflog로 빌드 커밋을 복구했습니다.";
  if (previous) {
    try { base = atBuild(previous.timestamp); } catch { /* disclose the limited fallback below */ }
  }
  if (!base) {
    base = (await git(["rev-parse", "--verify", `${head}^`])).trim();
    evidenceNote += " 이전 성공 빌드의 기준을 확인할 수 없어 빌드 커밋 직전 커밋과만 비교했습니다. 전체 빌드 간 변경 목록은 아닙니다.";
  }
  if (!revision.test(base)) throw new Error("Invalid recovered base revision");
  return { base, head, timestamp: artifact.timestamp, branch: "빌드 시점 Git 기록", upstream: "빌드 시점 설정 기록 없음", evidenceNote };
}

export function createArtifactNotesManager({ getContext, isBusy, generate = writeReleaseNotes, resolve = resolveArtifactRevisions }) {
  let state = null;
  let active = false;
  async function start({ timestamp } = {}) {
    if (active) return { ok: false, error: "릴리스노트 생성 중입니다." };
    active = true;
    try {
      if (await isBusy()) throw new Error("빌드·배포·에이전트 작업이 끝난 후 생성하세요.");
      const context = await getContext();
      const artifact = context?.artifacts.find((item) => item.current && item.timestamp === timestamp);
      if (!artifact) throw new Error("현재 CURRENT 아티팩트를 다시 선택하세요.");
      if (artifact.releaseNotesExists) { active = false; return { ok: true, exists: true }; }
      state = { repoRoot: context.repoRoot, timestamp, status: "running", startedAt: new Date().toISOString() };
      void (async () => {
        try {
          const revisions = await resolve({ ...context, artifact });
          const result = await generate({ ...revisions, repoRoot: context.repoRoot, outputDirectory: path.dirname(artifact.releaseNotesPath), log: () => {} });
          state = { ...state, status: "completed", generated: result.generated, finishedAt: new Date().toISOString() };
        } catch (error) {
          state = { ...state, status: "failed", error: error.message, finishedAt: new Date().toISOString() };
        } finally { active = false; }
      })();
      return { ok: true, message: "릴리스노트 생성을 시작했습니다." };
    } catch (error) { active = false; return { ok: false, error: error.message }; }
  }
  return { start, isActive: () => active, getState: (repoRoot) => state?.repoRoot === repoRoot ? { ...state } : null };
}
