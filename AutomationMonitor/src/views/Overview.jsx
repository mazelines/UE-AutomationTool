import React, { useEffect, useState } from "react";
import { formatClock, formatDate, parseDate, timeAgo } from "../api.js";
import { Card, EmptyState, RunButtons } from "../components.jsx";
import { IconClock } from "../icons.jsx";
import { formatDur, runDotClass, summarizeRuns } from "../pipeline.js";

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function nextNightlyLabel(task) {
  const next = parseDate(task?.nextRunTime);
  if (!next) return { value: "--:--", sub: "작업 미등록" };
  const diffMin = Math.max(0, Math.round((next.getTime() - Date.now()) / 60000));
  const rel = diffMin >= 60 ? `in ${Math.floor(diffMin / 60)}h ${String(diffMin % 60).padStart(2, "0")}m` : `in ${diffMin}m`;
  return { value: next.toTimeString().slice(0, 5), sub: `${rel} · task ${task.state === "Ready" ? "armed" : (task.state || "").toLowerCase()}` };
}

function StageRow({ stage, buildProgress }) {
  const { name, status, seconds } = stage;
  const isBuild = name === "Build Win64 installed engine";
  const pct = isBuild && buildProgress?.total ? Math.round((buildProgress.done / buildProgress.total) * 100) : null;
  const dotClass = status === "skipped" ? "pending" : status;
  return (
    <div className="stage-row">
      <span className={`stage-dot ${dotClass}`} />
      <span className={`stage-name-cell ${status}`}>{name}{status === "skipped" ? " · skipped" : ""}</span>
      {status === "active" && pct !== null && (
        <span className="stage-mini-track"><span className="stage-mini-bar" style={{ width: `${pct}%` }} /></span>
      )}
      <span className="stage-dur">{status === "active" && pct !== null ? `${pct}%` : formatDur(seconds)}</span>
    </div>
  );
}

