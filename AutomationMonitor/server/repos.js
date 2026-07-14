import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Registry of locally cloned UE repositories the monitor can target. Lives at
// AutomationMonitor/repos.json (host-specific paths, gitignored) — separate from
// workspace.json, which now lives inside each repo's own LocalBuilds/AutomationMonitor/.
export function createRepoRegistry(filePath) {
  let data = null;

  async function load() {
    if (data) return data;
    try {
      data = JSON.parse(await fs.readFile(filePath, "utf8"));
    } catch {
      data = { repos: [], activeId: null };
    }
    return data;
  }

  async function save() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  async function add(name, repoPath) {
    if (!repoPath || !repoPath.trim()) return { ok: false, error: "저장소 경로를 입력하세요." };
    const resolved = path.resolve(repoPath.trim());
    if (!fssync.existsSync(path.join(resolved, ".git"))) {
      return { ok: false, error: `${resolved} 는 git 저장소가 아닙니다 (.git 폴더 없음).` };
    }
    await load();
    if (data.repos.some((r) => path.resolve(r.path) === resolved)) {
      return { ok: false, error: "이미 등록된 경로입니다." };
    }
    const repo = { id: crypto.randomUUID(), name: (name || "").trim() || path.basename(resolved), path: resolved };
    data.repos.push(repo);
    if (!data.activeId) data.activeId = repo.id;
    await save();
    return { ok: true, repo, data };
  }

  async function remove(id) {
    await load();
    data.repos = data.repos.filter((r) => r.id !== id);
    if (data.activeId === id) data.activeId = data.repos[0]?.id || null;
    await save();
    return { ok: true, data };
  }

  async function setActive(id) {
    await load();
    if (!data.repos.some((r) => r.id === id)) return { ok: false, error: "등록되지 않은 저장소입니다." };
    data.activeId = id;
    await save();
    return { ok: true, data };
  }

  async function getActive() {
    await load();
    return data.repos.find((r) => r.id === data.activeId) || null;
  }

  return { load, add, remove, setActive, getActive };
}
