import React, { useState } from "react";
import { formatClock } from "../api.js";
import { Card, CheckTile, Field, RunButtons } from "../components.jsx";
import { STAGE_SHORT } from "../pipeline.js";

function PipelineFlow({ pipeline }) {
  if (!pipeline) return null;
  const stages = pipeline.stages;
  const running = pipeline.result === "running";
  return (
    <div className="card" style={{ padding: "18px 20px", marginBottom: 18, overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>Live Pipeline</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--text-dim)" }}>
          {formatClock(pipeline.durationSeconds || 0)} · {pipeline.overallPct}% · #{pipeline.buildId}
        </div>
      </div>
      <div className="flow-wrap">
        {stages.map((stage, index) => {
          const prevStarted = (s) => s && s.status !== "pending";
          const nodeClass =
            stage.status === "done" || stage.status === "skipped" ? "done"
              : stage.status === "active" ? "active"
                : stage.status === "stopped" ? "stopped" : "";
          const leftClass = index === 0 ? "none" : stages[index].status !== "pending" ? "done" : "";
          const rightClass =
            index === stages.length - 1 ? "none" : prevStarted(stages[index + 1]) || stage.status === "done" || stage.status === "skipped" ? "done" : "";
          const labelClass = stage.status === "pending" ? "pending" : stage.status === "stopped" ? "stopped" : "";
          return (
            <div key={stage.name} className="flow-stage">
              <div className="flow-line-row">
                <span className={`flow-line ${leftClass}`} />
                <span className={`flow-node ${nodeClass}`}>
                  {stage.status === "done" || stage.status === "skipped" ? "✓" : stage.status === "stopped" ? "✕" : index + 1}
                </span>
                <span className={`flow-line ${rightClass}`} />
              </div>
              <div className={`flow-label ${labelClass}`}>{STAGE_SHORT[stage.name] || stage.name}</div>
            </div>
          );
        })}
      </div>
      {running && pipeline.buildProgress && (
        <div className="build-subline" style={{ marginTop: 12 }}>
          &gt; [{pipeline.buildProgress.done}/{pipeline.buildProgress.total}] {pipeline.buildProgress.line}
        </div>
      )}
    </div>
  );
}

const SYNC_FLAGS = [
  { key: "skipUpstreamSync", label: "Skip Upstream Sync", caption: "upstream fetch/merge 생략, fork 브랜치 그대로 빌드" },
  { key: "skipSetup", label: "Skip Deps Sync", caption: "GitDependencies 건너뛰기" },
  { key: "skipGenerateProjectFiles", label: "Skip Project Files", caption: "GenerateProjectFiles 건너뛰기" },
  { key: "skipPushOrigin", label: "Skip Push Origin", caption: "fork origin push 생략" },
  { key: "noDdc", label: "No DDC", caption: "WithDDC=false 강제" },
  { key: "allowMergeCommit", label: "Allow Merge Commit", caption: "upstream merge 허용" }
];

const BUILD_TARGETS = [
  { section: "Build", key: "HostPlatformEditorOnly", label: "Editor Only" },
  { section: "Build", key: "WithDDC", label: "With DDC" },
  { section: "Build", key: "WithClient", label: "With Client" },
  { section: "Build", key: "WithServer", label: "With Server" },
  { section: "Logging", key: "Verbose", label: "Verbose Log" }
];

// Dropdown option sets. BuildLabel mirrors DistributionType; TargetPlatform is UE's
// platform enum (this pipeline builds Win64); GameConfigurations are common semicolon
// combos of UnrealTargetConfiguration. The current value is preserved even if off-list.
const BUILD_LABELS = ["Developer", "Artist"];
const TARGET_PLATFORMS = ["Win64", "Linux", "LinuxArm64", "Mac", "Android", "IOS", "TVOS"];
const GAME_CONFIG_PRESETS = [
  "Development",
  "Development;Shipping",
  "DebugGame;Development;Shipping",
  "Debug;DebugGame;Development;Shipping;Test",
  "Shipping",
  "Test"
];

// Options for an enum <select>: placeholder when unset, plus the current value kept
// selectable even if it isn't one of the presets.
function enumOptions(list, current) {
  return (
    <>
      {!current && <option value="">— 선택 —</option>}
      {current && !list.includes(current) && <option value={current}>{current}</option>}
      {list.map((value) => <option key={value} value={value}>{value}</option>)}
    </>
  );
}

export default function RunPipelineView({ status, installConfig, setInstallConfig, upstreamBranches = [], options, setOptions, busy, isRunning, actions }) {
  const [tab, setTab] = useState("options");
  const branches = status?.branches || [];

  const patchOptions = (patch) => setOptions((current) => ({ ...current, ...patch }));
  const patchInstall = (section, key, value) =>
    setInstallConfig((current) => ({ ...current, [section]: { ...current?.[section], [key]: value } }));
  const installValue = (section, key, fallback = "") => installConfig?.[section]?.[key] ?? fallback;
  const installBool = (section, key) => installValue(section, key).toLowerCase() === "true";

  const cfgBranch = installValue("Run", "Branch", "ue6-main");
  const cfgUpstreamRemote = installValue("Run", "UpstreamRemote", "upstream");
  const cfgUpstreamBranch = installValue("Run", "UpstreamBranch", "ue6-main");
  // Branch picker options: locally-fetched upstream refs + heads listed by "Add & Fetch" (ls-remote),
  // with the current value always present so a not-yet-fetched branch stays selectable.
  const upstreamBranchNames = [...new Set([
    cfgUpstreamBranch,
    ...branches.filter((item) => (item.remotes || []).includes(cfgUpstreamRemote)).map((item) => item.name),
    ...upstreamBranches
  ].filter(Boolean))];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Run &amp; Pipeline</h1>
          <p className="page-sub">Configure the sync-and-build automation, then trigger or schedule it</p>
        </div>
        <RunButtons isRunning={isRunning} busy={busy} actions={actions} />
      </div>

      <PipelineFlow pipeline={status?.pipeline} />

      <div className="tabs">
        <button className={`tab${tab === "options" ? " active" : ""}`} onClick={() => setTab("options")}>Run Options</button>
        <button className={`tab${tab === "config" ? " active" : ""}`} onClick={() => setTab("config")}>Install Build Config</button>
      </div>

      {tab === "options" && (
        <div style={{ maxWidth: 820 }}>
          <div className="card" style={{ padding: "20px 22px" }}>
            <div className="field-grid" style={{ marginBottom: 6 }}>
              <Field label="Output Directory" hint="비우면 Config의 OutputDirectory 사용">
                <input
                  placeholder={installValue("Paths", "OutputDirectory", "LocalBuilds\\Engine")}
                  value={options.builtDirectory}
                  onChange={(event) => patchOptions({ builtDirectory: event.target.value })}
                />
              </Field>
              <Field label="Daily Schedule">
                <input value={options.at} onChange={(event) => patchOptions({ at: event.target.value })} />
              </Field>
            </div>
            <div className="section-label" style={{ margin: "16px 0 12px" }}>Sync flags</div>
            <div className="tile-grid-2">
              {SYNC_FLAGS.map(({ key, label, caption }) => (
                <CheckTile
                  key={key}
                  label={label}
                  caption={caption}
                  checked={Boolean(options[key])}
                  onChange={(value) => patchOptions({ [key]: value })}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "config" && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: 18, alignItems: "start" }}>
          <div className="card" style={{ padding: "20px 22px" }}>
            <div className="section-label" style={{ marginBottom: 14 }}>install_build_config.ini</div>
            <div className="field-grid">
              <Field label="Branch">
                <select value={cfgBranch} onChange={(event) => patchInstall("Run", "Branch", event.target.value)}>
                  {!branches.some((item) => item.name === cfgBranch) && <option value={cfgBranch}>{cfgBranch}</option>}
                  {branches.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}{item.hasLocal ? "" : " (remote)"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Distribution">
                <select
                  value={installValue("Distribution", "DistributionType", "Developer")}
                  onChange={(event) => patchInstall("Distribution", "DistributionType", event.target.value)}
                >
                  <option value="Developer">Developer (PDB 유지)</option>
                  <option value="Artist">Artist (PDB 삭제)</option>
                </select>
              </Field>
              <Field label="Engine Version">
                <input value={installValue("Version", "EngineVersion")} onChange={(event) => patchInstall("Version", "EngineVersion", event.target.value)} />
              </Field>
              <Field label="Build Number">
                <input placeholder="AUTO" value={installValue("Version", "BuildNumber")} onChange={(event) => patchInstall("Version", "BuildNumber", event.target.value)} />
              </Field>
              <Field label="Build Label">
                <select value={installValue("Version", "BuildLabel")} onChange={(event) => patchInstall("Version", "BuildLabel", event.target.value)}>
                  {enumOptions(BUILD_LABELS, installValue("Version", "BuildLabel"))}
                </select>
              </Field>
              <Field label="Target Platform">
                <select value={installValue("Build", "TargetPlatform")} onChange={(event) => patchInstall("Build", "TargetPlatform", event.target.value)}>
                  {enumOptions(TARGET_PLATFORMS, installValue("Build", "TargetPlatform"))}
                </select>
              </Field>
              <label className="field span2">
                <span>Game Configurations</span>
                <select value={installValue("Build", "GameConfigurations")} onChange={(event) => patchInstall("Build", "GameConfigurations", event.target.value)}>
                  {enumOptions(GAME_CONFIG_PRESETS, installValue("Build", "GameConfigurations"))}
                </select>
              </label>
            </div>

            <div className="section-label" style={{ margin: "20px 0 12px" }}>Upstream sync</div>
            <div className="field-grid">
              <Field label="Upstream Remote">
                <input
                  placeholder="upstream"
                  value={installValue("Run", "UpstreamRemote")}
                  onChange={(event) => patchInstall("Run", "UpstreamRemote", event.target.value)}
                />
              </Field>
              <Field label="Upstream Branch" hint="fetch·merge 대상 (Add & Fetch 후 목록 확장)">
                <select value={cfgUpstreamBranch} onChange={(event) => patchInstall("Run", "UpstreamBranch", event.target.value)}>
                  {upstreamBranchNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </Field>
              <label className="field span2">
                <span>Upstream URL</span>
                <input
                  placeholder="https://github.com/EpicGames/UnrealEngine.git"
                  value={installValue("Run", "UpstreamUrl")}
                  onChange={(event) => patchInstall("Run", "UpstreamUrl", event.target.value)}
                />
              </label>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              <button
                className="btn"
                disabled={busy || !installValue("Run", "UpstreamUrl", "").trim()}
                onClick={actions.addUpstream}
              >
                Add &amp; Fetch Upstream
              </button>
              <span style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
                remote 등록/갱신 후 브랜치 fetch — 드롭다운·ahead 카운트 즉시 갱신 (Save 불필요)
              </span>
            </div>

            <div className="section-label" style={{ margin: "20px 0 12px" }}>Build targets</div>
            <div className="tile-grid-3">
              {BUILD_TARGETS.map(({ section, key, label }) => (
                <CheckTile
                  key={`${section}.${key}`}
                  compact
                  label={label}
                  checked={installBool(section, key)}
                  onChange={(value) => patchInstall(section, key, value ? "true" : "false")}
                />
              ))}
            </div>

            <div className="field-grid" style={{ marginTop: 18 }}>
              <Field label="Output Directory">
                <input value={installValue("Paths", "OutputDirectory")} onChange={(event) => patchInstall("Paths", "OutputDirectory", event.target.value)} />
              </Field>
              <Field label="Log Directory">
                <input value={installValue("Paths", "LogDirectory")} onChange={(event) => patchInstall("Paths", "LogDirectory", event.target.value)} />
              </Field>
              <Field label="Wait Timeout (s)">
                <input value={installValue("PostBuild", "WaitTimeout")} onChange={(event) => patchInstall("PostBuild", "WaitTimeout", event.target.value)} />
              </Field>
              <Field label="Log Retention (days)">
                <input value={installValue("Logging", "LogRetentionDays")} onChange={(event) => patchInstall("Logging", "LogRetentionDays", event.target.value)} />
              </Field>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
              <button className="btn accent" disabled={busy || !installConfig} onClick={actions.saveConfig}>Save Config</button>
              <button className="btn" disabled={busy} onClick={actions.reloadConfig}>Reload</button>
            </div>
          </div>

          <div className="card" style={{ padding: 18, position: "sticky", top: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 14 }}>Effective Build</div>
            <div className="kv-list">
              <div className="kv-row"><span className="k">Version</span><span className="v">{installValue("Version", "EngineVersion", "-")}-{installValue("Version", "BuildLabel", "-")}</span></div>
              <div className="kv-row"><span className="k">Build #</span><span className="v" style={{ fontWeight: 400 }}>{installValue("Version", "BuildNumber") || "AUTO"}</span></div>
              <div className="kv-row"><span className="k">Platform</span><span className="v" style={{ fontWeight: 400 }}>{installValue("Build", "TargetPlatform", "-")}</span></div>
              <div className="kv-row"><span className="k">Distribution</span><span className="v plain">{installValue("Distribution", "DistributionType", "-")}</span></div>
              <div className="kv-row"><span className="k">Upstream</span><span className="v" style={{ fontWeight: 400, fontSize: 11 }}>{cfgUpstreamRemote}/{cfgUpstreamBranch}</span></div>
              <div className="kv-sep" />
              <div className="kv-row"><span className="k">DDC</span><span className="v plain">{installBool("Build", "WithDDC") ? "Included" : "Excluded"}</span></div>
              <div className="kv-row"><span className="k">Game configs</span><span className="v" style={{ fontWeight: 400, fontSize: 11 }}>{installValue("Build", "GameConfigurations", "-")}</span></div>
            </div>
            <div className="info-note" style={{ marginTop: 15 }}>
              HostPlatformEditorOnly=false → UnrealGame 런타임까지 precompile (게임 패키징 가능)
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
