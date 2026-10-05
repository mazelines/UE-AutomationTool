import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";

// Single source of truth for every monitor/build setting for one selected repo, stored at
// <repo>/LocalBuilds/AutomationMonitor/workspace.json (see index.js activateRepo).
// Pure machine state (alert acks, deploy history) stays in monitor-state.json.

export const DEFAULT_RUN_OPTIONS = {
  builtDirectory: "",
  at: "02:00",
  skipSetup: false,
  skipGenerateProjectFiles: false,
  // Skip the upstream fetch/merge entirely and build the fork branch as-is.
  skipUpstreamSync: false,
  skipPushOrigin: false,
  // DDC generation stays on by default — a typical installed build ships a compiled DDC
  // for engine content/templates (InstalledEngineBuild.xml WithDDC default). If an
  // upstream shader regression breaks the DDC fill step again (last seen 2026-07-13,
  // AmbientCubemapComposite/InstancedView on the VR template), use the Run Options
  // "No DDC" toggle for that run instead of silently building without one.
  noDdc: false,
  allowMergeCommit: true
};

export const DEFAULT_THRESHOLDS = { diskFreePct: 15, upstreamCommits: 50, buildHours: 6 };

// AI provider configuration defaults. Codex CLI uses the locally installed `codex` CLI
// and reuses its existing ChatGPT OAuth session (no API key required). Other providers
// are OpenAI-compatible and require an API key and base URL.
export const DEFAULT_AI_PROVIDERS = {
  codex: {
    id: "codex",
    name: "Codex CLI",
    kind: "codex-cli",
    enabled: true,
    // Path to the codex executable. Empty means auto-detect from PATH.
    cliPath: "",
    // Model passed as `--model <id>`. Empty means the CLI's own default
    // (the `model` key in ~/.codex/config.toml).
    model: "",
    modelHint: "gpt-6-astra",
    // Non-interactive flags used when invoking Codex CLI for diagnosis. The read-only
    // sandbox keeps log analysis side-effect free; --ephemeral avoids persisting a
    // session file for every monitor diagnosis.
    flags: ["--skip-git-repo-check", "--ephemeral", "--color", "never", "--sandbox", "read-only"]
  },
  zai: {
    id: "zai",
    name: "Z.AI International",
    kind: "openai-compatible",
    enabled: false,
    apiKey: "",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    model: "",
    modelHint: "glm-4.7"
  }
};

export const DEFAULT_AI_CONFIG = {
  version: 1,
  // Auto-run AI diagnosis when a build fails.
  autoDiagnose: false,
  // Max tokens per provider call (approx budget cap). Long logs are truncated to fit.
  maxTokens: 120000,
  // Primary and secondary provider IDs. Secondary is used when primary fails.
  primaryProviderId: "codex",
  secondaryProviderId: "",
  // Stored AI diagnoses keyed by run log name.
  diagnostics: {}
};

// Defaults for the "Install Build Config" form (RunPipeline.jsx). Mirror the fallbacks already
// used in server/deploy.js and index.js so values stay consistent. Build-target toggles match
// InstalledEngineBuild.xml's sane defaults: a full host-platform build (not editor-only) with
// DDC generation and no client/server targets. Run/Source/Version/Distribution stay user/INI-owned.
export const DEFAULT_BUILD_CONFIG = {
  Paths: { OutputDirectory: "LocalBuilds\\Engine", LogDirectory: "LocalBuilds\\Logs" },
  Build: {
    TargetPlatform: "Win64",
    GameConfigurations: "Shipping;Development",
    HostPlatformEditorOnly: "false",
    WithDDC: "true",
    WithClient: "false",
    WithServer: "false"
  },
  PostBuild: { WaitTimeout: "10" },
  Logging: { Verbose: "true", LogRetentionDays: "30" }
};

// Fill empty build-config keys with defaults without clobbering user values. Mutates ws.build.
function applyBuildDefaults(ws) {
  ws.build = ws.build || {};
  for (const [section, keys] of Object.entries(DEFAULT_BUILD_CONFIG)) {
    ws.build[section] = { ...ws.build[section] };
    for (const [key, value] of Object.entries(keys)) {
      if (ws.build[section][key] === undefined || ws.build[section][key] === "") {
        ws.build[section][key] = value;
      }
    }
  }
  return ws;
}

