import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export const INSTALL_ARGS = [
  "install", "--id", "Microsoft.WindowsSDK.10.0.26100", "--exact", "--force",
  "--override", "/features OptionId.WindowsDesktopDebuggers /quiet /norestart",
  "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"
];
const REQUIRED_FILES = ["pdbcopy.exe", "windbg.exe", "cdb.exe", "dbghelp.dll"];

export async function ensureDebuggingTools({
  platform = process.platform,
  root = path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Windows Kits", "10", "Debuggers", "x64"),
  exists = async (file) => fs.access(file).then(() => true, () => false),
  run = (command, args) => execute(command, args, { windowsHide: true, timeout: 15 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }),
  log = console.log
} = {}) {
  if (platform !== "win32") return { status: "unsupported" };
  const complete = async () => (await Promise.all(REQUIRED_FILES.map((name) => exists(path.join(root, name))))).every(Boolean);
  if (await complete()) {
    log(`[Debugging Tools] Ready: ${root}`);
    return { status: "ready", root };
  }
  log("[Debugging Tools] Missing required tools. Installing Windows SDK Debugging Tools via winget; this may take several minutes. Approve the Windows administrator prompt if shown.");
  try {
    const result = await run("winget.exe", INSTALL_ARGS);
    if (result.stdout?.trim()) log(`[Debugging Tools] ${result.stdout.trim()}`);
    if (!(await complete())) throw new Error("Installer finished but required x64 tools are still missing.");
    log(`[Debugging Tools] Installed: ${root}`);
    return { status: "installed", root };
  } catch (error) {
    log(`[Debugging Tools] Automatic installation failed: ${error.message}. ${error.stderr || error.stdout || ""}`);
    log('[Debugging Tools] Install Windows SDK manually and select "Debugging Tools for Windows", or run in an administrator terminal: winget ' + INSTALL_ARGS.map((arg) => arg.includes(" ") ? `"${arg}"` : arg).join(" "));
    log("[Debugging Tools] Server will continue; installed engine builds may fail until these tools are installed. Installation will be retried on the next server start.");
    return { status: "failed", root };
  }
}
