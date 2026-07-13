// Alert generation rules (delivery channels are config-only; nothing is sent).
// Thresholds come from workspace.json (alerts.thresholds).
export function computeAlerts({ runs = [], disk, upstreamAhead, upstreamRef, pipeline, acked = {}, thresholds }) {
  const limits = { diskFreePct: 15, upstreamCommits: 50, buildHours: 6, ...thresholds };
  const alerts = [];
  let successIncluded = false;

  for (const run of runs.filter((r) => r.result !== "running").slice(0, 10)) {
    const at = run.endedAt || run.startedAt;
    if (run.result === "failed") {
      alerts.push({ id: `run-failed-${run.id}`, sev: "critical", title: "Build failed", detail: `#${run.id} · ${run.reason}`, at });
    } else if (run.result === "aborted") {
      alerts.push({ id: `run-aborted-${run.id}`, sev: "warning", title: "Run aborted", detail: `#${run.id} · ${run.reason}`, at });
    } else if (run.result === "success" && !successIncluded) {
      successIncluded = true;
      alerts.push({ id: `run-ok-${run.id}`, sev: "info", title: `${run.mode === "Nightly" ? "Nightly" : "Manual"} build succeeded`, detail: `#${run.id} · ${run.reason}`, at });
    }
  }

  const freePct = disk?.totalBytes ? (disk.freeBytes / disk.totalBytes) * 100 : null;
  if (freePct !== null && freePct < limits.diskFreePct) {
    alerts.push({
      id: "disk-low",
      sev: "warning",
      title: `Disk space below ${limits.diskFreePct}%`,
      detail: `${disk.drive} ${(disk.freeBytes / 1024 ** 4).toFixed(2)} TB free of ${(disk.totalBytes / 1024 ** 4).toFixed(2)} TB`,
      at: null
    });
  }

  if (Number.isFinite(upstreamAhead) && upstreamAhead > limits.upstreamCommits) {
    alerts.push({
      id: "upstream-behind",
      sev: "info",
      title: `Upstream ${upstreamAhead} commits ahead`,
      detail: upstreamRef || "upstream",
      at: null
    });
  }

  if (pipeline?.result === "running" && pipeline.startedAt && Date.now() - new Date(pipeline.startedAt).getTime() > limits.buildHours * 3600 * 1000) {
    alerts.push({
      id: `run-long-${pipeline.buildId}`,
      sev: "warning",
      title: `Build running longer than ${limits.buildHours}h`,
      detail: `#${pipeline.buildId} · started ${pipeline.startedAt}`,
      at: pipeline.startedAt
    });
  }

  // Ambient (undated) conditions first, then newest first.
  alerts.sort((a, b) => String(b.at || "9999").localeCompare(String(a.at || "9999")));
  return alerts.slice(0, 20).map((alert) => ({
    ...alert,
    acked: Boolean(acked[alert.id]),
    ackedAt: acked[alert.id] || null
  }));
}
