import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Toast, DirPicker, EmptyState } from "./components.jsx";
import {
  IconLogo, IconOverview, IconPipeline, IconDeploy, IconLogs, IconBell,
  IconRepoTree, IconBranch, IconSun, IconMoon
} from "./icons.jsx";
import OverviewView from "./views/Overview.jsx";
import RunPipelineView from "./views/RunPipeline.jsx";
import DeployView from "./views/Deploy.jsx";
import LogsView from "./views/Logs.jsx";
import AlertsView from "./views/Alerts.jsx";

const themeStorageKey = "ue6-monitor-theme";

const defaultOptions = {
  builtDirectory: "",
  at: "02:00",
  skipSetup: false,
  skipGenerateProjectFiles: false,
  skipUpstreamSync: false,
  skipPushOrigin: false,
  noDdc: true,
  allowMergeCommit: true
};

const NAV = [
  { id: "overview", label: "Overview", Icon: IconOverview },
  { id: "pipeline", label: "Run & Pipeline", Icon: IconPipeline },
  { id: "deploy", label: "Deploy", Icon: IconDeploy },
  { id: "logs", label: "Logs", Icon: IconLogs },
  { id: "alerts", label: "Alerts", Icon: IconBell }
];

// Repo registry lives server-side (AutomationMonitor/repos.json); this modal is the only
// place that reads/writes it — add, activate, or drop a locally cloned UE repo.
function RepoModal({ repos, activeId, isRunning, onClose, onActivate, onAdd, onRemove }) {
  const [name, setName] = useState("");
  const [pathValue, setPathValue] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputStyle = {
    border: "1px solid var(--border)", background: "var(--surface)",
    color: "var(--text)", borderRadius: 7, padding: "7px 9px", outline: "none"
  };

  async function submitAdd() {
    if (!pathValue.trim() || busy) return;
    setBusy(true);
    try {
      if (await onAdd(name, pathValue)) { setName(""); setPathValue(""); }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()} style={{ width: 560 }}>
        <div className="modal-head">
          <b>저장소 관리</b>
          <button className="btn tiny" onClick={onClose}>닫기</button>
        </div>
        <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: 9, maxHeight: "42vh", overflowY: "auto" }}>
          {repos.length === 0 && <div className="browse-empty">등록된 저장소가 없습니다. 아래에서 로컬에 클론된 언리얼 엔진 저장소를 추가하세요.</div>}
          {repos.map((repo) => (
            <div
              key={repo.id}
              style={{
                border: `1px solid ${repo.id === activeId ? "var(--accent)" : "var(--border)"}`,
                borderRadius: 10, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 7 }}>
                  {repo.name}
                  {repo.id === activeId && <span className="tag-pill accent">ACTIVE</span>}
                </div>
                <div className="cell-mono" style={{ fontSize: 11.5, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {repo.path}
                </div>
              </div>
              {repo.id !== activeId && (
                <button className="btn tiny" disabled={isRunning} onClick={() => onActivate(repo.id)}>선택</button>
              )}
              <button className="btn tiny" disabled={isRunning} onClick={() => onRemove(repo.id)}>삭제</button>
            </div>
          ))}
        </div>
        <div className="modal-foot" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input placeholder="이름 (선택)" value={name} onChange={(event) => setName(event.target.value)} style={{ ...inputStyle, flex: "0 0 140px" }} />
            <input
              placeholder="F:\UnrealEngine\ue6-main"
              value={pathValue}
              onChange={(event) => setPathValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") submitAdd(); }}
              style={{ ...inputStyle, flex: 1, fontFamily: "var(--font-mono)" }}
            />
            <button className="btn sm" onClick={() => setBrowsing(true)}>찾아보기</button>
          </div>
          <button className="btn accent sm" disabled={busy || !pathValue.trim()} onClick={submitAdd}>저장소 추가</button>
        </div>
      </div>
      {browsing && (
        <DirPicker
          initial={pathValue}
          onClose={() => setBrowsing(false)}
          onPick={(picked) => { setPathValue(picked); setBrowsing(false); }}
        />
      )}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem(themeStorageKey) || "dark");
  const [view, setView] = useState("overview");
  const [status, setStatus] = useState(null);
  const [installConfig, setInstallConfig] = useState(null);
  const [upstreamBranches, setUpstreamBranches] = useState([]);
  const [options, setOptions] = useState(defaultOptions);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const toastTimer = useRef(null);
  const optionsSeeded = useRef(false);
  const optionsSaveTimer = useRef(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(themeStorageKey, theme); } catch {}
  }, [theme]);

  // Run options live in workspace.json on the server — seed once, then debounce-save edits.
  useEffect(() => {
    if (!optionsSeeded.current && status?.runOptions) {
      optionsSeeded.current = true;
      setOptions({ ...defaultOptions, ...status.runOptions });
    }
  }, [status]);

  useEffect(() => {
    if (!optionsSeeded.current) return;
    if (optionsSaveTimer.current) clearTimeout(optionsSaveTimer.current);
    optionsSaveTimer.current = setTimeout(() => {
      api("/api/workspace/run-options", { method: "POST", body: JSON.stringify(options) }).catch(() => {});
    }, 800);
    return () => clearTimeout(optionsSaveTimer.current);
  }, [options]);

  function flash(kind, msg) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ kind, msg });
    toastTimer.current = setTimeout(() => setToast(null), 3600);
  }

  async function refresh() {
    setStatus(await api("/api/status"));
  }

  useEffect(() => {
    api("/api/install-config").then(setInstallConfig).catch(() => {});
    refresh().catch((error) => flash("error", error.message));
    const timer = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, []);

  const taskState = status?.task?.exists ? status.task.state : "Not registered";
  const isRunning = Boolean(status?.activeRun) || taskState === "Running";
  const branch = status?.git?.branch || "-";
  const repos = status?.repos?.repos || [];
  const activeRepoId = status?.repos?.activeId || null;
  const activeRepo = repos.find((r) => r.id === activeRepoId) || null;
  const hasRepo = Boolean(status?.repoRoot);

  // Repo switches change everything downstream (build config, branches, logs) — reload
  // rather than re-syncing the half-dozen state hooks seeded from the previous repo.
  async function repoAction(action) {
    try {
      const result = await action();
      if (result?.error) { flash("error", result.error); return false; }
      window.location.reload();
      return true;
    } catch (error) {
      flash("error", error.message || String(error));
      return false;
    }
  }
  const addRepo = (name, repoPath) => repoAction(() => api("/api/repos", { method: "POST", body: JSON.stringify({ name, path: repoPath }) }));
  const activateRepoId = (id) => repoAction(() => api("/api/repos/active", { method: "POST", body: JSON.stringify({ id }) }));
  const removeRepoId = (id) => repoAction(() => api(`/api/repos/${encodeURIComponent(id)}`, { method: "DELETE" }));

  async function runAction(label, action, kind = "success") {
    setBusy(true);
    try {
      const result = await action();
      if (result?.error) flash("error", result.error);
      else flash(kind, result?.message || `${label} 완료`);
      await refresh();
      return result;
    } catch (error) {
      flash("error", error.message || String(error));
    } finally {
      setBusy(false);
    }
  }

  const actions = {
    runClean: () =>
      runAction("Run (Clean)", () =>
        api("/api/run-now", { method: "POST", body: JSON.stringify({ ...options, noClean: false }) }), "info"),
    runNoClean: () =>
      runAction("Run (NoClean)", () =>
        api("/api/run-now", { method: "POST", body: JSON.stringify({ ...options, noClean: true }) }), "info"),
    stop: () =>
      runAction("Stop", async () => {
        const result = await api("/api/stop", { method: "POST" });
        return result.ok ? { message: `프로세스 트리 종료됨 (PID ${result.pid})` } : result;
      }, "warning"),
    register: () =>
      runAction("Register Task", () =>
        api("/api/register-task", { method: "POST", body: JSON.stringify(options) })),
    startTask: () =>
      runAction("Start Task", () => api("/api/start-task", { method: "POST" }), "info"),
    saveConfig: () =>
      runAction("Save Config", async () => {
        const saved = await api("/api/install-config", { method: "POST", body: JSON.stringify(installConfig) });
        setInstallConfig(saved);
        return { message: "install_build_config.ini 저장됨" };
      }),
    reloadConfig: () =>
      runAction("Reload", async () => {
        setInstallConfig(await api("/api/install-config"));
        return { message: "Config를 다시 불러왔습니다" };
      }, "info"),
    addUpstream: () =>
      runAction("Add Upstream", async () => {
        const result = await api("/api/upstream/register", {
          method: "POST",
          body: JSON.stringify({
            remote: installConfig?.Run?.UpstreamRemote,
            url: installConfig?.Run?.UpstreamUrl,
            branch: installConfig?.Run?.UpstreamBranch
          })
        });
        if (result?.ok && Array.isArray(result.branches)) setUpstreamBranches(result.branches);
        return result;
      }, "info"),
    ackAlert: (id) =>
      runAction("Acknowledge", () => api(`/api/alerts/${encodeURIComponent(id)}/ack`, { method: "POST" }))
  };

  const shared = { status, installConfig, setInstallConfig, upstreamBranches, options, setOptions, busy, isRunning, actions, setView, flash };

  const machine = status?.machine;
  const openAlertCount = status?.alerts?.openCount || 0;

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-brand">
          <div className="rail-logo"><IconLogo /></div>
          <div>
            <div className="rail-brand-title">UE6 Automation</div>
            <div className="rail-brand-sub">Build Monitor</div>
          </div>
        </div>
        <div className="rail-nav">
          <div className="rail-nav-label">Monitor</div>
          {NAV.map(({ id, label, Icon }) => (
            <button key={id} className={`nav-item${view === id ? " active" : ""}`} onClick={() => setView(id)}>
              <Icon />
              <span>{label}</span>
              {id === "alerts" && openAlertCount > 0 && <span className="nav-badge">{openAlertCount}</span>}
            </button>
          ))}
        </div>
        <div className="rail-foot">
          <div className="machine-card">
            <div className="machine-label">Machine</div>
            <div className="machine-name">
              <span className="dot success halo" style={{ width: 8, height: 8 }} />
              <span>{machine?.host || "-"}</span>
            </div>
            <div className="machine-meta">
              {machine ? `${machine.user} · ${machine.os}` : "상태 불러오는 중"}
              <br />
              Monitor {machine?.monitorVersion || "-"} · online
            </div>
          </div>
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <button
            className="repo-path"
            title={status?.repoRoot ? `${activeRepo?.name || ""} · ${status.repoRoot}` : "저장소를 선택하세요"}
            style={{ background: "none", border: "none", cursor: "pointer" }}
            onClick={() => setRepoModalOpen(true)}
          >
            <IconRepoTree />
            <span>{status ? (activeRepo?.name || status.repoRoot || "저장소를 선택하세요") : "..."}</span>
          </button>
          {hasRepo && (
            <div className="branch-chip">
              <IconBranch />
              <span>{branch}</span>
            </div>
          )}
          {status?.git?.upstreamAhead > 0 && (
            <div className="upstream-note">
              <b>↑{status.git.upstreamAhead}</b> upstream ahead
            </div>
          )}
          <div className="topbar-right">
            <div className={`status-pill${isRunning ? " running" : ""}`}>
              <span className="pill-dot" />
              {isRunning ? "Running" : status?.task?.exists ? "Idle" : "Idle · no task"}
            </div>
            <button className="icon-btn" title="Alerts" onClick={() => setView("alerts")}>
              <IconBell />
              {openAlertCount > 0 && <span className="icon-badge">{openAlertCount}</span>}
            </button>
            <button className="icon-btn" title="Toggle theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <div className="avatar">{(machine?.user || "??").replace(/^.*\\/, "").slice(0, 2).toUpperCase()}</div>
          </div>
        </header>

        <div className="content">
          {status && !hasRepo ? (
            <EmptyState title="선택된 저장소가 없습니다">
              모니터링할 로컬 언리얼 엔진 클론 저장소를 등록하세요.
              <div style={{ marginTop: 12 }}>
                <button className="btn accent sm" onClick={() => setRepoModalOpen(true)}>저장소 추가</button>
              </div>
            </EmptyState>
          ) : (
            <>
              {view === "overview" && <OverviewView {...shared} />}
              {view === "pipeline" && <RunPipelineView {...shared} />}
              {view === "deploy" && <DeployView {...shared} />}
              {view === "logs" && <LogsView {...shared} />}
              {view === "alerts" && <AlertsView {...shared} />}
            </>
          )}
        </div>
      </div>

      {repoModalOpen && (
        <RepoModal
          repos={repos}
          activeId={activeRepoId}
          isRunning={isRunning}
          onClose={() => setRepoModalOpen(false)}
          onActivate={activateRepoId}
          onAdd={addRepo}
          onRemove={removeRepoId}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}
