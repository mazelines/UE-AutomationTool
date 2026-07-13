import React, { useEffect, useState } from "react";
import { api, timeAgo } from "../api.js";
import { Card, EmptyState } from "../components.jsx";
import { IconCheck } from "../icons.jsx";

const SEV_LABEL = { critical: "Critical", warning: "Warning", info: "Info" };

function buildRules(thresholds) {
  const limits = { diskFreePct: 15, upstreamCommits: 50, buildHours: 6, ...thresholds };
  return [
    { color: "var(--danger)", text: <>On build <strong>failure</strong> → all channels</> },
    { color: "var(--warn)", text: <>Disk free &lt; <strong>{limits.diskFreePct}%</strong> → Slack, Email</> },
    { color: "var(--warn)", text: <>Build runs &gt; <strong>{limits.buildHours}h</strong> → Slack</> },
    { color: "var(--info)", text: <>Upstream &gt; <strong>{limits.upstreamCommits}</strong> commits ahead → Email</> },
    { color: "var(--success)", text: <>Nightly <strong>success</strong> → Slack digest</> }
  ];
}

export default function AlertsView({ status, busy, actions, flash }) {
  const alerts = status?.alerts?.list || [];
  const openCount = status?.alerts?.openCount || 0;
  const [channels, setChannels] = useState(null);

  useEffect(() => {
    api("/api/channels").then(setChannels).catch(() => {});
  }, []);

  async function saveChannels(next) {
    setChannels(next);
    try {
      setChannels(await api("/api/channels", { method: "POST", body: JSON.stringify(next) }));
    } catch (error) {
      flash("error", error.message);
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Alerts &amp; Notifications</h1>
          <p className="page-sub">Incident feed and delivery channels for build failures &amp; health</p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: 18, alignItems: "start" }}>
        <Card
          title="Incident Feed"
          action={<span style={{ fontSize: 12, color: "var(--text-dim)" }}>{openCount} open · {alerts.length - openCount} acknowledged</span>}
        >
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 9 }}>
            {alerts.map((alert) => (
              <div key={alert.id} className={`alert-row${alert.acked ? " acked" : ""}`}>
                <span className={`alert-icon ${alert.sev}`}><span className={`dot ${alert.sev}`} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{alert.title}</span>
                    <span className={`sev-pill ${alert.sev}`}>{SEV_LABEL[alert.sev]}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, marginTop: 3, fontFamily: "var(--font-mono)", wordBreak: "break-word" }}>
                    {alert.detail}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 6 }}>{alert.at ? timeAgo(alert.at) : "ongoing"}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flex: "none" }}>
                  {alert.acked ? (
                    <span className="acked-tag"><IconCheck />Acked</span>
                  ) : (
                    <button className="ack-btn" disabled={busy} onClick={() => actions.ackAlert(alert.id)}>Acknowledge</button>
                  )}
                </div>
              </div>
            ))}
            {alerts.length === 0 && <EmptyState>알림이 없습니다 — 파이프라인이 건강합니다.</EmptyState>}
          </div>
        </Card>

        <div className="col-stack">
          <Card title="Delivery Channels" pad>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {(channels || []).map((channel) => (
                <div key={channel.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 13px", border: "1px solid var(--border)", borderRadius: 11, background: "var(--surface-2)" }}>
                  <span className="badge-tile">{channel.badge}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{channel.name}</div>
                    <input
                      value={channel.target}
                      placeholder="target 미설정"
                      onChange={(event) => setChannels(channels.map((c) => (c.id === channel.id ? { ...c, target: event.target.value } : c)))}
                      onBlur={() => saveChannels(channels)}
                      style={{
                        width: "100%", border: "none", background: "transparent", color: "var(--text-mute)",
                        fontSize: 11, fontFamily: "var(--font-mono)", padding: 0, outline: "none"
                      }}
                    />
                  </div>
                  <button
                    className={`switch${channel.on ? " on" : ""}`}
                    onClick={() => saveChannels(channels.map((c) => (c.id === channel.id ? { ...c, on: !c.on } : c)))}
                  >
                    <span className="knob" />
                  </button>
                </div>
              ))}
              {!channels && <EmptyState>채널 설정을 불러오는 중…</EmptyState>}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 12, lineHeight: 1.5 }}>
              채널은 설정만 저장됩니다 — 실제 발송은 아직 연결되어 있지 않습니다.
            </div>
          </Card>

          <Card title="Trigger Rules" pad>
            <div style={{ display: "flex", flexDirection: "column", gap: 11, fontSize: 12.5 }}>
              {buildRules(status?.alerts?.thresholds).map((rule, index) => (
                <div key={index} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="dot" style={{ width: 8, height: 8, background: rule.color }} />
                  <span>{rule.text}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
