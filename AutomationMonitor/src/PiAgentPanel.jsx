import React, { useEffect, useState } from "react";
import { api } from "./api.js";

const names = { user: "나", zai: "Z.ai · CI/CD 담당", codex: "Codex · 개발 총괄", system: "실행 상태" };
const states = { running: "진행 중", completed: "응답 완료", failed: "실패", cancelled: "중지됨", idle: "대기" };

export default function PiAgentPanel({ status, flash }) {
  const [team, setTeam] = useState({ messages: [] });
  const [message, setMessage] = useState("");
  const [logName, setLogName] = useState("");
  const [allowChanges, setAllowChanges] = useState(false);
  const [pending, setPending] = useState(false);
  const [loadError, setLoadError] = useState("");
  const refresh = async () => {
    const result = await api("/api/pi");
    setTeam(result);
    setLoadError("");
    if (result.id) { setLogName(result.logName || ""); setAllowChanges(result.allowChanges); }
  };
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try { const result = await api("/api/pi"); if (alive) { setTeam(result); setLoadError(""); if (result.id) { setLogName(result.logName || ""); setAllowChanges(result.allowChanges); } } }
      catch (error) { if (alive) setLoadError(error.message); }
    };
    poll();
    const timer = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [status?.repoRoot]);
  const action = async (route, body = {}) => {
    setPending(true);
    try {
      const result = await api(`/api/pi/${route}`, { method: "POST", body: JSON.stringify(body) });
      if (!result.ok) throw new Error(result.error);
      if (route === "message") setMessage("");
      if (route === "reset") { setLogName(""); setAllowChanges(false); }
      await refresh();
    } catch (error) { flash("error", error.message); }
    finally { setPending(false); }
  };
  const busy = pending || team.active;
  const messages = team.messages.filter((entry, i, all) => entry.kind !== "stream" || !all.slice(i + 1).some((next) => next.role === entry.role && next.kind === "message"));
  return (
    <aside className="card pi-panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Mazeline 에이전트</h2>
        <span className="tag-pill">{team.active ? "진행 중" : states[team.status] || "대기"}</span>
      </div>
      <p style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.6 }}>Z.ai가 빌드·배포를 분석하고 Codex가 개발 총괄로 검토합니다.</p>
      {loadError && <div role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>Mazeline 연결 실패: {loadError}</div>}
      <label className="field">
        <span>대상 실행</span>
        <select disabled={busy || Boolean(team.id)} value={logName} onChange={(event) => setLogName(event.target.value)}>
          <option value="">최근 실행</option>
          {(status?.runs || []).slice(0, 20).map((run) => <option key={run.logName} value={run.logName}>{run.id} · {run.result}</option>)}
        </select>
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, margin: "12px 0" }}>
        <input type="checkbox" checked={allowChanges} disabled={busy || Boolean(team.id)} onChange={(event) => setAllowChanges(event.target.checked)} />
        로컬 파일 수정·명령 실행 허용
      </label>
      <div className="pi-response" role="log" aria-label="Mazeline 대화 및 실행 결과">
        {!messages.length && <p style={{ color: "var(--text-mute)", fontSize: 12 }}>빌드 로그를 확인하거나 수정 방향을 요청하세요. 기본 모드는 파일 조회만 허용합니다.</p>}
        {messages.map((entry) => <div key={entry.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{names[entry.role]}{entry.kind === "stream" ? " · 작성 중" : ""}</div>
          {entry.kind === "tool" ? <details><summary>도구 실행 · {entry.text.split(":")[0]}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.text}</pre></details>
            : <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", lineHeight: 1.6, color: entry.kind === "error" ? "var(--danger)" : "var(--text)" }}>{entry.text}</div>}
        </div>)}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); action("message", { message, logName: logName || undefined, allowChanges }); }}>
        <textarea aria-label="Mazeline에 요청" placeholder="이 빌드의 실패 원인을 확인해줘" value={message} maxLength={12000} disabled={busy} onChange={(event) => setMessage(event.target.value)} rows={4} style={{ width: "100%", boxSizing: "border-box", background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)", borderRadius: 8, padding: 10, resize: "vertical" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button className="btn accent sm" disabled={busy || !message.trim() || Boolean(loadError)} type="submit">보내기</button>
          <button className="btn sm" disabled={!team.active || pending} type="button" onClick={() => action("stop")}>중지</button>
          <button className="btn sm" disabled={busy} type="button" onClick={() => action("reset")}>새 대화</button>
        </div>
      </form>
      <p style={{ fontSize: 11, color: "var(--text-mute)", marginBottom: 0 }}>응답 완료는 전체 빌드 성공을 의미하지 않습니다. 대화는 서버 재시작 시 초기화됩니다.</p>
    </aside>
  );
}
