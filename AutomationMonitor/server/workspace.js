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
  // noDdc defaults to true while the upstream FAmbientCubemapCompositePS/InstancedView
  // regression keeps the DDC fill step failing on the VR template (2026-07-13).
  noDdc: true,
  allowMergeCommit: true
};

export const DEFAULT_THRESHOLDS = { diskFreePct: 15, upstreamCommits: 50, buildHours: 6 };

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
      alerts: { channels: defaultChannels(hostname), thresholds: { ...DEFAULT_THRESHOLDS } }
    };
    try {
      workspace.build = parseIni(await fs.readFile(iniPath, "utf8"));
    } catch {}
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

  return { load, save };
}
