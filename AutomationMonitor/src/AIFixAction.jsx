import React, { useEffect, useState } from "react";
import { api, formatDate } from "./api.js";

const labels = { preparing: "해결 준비 중", running: "AI가 직접 해결 중...", resolved: "해결 완료", blocked: "사용자 조치 필요", failed: "해결 실패", interrupted: "작업 추적 중단" };

export default function AIFixAction({ run, status, flash }) {
  const [starting, setStarting] = useState(false);
  const [localJob, setLocalJob] = useState(null);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog] = useState("");
  const fixes = status?.ai?.fixes || {};
  const job = fixes.history?.find((entry) => entry.logName === run.logName && (!localJob || entry.startedAt >= localJob.startedAt)) || localJob;
  const active = Boolean(fixes.active || job?.status === "running" || job?.status === "preparing");
  const busy = starting || active || Boolean(status?.activeRun) || status?.task?.state === "Running";
  useEffect(() => {
    if (!showLog || !job?.id) return;
    let disposed = false;
    async function refresh() {
      try {
        const result = await api(`/api/ai/fix/log?id=${encodeURIComponent(job.id)}`);
        if (!disposed) setLog(result.text);
      } catch (error) { if (!disposed) setLog(error.message); }
    }
    refresh();
    const timer = active ? setInterval(refresh, 3000) : null;
    return () => { disposed = true; if (timer) clearInterval(timer); };
  }, [showLog, job?.id, active]);
  async function start() {
    setStarting(true);
    try {
      const result = await api("/api/ai/fix", { method: "POST", body: JSON.stringify({ logName: run.logName }) });
      if (!result.ok) throw new Error(result.error);
      setLocalJob(result.job);
      setShowLog(true);
      flash("info", result.message);
    } catch (error) { flash("error", error.message); }
    finally { setStarting(false); }
  }
  return (
    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <button className="btn accent sm" disabled={busy} onClick={start}>{starting ? "시작 중..." : job?.status === "running" ? "직접 해결 중..." : "직접 해결"}</button>
        {job && <><span style={{ fontSize: 12 }}>{labels[job.status] || job.status} · {formatDate(job.finishedAt || job.startedAt)}</span><button className="btn tiny" onClick={() => setShowLog(!showLog)}>{showLog ? "로그 닫기" : "실행 로그"}</button></>}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 6 }}>AI가 로컬 파일·설정을 수정하고 실패 원인을 검증합니다.</div>
      {job?.error && <div style={{ marginTop: 8, color: "var(--danger)", fontSize: 12 }}>{job.error}</div>}
      {job?.report && <div style={{ fontSize: 12, lineHeight: 1.5, marginTop: 8, overflowWrap: "anywhere" }}>
        <div style={{ fontWeight: 600 }}>{job.report.summary}</div>
        {Array.isArray(job.report.changedFiles) && job.report.changedFiles.length > 0 && <div><b>수정 파일:</b> {job.report.changedFiles.join(", ")}</div>}
        {Array.isArray(job.report.verification) && job.report.verification.length > 0 && <div><b>검증:</b> {job.report.verification.join(" · ")}</div>}
        {Array.isArray(job.report.nextSteps) && job.report.nextSteps.length > 0 && <div><b>다음 조치:</b> {job.report.nextSteps.join(" · ")}</div>}
      </div>}
      {showLog && <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 260, overflowY: "auto", fontSize: 11, background: "var(--surface-2)", padding: 10 }}>{log || "실행 로그 준비 중..."}</pre>}
    </div>
  );
}
