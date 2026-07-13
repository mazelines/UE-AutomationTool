export const STAGE_SHORT = {
  "Validate repository state": "Validate",
  "Configure upstream remote": "Upstream",
  "Fetch origin and upstream": "Fetch",
  "Checkout build branch": "Checkout",
  "Merge upstream into local branch": "Merge",
  "Push synced branch to fork origin": "Push",
  "Sync Unreal dependencies": "Sync deps",
  "Generate project files": "Gen files",
  "Install build pre-processing": "Pre-proc",
  "Build Win64 installed engine": "Build Win64",
  "Install build post-processing": "Post-proc"
};

export function formatDur(seconds) {
  if (seconds == null) return "—";
  const sec = Math.max(0, Math.round(seconds));
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m ${String(sec % 60).padStart(2, "0")}s`;
}

export function runDotClass(result) {
  if (result === "success") return "success";
  if (result === "failed") return "danger";
  if (result === "aborted") return "warn";
  if (result === "running") return "accent pulse";
  return "mute";
}

export function summarizeRuns(runs, days = 7) {
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const window = (runs || []).filter(
    (run) => run.startedAt && new Date(run.startedAt).getTime() >= cutoff && run.result !== "running"
  );
  const ok = window.filter((run) => run.result === "success");
  const failed = window.filter((run) => run.result === "failed");
  const avgSeconds = ok.length
    ? ok.reduce((sum, run) => sum + (run.durationSeconds || 0), 0) / ok.length
    : null;
  return {
    total: window.length,
    ok: ok.length,
    failed: failed.length,
    aborted: window.length - ok.length - failed.length,
    successRate: window.length ? Math.round((ok.length / window.length) * 100) : null,
    avgSeconds
  };
}
