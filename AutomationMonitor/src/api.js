export async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

// Accepts ISO strings and PowerShell ConvertTo-Json "/Date(ms)/" values.
export function parseDate(value) {
  if (!value) return null;
  const ms = /\/Date\((\d+)\)\//.exec(String(value));
  const date = ms ? new Date(Number(ms[1])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value) {
  if (!value || String(value).startsWith("0001-")) return "-";
  const date = parseDate(value);
  return date ? date.toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : String(value);
}

export function formatClock(totalSeconds) {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`;
}

export function timeAgo(value) {
  const date = parseDate(value);
  if (!date) return "now";
  const sec = Math.max(0, (Date.now() - date.getTime()) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 172800) return "yesterday";
  return `${Math.floor(sec / 86400)}d ago`;
}

export function formatSize(bytes) {
  if (bytes == null) return "-";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
