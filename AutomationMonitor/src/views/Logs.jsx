import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, formatDate, formatSize } from "../api.js";
import { IconDownload } from "../icons.jsx";
import { runDotClass } from "../pipeline.js";

function classifyLine(text) {
  if (/\bERROR\b|\bFAIL\b|exited with code [1-9]|UnrealBuildTool failed|fatal:/i.test(text)) return "danger";
  if (/\bDONE\b|SUCCESS/i.test(text)) return "success";
  if (/\bSTART\b|requested/i.test(text)) return "info";
  if (/^\*{3}|^시작|^Repository|^Upstream|^Installed|Build output|^Ignoring/i.test(text)) return "mute";
  return "";
}

export default function LogsView({ status }) {
  const logs = status?.logs || [];
  const runs = status?.runs || [];
  const resultByLog = useMemo(() => {
    const map = new Map();
    for (const run of runs) {
      map.set(run.logName, run.result);
      if (run.buildLogName) map.set(run.buildLogName, run.result);
    }
    return map;
  }, [runs]);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("all");
  const [logText, setLogText] = useState("");
  const bodyRef = useRef(null);
  const followTailRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const effectiveLog = selected || logs[0]?.name || "";

  async function refreshLog(name = effectiveLog) {
    if (!name) return setLogText("");
    try {
      setLogText(await api(`/api/logs/${encodeURIComponent(name)}?lines=400`));
    } catch {}
  }

  useEffect(() => {
    refreshLog(effectiveLog);
    const timer = setInterval(() => refreshLog(), 5000);
    return () => clearInterval(timer);
  }, [effectiveLog]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && followTailRef.current) el.scrollTop = el.scrollHeight;
  }, [logText, filter]);

  function handleScroll() {
    const el = bodyRef.current;
    if (!el) return;
    const isBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    followTailRef.current = isBottom;
    setAtBottom(isBottom);
  }

  function jumpToLatest() {
    const el = bodyRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    followTailRef.current = true;
    setAtBottom(true);
  }

  const lines = useMemo(() => {
    let rows = logText.split(/\r?\n/);
    if (filter === "steps") rows = rows.filter((line) => /\bSTART\b|\bDONE\b|\bFAIL\b|SUCCESS/.test(line));
    else if (filter === "errors") rows = rows.filter((line) => /\bERROR\b|\bFAIL\b|exited with code [1-9]|failed/i.test(line));
    return rows.map((text, index) => ({ n: index + 1, text, cls: classifyLine(text) }));
  }, [logText, filter]);

  return (
    <div className="logs-shell">
      <aside className="logfile-aside">
        <div className="logfile-title">Log Files</div>
        {logs.length === 0 && <div className="empty-state">로그 파일이 없습니다.</div>}
        {logs.map((log) => {
          const result = resultByLog.get(log.name);
          return (
            <button
              key={log.name}
              className={`logfile-row${log.name === effectiveLog ? " active" : ""}`}
              onClick={() => setSelected(log.name)}
            >
              <span className={`dot ${result ? runDotClass(result) : "mute"}`} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="logfile-name">{log.name}</div>
                <div className="logfile-meta">
                  {result ? `${result.toUpperCase()} · ` : ""}{formatSize(log.size)} · {formatDate(log.modifiedAt)}
                </div>
              </div>
            </button>
          );
        })}
      </aside>

      <div className="terminal">
        <div className="terminal-bar">
          <span className="terminal-file">{effectiveLog || "로그 없음"}</span>
          <div className="segmented">
            {["all", "steps", "errors"].map((id) => (
              <button key={id} className={filter === id ? "active" : ""} onClick={() => setFilter(id)}>
                {id === "all" ? "All" : id === "steps" ? "Steps" : "Errors"}
              </button>
            ))}
          </div>
          {effectiveLog && (
            <a
              className="btn sm"
              style={{ textDecoration: "none", color: "var(--text-dim)" }}
              href={`/api/logs/${encodeURIComponent(effectiveLog)}/download`}
              download={effectiveLog}
            >
              <IconDownload />
              Download
            </a>
          )}
        </div>
        <div className="terminal-body" ref={bodyRef} onScroll={handleScroll}>
          {lines.map((line) => (
            <div key={line.n} className={`log-line ${line.cls}`}>
              <span className="ln">{line.n}</span>
              <span>{line.text || " "}</span>
            </div>
          ))}
          {!atBottom && <button className="jump-latest" onClick={jumpToLatest}>▼ 최신 로그</button>}
        </div>
      </div>
    </div>
  );
}
