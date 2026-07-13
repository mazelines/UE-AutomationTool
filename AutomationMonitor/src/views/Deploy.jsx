import React, { useEffect, useState } from "react";
import { api, formatDate, formatSize, timeAgo } from "../api.js";
import { Card, EmptyState } from "../components.jsx";
import { IconFolder } from "../icons.jsx";

export default function DeployView({ flash }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState("");
  const inputStyle = {
    width: "100%", border: "1px solid var(--border)", background: "var(--surface)",
    color: "var(--text)", borderRadius: 7, padding: "7px 9px", outline: "none"
  };
  const [browsing, setBrowsing] = useState(false);
  const [browse, setBrowse] = useState({ current: "", parent: null, entries: [], loading: false, error: null });

  async function refresh() {
    try {
      setData(await api("/api/deploy"));
    } catch (error) {
      flash("error", error.message);
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => clearInterval(timer);
  }, []);

  const artifacts = data?.artifacts || [];
  const targets = data?.targets || [];
  const history = data?.history || [];
  const active = data?.active;

  async function deploy(targetId) {
    setBusy(true);
    try {
      const result = await api("/api/deploy/start", { method: "POST", body: JSON.stringify({ targetId }) });
      flash(result.ok ? "info" : "error", result.message || result.error);
      await refresh();
    } catch (error) {
      flash("error", error.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveTargets(next) {
    setData({ ...data, targets: next });
    try {
      const saved = await api("/api/deploy/targets", { method: "POST", body: JSON.stringify(next) });
      setData((current) => ({ ...current, targets: saved }));
    } catch (error) {
      flash("error", error.message);
    }
  }

  function beginEdit(target) {
    setEditingId(target.id);
    setDraft(target.path || "");
  }

  async function commitEdit(target) {
    const next = targets.map((t) => (t.id === target.id ? { ...t, path: draft.trim() } : t));
    setEditingId(null);
    await saveTargets(next);
  }

  async function openBrowser() {
    setBrowsing(true);
    await goBrowse(draft || "");
  }

  async function goBrowse(target) {
    setBrowse((current) => ({ ...current, loading: true, error: null }));
    try {
      const query = target ? `?path=${encodeURIComponent(target)}` : "";
      const res = await api(`/api/browse${query}`);
      setBrowse({ ...res, loading: false, error: null });
    } catch (error) {
      setBrowse((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  function pickBrowse() {
    if (browse.current) setDraft(browse.current);
    setBrowsing(false);
  }

  const lastDeployFor = (targetId) => history.find((entry) => entry.targetId === targetId);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Deploy</h1>
          <p className="page-sub">Promote installed-engine artifacts and distribute to team targets</p>
        </div>
        {active && (
          <div className="status-pill running">
            <span className="pill-dot" />
            Deploying {active.artifactId} → {active.targetName}
          </div>
        )}
      </div>

      <Card title="Installed-Engine Artifacts">
        <div style={{ overflowX: "auto" }}>
          <div className="table-head" style={{ gridTemplateColumns: "16px minmax(220px,1.5fr) 70px 110px 90px 120px 110px", minWidth: 820 }}>
            <span /><span>Artifact</span><span>Label</span><span>Configs</span><span>Size</span><span>Built</span><span />
          </div>
          {artifacts.map((artifact) => (
            <div
              key={artifact.id + artifact.timestamp}
              className="table-row"
              style={{ gridTemplateColumns: "16px minmax(220px,1.5fr) 70px 110px 90px 120px 110px", minWidth: 820, padding: "13px 18px" }}
            >
              <span className={`dot ${artifact.current ? "success" : artifact.ok ? "mute" : "danger"}`} />
              <div style={{ minWidth: 0 }}>
                <div className="cell-mono" style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                  {artifact.id}
                  {artifact.current && <span className="tag-pill accent">CURRENT</span>}
                </div>
                <div className="cell-sub">
                  {artifact.current
                    ? `Ready${artifact.withDDC ? " · DDC included" : " · no DDC"}`
                    : artifact.ok ? "Archived · output 덮어씀" : "Build failed"}
                </div>
              </div>
              <span style={{ fontSize: 12.5 }}>{artifact.label}</span>
              <span className="cell-dim" style={{ fontSize: 11.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{artifact.gameConfigs}</span>
              <span className="cell-mono-dim">{artifact.sizeBytes != null ? formatSize(artifact.sizeBytes) : "—"}</span>
              <span className="cell-dim">{formatDate(artifact.builtAt?.replace(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6"))}</span>
              <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
                {artifact.current && (
                  <button className="btn accent sm" disabled={busy || Boolean(active)} onClick={() => deploy("smb")}>Deploy</button>
                )}
              </div>
            </div>
          ))}
          {artifacts.length === 0 && <EmptyState>빌드 요약이 없습니다 — 첫 설치 빌드 후 표시됩니다.</EmptyState>}
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 18, alignItems: "start", marginTop: 18 }}>
        <Card title="Distribution Targets">
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 11 }}>
            {targets.map((target) => {
              const last = lastDeployFor(target.id);
              const editing = editingId === target.id;
              const noPath = !target.path;
              if (target.real && editing) {
                return (
                  <div key={target.id} style={{ border: "1px solid var(--accent)", borderRadius: 11, padding: "14px 15px", background: "var(--surface-2)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 10 }}>
                      <span className="badge-tile lg">{target.badge}</span>
                      <div style={{ fontSize: 12, color: "var(--text-mute)" }}>배포 경로 입력 · {target.kind}</div>
                    </div>
                    <input
                      value={draft}
                      placeholder="\\\\nas\\share\\UE6 · F:\\UnrealEngine\\Deploy\\UE6"
                      autoFocus
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => { if (event.key === "Enter") commitEdit(target); if (event.key === "Escape") setEditingId(null); }}
                      style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, marginBottom: 9 }}
                    />
                    <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
                      <button className="btn sm" onClick={() => setEditingId(null)}>취소</button>
                      <button className="btn sm" onClick={openBrowser}>찾아보기</button>
                      <button className="btn accent sm" onClick={() => commitEdit(target)}>저장</button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={target.id} style={{ border: "1px solid var(--border)", borderRadius: 11, padding: "14px 15px", background: "var(--surface-2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 10 }}>
                    <span className="badge-tile lg">{target.badge}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {target.real ? (
                        <div className="cell-mono" style={{ fontSize: 12.5, fontWeight: 600, color: noPath ? "var(--text-dim)" : "var(--text)" }}>
                          {target.path || "경로 미지정"}
                        </div>
                      ) : (
                        <div className="cell-mono" style={{ fontSize: 12.5 }}>{target.name}</div>
                      )}
                      <div style={{ fontSize: 11, color: "var(--text-mute)" }}>{target.kind}</div>
                    </div>
                    {last ? (
                      <span className={`tag-pill ${last.ok ? "success" : "warn"}`}>{last.ok ? "Synced" : "Failed"}</span>
                    ) : (
                      <span className="tag-pill mute">{target.real ? "Not synced" : "Stub"}</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                      {last ? <>on <span style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{last.action.replace("Deployed ", "")}</span> · {timeAgo(last.at)}</> : "배포 이력 없음"}
                    </div>
                    {target.real && (
                      <div style={{ display: "flex", gap: 7 }}>
                        <button className="btn tiny" onClick={() => beginEdit(target)}>{target.path ? "경로 변경" : "경로 지정"}</button>
                        <button className="btn tiny" disabled={busy || Boolean(active) || noPath} onClick={() => deploy(target.id)}>{last ? "Re-sync" : "Deploy"}</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Deploy History">
          <div style={{ padding: "16px 18px" }}>
            {history.map((entry, index) => (
              <div key={index} style={{ display: "flex", gap: 13 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span className={`dot lg ${entry.ok ? "success halo" : "warn halo"}`} style={{ marginTop: 3 }} />
                  {index < history.length - 1 && <span style={{ width: 2, flex: 1, background: "var(--border)", margin: "3px 0", minHeight: 16 }} />}
                </div>
                <div style={{ paddingBottom: 16, minWidth: 0 }}>
                  <div style={{ fontSize: 13 }}>
                    <span style={{ fontWeight: 600 }}>{entry.action}</span>{" → "}
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>{entry.target}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-mute)", marginTop: 3, fontFamily: "var(--font-mono)" }}>
                    {formatDate(entry.at)} · by {entry.by}{entry.ok ? "" : ` · robocopy ${entry.robocopyCode}`}
                  </div>
                </div>
              </div>
            ))}
            {history.length === 0 && <EmptyState>배포 이력이 없습니다.</EmptyState>}
          </div>
        </Card>
      </div>

      {browsing && (
        <div className="modal-overlay" onClick={() => setBrowsing(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <b>폴더 찾아보기</b>
              <button className="btn tiny" onClick={() => setBrowsing(false)}>닫기</button>
            </div>
            <div className="modal-path">
              <button className="btn tiny" disabled={!browse.parent} onClick={() => goBrowse(browse.parent)}>↑ 상위</button>
              <span className="cell-mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)" }}>
                {browse.current || "내 PC · 드라이브 목록"}
              </span>
            </div>
            <div className="modal-list">
              {browse.loading && <div className="browse-empty">불러오는 중…</div>}
              {!browse.loading && browse.error && <div className="browse-empty" style={{ color: "var(--danger)" }}>접근 불가: {browse.error}</div>}
              {!browse.loading && !browse.error && browse.entries.length === 0 && <div className="browse-empty">하위 폴더 없음</div>}
              {!browse.loading && !browse.error && browse.entries.map((entry) => (
                <button key={entry.path} className="browse-entry" onClick={() => goBrowse(entry.path)}>
                  <IconFolder />
                  <span>{entry.name}</span>
                </button>
              ))}
            </div>
            <div className="modal-foot">
              <span className="cell-mono" style={{ fontSize: 11.5, color: "var(--text-dim)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                선택 대상: {browse.current || "—"}
              </span>
              <button className="btn accent sm" disabled={!browse.current} onClick={pickBrowse}>이 폴더 선택</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