export default function OverviewView({ status, isRunning, busy, actions, setView }) {
  const branch = status?.git?.branch || "-";
  const task = status?.task;
  const pipeline = status?.pipeline;
  const runs = status?.runs || [];
  const disk = status?.disk;
  const running = pipeline?.result === "running";
  const now = useNow(running);

  const stats = summarizeRuns(runs);
  const nightly = nextNightlyLabel(task);

  const elapsedSeconds = running && pipeline?.startedAt
    ? Math.max(0, (now - new Date(pipeline.startedAt).getTime()) / 1000)
    : pipeline?.durationSeconds || 0;
  const etaSeconds = running && stats.avgSeconds ? Math.max(0, stats.avgSeconds - elapsedSeconds) : null;

  const freePct = disk?.totalBytes ? Math.round((disk.freeBytes / disk.totalBytes) * 100) : null;
  const rateColor = stats.successRate == null ? undefined : stats.successRate >= 80 ? "var(--success)" : stats.successRate >= 50 ? "var(--warn)" : "var(--danger)";

  const runTitle = running
    ? "Sync & Build — in progress"
    : pipeline?.result === "success"
      ? "Build complete"
      : pipeline?.result === "aborted"
        ? "Last run aborted"
        : pipeline
          ? "Last run failed"
          : "No runs yet";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="page-sub">Nightly upstream sync &amp; installed-engine build · {branch}</p>
        </div>
        <RunButtons isRunning={isRunning} busy={busy} actions={actions} />
      </div>

      <div className="kpi-strip">
        <div className="kpi">
          <div className="section-label">Pipeline</div>
          <div className="kpi-status">
            <span className={`dot lg ${isRunning ? "success halo pulse" : pipeline?.result === "success" ? "success halo" : "danger halo"}`} />
            <span>{isRunning ? "Running" : "Idle"}</span>
          </div>
          <div className="kpi-sub">
            {running && pipeline?.currentStage != null
              ? `Stage ${pipeline.currentStage + 1} of 11`
              : pipeline
                ? `Last run ${pipeline.result} · #${pipeline.buildId}`
                : "런 기록 없음"}
          </div>
        </div>
        <div className="kpi">
          <div className="section-label">Success rate · 7d</div>
          <div className="kpi-value">{stats.successRate == null ? "—" : <>{stats.successRate}<small>%</small></>}</div>
          <div className="kpi-track">
            <div style={{ width: `${stats.successRate || 0}%`, background: rateColor }} />
          </div>
        </div>
        <div className="kpi">
          <div className="section-label">Avg build · 7d</div>
          <div className="kpi-value">
            {stats.avgSeconds == null ? "—" : (() => {
              const h = Math.floor(stats.avgSeconds / 3600);
              const m = Math.round((stats.avgSeconds % 3600) / 60);
              return h > 0 ? <>{h}<small>h</small> {String(m).padStart(2, "0")}<small>m</small></> : <>{m}<small>m</small></>;
            })()}
          </div>
          <div className="kpi-sub">{stats.total} runs · {stats.ok} ok / {stats.failed} failed</div>
        </div>
        <div className="kpi">
          <div className="section-label">Next nightly</div>
          <div className="kpi-value mono">{nightly.value}</div>
          <div className="kpi-sub">{nightly.sub}</div>
        </div>
        <div className="kpi">
          <div className="section-label">Output · disk</div>
          <div className="kpi-value">
            {disk?.outputBytes == null ? "—" : <>{Math.round(disk.outputBytes / 1024 ** 3)}<small> GB</small></>}
          </div>
          <div className={`kpi-sub${freePct !== null && freePct < 15 ? " warn" : ""}`}>
            {disk?.freeBytes != null
              ? `${disk.drive} ${(disk.freeBytes / 1024 ** 4).toFixed(1)} TB free · ${freePct}%`
              : "디스크 정보 없음"}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="col-stack">
          <Card
            title={
              <>
                <span className={`dot lg ${running ? "success halo pulse" : pipeline?.result === "success" ? "success halo" : "danger halo"}`} />
                <div>
                  <div>{runTitle}</div>
                  {pipeline && <div className="run-head-id">#{pipeline.buildId} · {pipeline.mode} · {pipeline.branch || branch}</div>}
                </div>
              </>
            }
            action={
              pipeline && (
                <div style={{ textAlign: "right" }}>
                  <div className="run-clock">{formatClock(elapsedSeconds)}</div>
                  <div className="run-eta">
                    {running ? (etaSeconds != null ? `ETA ${formatDur(etaSeconds)} remaining` : "ETA —") : pipeline.result === "success" ? "finished" : "stopped"}
                  </div>
                </div>
              )
            }
          >
            {pipeline ? (
              <>
                <div className="overall-wrap">
                  <div className="overall-meta">
                    <span>
                      Stage {pipeline.currentStage != null ? pipeline.currentStage + 1 : "-"} / 11 ·{" "}
                      <span className="stage-name">{pipeline.currentStage != null ? pipeline.stages[pipeline.currentStage]?.name : "-"}</span>
                    </span>
                    <span className="pct">{pipeline.overallPct}%</span>
                  </div>
                  <div className="overall-track">
                    <div
                      className={`overall-bar ${running ? "running" : pipeline.result === "success" ? "" : "failed"}`}
                      style={{ width: `${pipeline.overallPct}%`, background: pipeline.result === "success" ? "var(--accent)" : undefined }}
                    />
                  </div>
                  <div className="build-subline">
                    {running && pipeline.buildProgress
                      ? `> [${pipeline.buildProgress.done}/${pipeline.buildProgress.total}] ${pipeline.buildProgress.line}`
                      : running && pipeline.currentStage != null
                        ? `> ${pipeline.stages[pipeline.currentStage]?.name}`
                        : ""}
                  </div>
                </div>
                <div className="stage-list">
                  {pipeline.stages.map((stage) => (
                    <StageRow key={stage.name} stage={stage} buildProgress={pipeline.buildProgress} />
                  ))}
                </div>
              </>
            ) : (
              <EmptyState>아직 실행된 자동화 런이 없습니다.</EmptyState>
            )}
          </Card>

          <Card title="Recent Runs" action={<button className="link-btn" onClick={() => setView("logs")}>View logs →</button>}>
            <div className="table-head" style={{ gridTemplateColumns: "20px minmax(0,1.4fr) 1fr 90px 80px" }}>
              <span /><span>Build</span><span>Result</span><span>Duration</span><span>Mode</span>
            </div>
            {runs.slice(0, 6).map((run) => (
              <div key={run.id} className="table-row" style={{ gridTemplateColumns: "20px minmax(0,1.4fr) 1fr 90px 80px", cursor: "pointer" }} onClick={() => setView("logs")}>
                <span className={`dot ${runDotClass(run.result)}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="cell-mono">{run.id}</div>
                  <div className="cell-sub">{formatDate(run.startedAt)}</div>
                </div>
                <span style={{ fontSize: 12.5, color: run.result === "failed" ? "var(--danger)" : run.result === "aborted" ? "var(--warn)" : "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {run.reason}
                </span>
                <span className="cell-mono-dim">{formatDur(run.durationSeconds)}</span>
                <span className="cell-dim">{run.mode}</span>
              </div>
            ))}
            {runs.length === 0 && <EmptyState>런 기록이 없습니다.</EmptyState>}
          </Card>
        </div>

        <div className="col-stack">
          <Card
            title={
              <>
                Active Alerts
                {(status?.alerts?.openCount || 0) > 0 && <span className="count-badge">{status.alerts.openCount}</span>}
              </>
            }
            action={<button className="link-btn" onClick={() => setView("alerts")}>All →</button>}
          >
            <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {(status?.alerts?.list || []).filter((a) => !a.acked).slice(0, 3).map((alert) => (
                <div key={alert.id} style={{ display: "flex", gap: 11, padding: "11px 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}>
                  <span className={`alert-icon ${alert.sev}`}><span className={`dot ${alert.sev}`} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{alert.title}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.45, marginTop: 2, wordBreak: "break-word" }}>{alert.detail}</div>
                    <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 5 }}>{alert.at ? timeAgo(alert.at) : "ongoing"}</div>
                  </div>
                  <button className="ack-btn" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => actions.ackAlert(alert.id)}>Ack</button>
                </div>
              ))}
              {(status?.alerts?.list || []).filter((a) => !a.acked).length === 0 && (
                <div className="empty-state" style={{ padding: 20 }}>No active alerts</div>
              )}
            </div>
          </Card>

          <Card title="Scheduled Task" pad>
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-2)" }}>
              <IconClock stroke={task?.exists ? "var(--success)" : "var(--text-mute)"} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Nightly · 02:00</div>
                <div style={{ fontSize: 11.5, color: "var(--text-dim)" }}>UE6 Nightly Upstream Sync</div>
              </div>
              <span className={`tag-pill ${task?.exists ? "success" : "mute"}`}>{task?.exists ? "ARMED" : "NONE"}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 13, fontSize: 12 }}>
              <div>
                <div style={{ color: "var(--text-mute)", marginBottom: 3 }}>Last run</div>
                <div style={{ fontWeight: 600 }}>{formatDate(task?.lastRunTime)}</div>
              </div>
              <div>
                <div style={{ color: "var(--text-mute)", marginBottom: 3 }}>Next run</div>
                <div style={{ fontWeight: 600 }}>{formatDate(task?.nextRunTime)}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 15 }}>
              <button className="btn" style={{ height: 36, fontSize: 12.5 }} disabled={busy} onClick={actions.register}>Register Task</button>
              <button className="btn" style={{ height: 36, fontSize: 12.5 }} disabled={busy || !task?.exists} onClick={actions.startTask}>Start Task</button>
            </div>
          </Card>

          <Card title="Repository" pad>
            <div className="kv-list">
              <div className="kv-row"><span className="k">Branch</span><span className="v">{branch}</span></div>
              <div className="kv-row"><span className="k">Head</span><span className="v">{status?.git?.head || "-"}</span></div>
              <div className="kv-row">
                <span className="k">Upstream</span>
                <span className="v" style={{ fontSize: 11.5 }}>{status?.git?.upstreamRef || "—"}</span>
              </div>
              <div className="kv-row">
                <span className="k">Sync state</span>
                {status?.git?.upstreamSyncDisabled ? (
                  <span className="v plain" style={{ color: "var(--text-dim)", fontWeight: 600 }}>Sync disabled</span>
                ) : (
                  <span className="v plain" style={{ color: status?.git?.upstreamAhead > 0 ? "var(--info)" : "var(--success)", fontWeight: 600 }}>
                    {status?.git?.upstreamAhead == null
                      ? "—"
                      : status.git.upstreamAhead > 0
                        ? `${status.git.upstreamAhead} commits behind upstream`
                        : "Up to date with upstream"}
                  </span>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