// Fill empty AI config/provider keys without clobbering user values. Mutates ws.ai.
function applyAiDefaults(ws) {
  ws.ai = ws.ai ? { ...DEFAULT_AI_CONFIG, ...ws.ai } : { ...DEFAULT_AI_CONFIG };
  ws.ai.providers = ws.ai.providers ? { ...ws.ai.providers } : {};
  for (const [id, defaults] of Object.entries(DEFAULT_AI_PROVIDERS)) {
    const user = ws.ai.providers[id] || {};
    ws.ai.providers[id] = { ...defaults, ...user };
    // Ensure all default keys exist even if user partially saved the object.
    for (const key of Object.keys(defaults)) {
      if (ws.ai.providers[id][key] === undefined) ws.ai.providers[id][key] = defaults[key];
    }
  }
  // Drop providers removed from the registry (e.g. modelark, kimi, claude) out of saved
  // workspaces so they never enter the diagnosis order, and reset dangling primary/secondary picks.
  for (const id of Object.keys(ws.ai.providers)) {
    if (!DEFAULT_AI_PROVIDERS[id]) delete ws.ai.providers[id];
  }
  if (ws.ai.primaryProviderId && !ws.ai.providers[ws.ai.primaryProviderId]) {
    ws.ai.primaryProviderId = DEFAULT_AI_CONFIG.primaryProviderId;
  }
  if (ws.ai.secondaryProviderId && !ws.ai.providers[ws.ai.secondaryProviderId]) {
    ws.ai.secondaryProviderId = "";
  }
  return ws;
}

// Horde is not used in this pipeline (user decision 2026-07-13); P4 stays a visible stub until configured.
function defaultChannels(hostname) {
  return [
    { id: "slack", badge: "SL", name: "Slack #ue6-builds", target: "", on: false },
    { id: "email", badge: "@", name: "Email · engine-team", target: "", on: false },
    { id: "toast", badge: "WN", name: "Windows Toast", target: `${hostname} local session`, on: false }
  ];
}

function defaultTargets() {
  return [
    { id: "gdrive", badge: "GD", kind: "Google Drive · desktop sync folder", name: "Google Drive", path: "", real: true },
    { id: "smb", badge: "SMB", kind: "SMB share · team-wide", name: "", path: "", real: true },
    { id: "p4", badge: "P4", kind: "Perforce depot · stub", name: "//depot/UE6/InstalledBuild", path: "", real: false }
  ];
}

const dropHorde = (items) => items.filter((item) => item.id !== "horde");

function parseIni(text) {
  const result = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(";") || line.startsWith("#")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { section = sec[1]; result[section] = {}; continue; }
    const kv = line.match(/^([^=]+)=(.*)$/);
    if (kv && section) result[section][kv[1].trim()] = kv[2].trim();
  }
  return result;
}

export function createWorkspace({ filePath, iniPath, statePath, hostname }) {
  let cache = null;
  let cacheMtime = 0;

  // First run migrates from install_build_config.ini + monitor-state.json.
  async function migrate() {
    const workspace = {
      version: 1,
      build: {},
      runOptions: { ...DEFAULT_RUN_OPTIONS },
      deploy: { targets: defaultTargets(), auto: { enabled: false, targetId: "smb" }, format: "7z" },
      alerts: { channels: defaultChannels(hostname), thresholds: { ...DEFAULT_THRESHOLDS } },
      ai: { ...DEFAULT_AI_CONFIG, providers: structuredClone(DEFAULT_AI_PROVIDERS) }
    };
    try {
      workspace.build = parseIni(await fs.readFile(iniPath, "utf8"));
    } catch {}
    applyBuildDefaults(workspace);
    applyAiDefaults(workspace);
    try {
      const state = JSON.parse(await fs.readFile(statePath, "utf8"));
      if (Array.isArray(state.channels) && state.channels.length) workspace.alerts.channels = dropHorde(state.channels);
      if (Array.isArray(state.deployTargets) && state.deployTargets.length) workspace.deploy.targets = dropHorde(state.deployTargets);
    } catch {}
    return workspace;
  }

  // Reload when the file changes on disk (git pull, manual edit).
  async function load() {
    let stat = null;
    try { stat = fssync.statSync(filePath); } catch {}
    if (cache && stat && stat.mtimeMs === cacheMtime) return cache;
    if (stat) {
      cache = JSON.parse(await fs.readFile(filePath, "utf8"));
      applyBuildDefaults(cache);
      applyAiDefaults(cache);
      cache.deploy = cache.deploy || {};
      cache.deploy.targets = cache.deploy.targets || defaultTargets();
      if (!cache.deploy.targets.some((target) => target.id === "gdrive")) {
        cache.deploy.targets.push(defaultTargets().find((target) => target.id === "gdrive"));
      }
      cache.deploy.targets.find((target) => target.id === "gdrive").kind = "Google Drive · desktop sync folder";
      cacheMtime = stat.mtimeMs;
      return cache;
    }
    cache = await migrate();
    await save();
    return cache;
  }

  async function save() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(cache, null, 2) + "\n", "utf8");
    try { cacheMtime = fssync.statSync(filePath).mtimeMs; } catch {}
  }

  return { load, save, applyAiDefaults };
}
