import React from "react";
import { IconPlay, IconStop } from "./icons.jsx";

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

export function EmptyState({ title, children }) {
  return (
    <div className="empty-state">
      {title && <b>{title}</b>}
      {children}
    </div>
  );
}
