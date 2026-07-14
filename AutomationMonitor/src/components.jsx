import React, { useEffect, useState } from "react";
import { IconPlay, IconStop, IconFolder } from "./icons.jsx";
import { api } from "./api.js";

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <span className="hint">({hint})</span>}
      </span>
      {children}
    </label>
  );
}

export function CheckTile({ label, caption, checked, onChange, compact = false }) {
  return (
    <label className={`check-tile${compact ? " compact" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <div>
        <div className="ct-label">{label}</div>
        {caption && <div className="ct-caption">{caption}</div>}
      </div>
    </label>
  );
}

export function Card({ title, badge, action, children, pad = false, clip = true }) {
  return (
    <div className={`card${clip ? " clip" : ""}`}>
      {title && (
        <div className="card-head">
          <div className="card-title">
            {title}
            {badge}
          </div>
          {action}
        </div>
      )}
      {pad ? <div className="card-pad">{children}</div> : children}
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  const dotClass = { success: "success", info: "accent", warning: "warn", error: "danger" }[toast.kind] || "accent";
  return (
    <div className="toast">
      <span className={`dot ${dotClass}`} />
      <span className="toast-msg">{toast.msg}</span>
    </div>
  );
}

export function RunButtons({ isRunning, busy, actions }) {
  return (
    <div className="head-actions">
      {isRunning && (
        <button className="btn danger" disabled={busy} onClick={actions.stop}>
          <IconStop />
          Stop Run
        </button>
      )}
      <button className="btn" disabled={busy || isRunning} onClick={actions.runNoClean}>
        Run (NoClean)
      </button>
      <button className="btn accent" disabled={busy || isRunning} onClick={actions.runClean}>
        <IconPlay />
        Run (Clean)
      </button>
    </div>
  );
}

// Server-side folder browser modal, backed by GET /api/browse. Shared by the deploy
// target path picker and the local repo-clone picker.
export function DirPicker({ initial, onPick, onClose }) {
  const [browse, setBrowse] = useState({ current: "", parent: null, entries: [], loading: true, error: null });

  async function goBrowse(target) {
    setBrowse((current) => ({ ...current, loading: true, error: null }));
    try {
      const query = target ? `?path=${encodeURIComponent(target)}` : "";
      setBrowse({ ...(await api(`/api/browse${query}`)), loading: false, error: null });
    } catch (error) {
      setBrowse((current) => ({ ...current, loading: false, error: error.message }));
    }
  }

  useEffect(() => { goBrowse(initial || ""); }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <b>폴더 찾아보기</b>
          <button className="btn tiny" onClick={onClose}>닫기</button>
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
          <button className="btn accent sm" disabled={!browse.current} onClick={() => onPick(browse.current)}>이 폴더 선택</button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}
