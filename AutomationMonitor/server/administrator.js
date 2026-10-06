import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

export async function requireAdministrator({ platform = process.platform, run = execute } = {}) {
  if (platform !== "win32") throw new Error("UE-AutomationTool server requires Windows administrator privileges.");
  const script = "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)";
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
  if (stdout.trim().toLowerCase() !== "true") {
    throw new Error("Administrator permission required. Run Start-Dev.cmd or Start-Prod.cmd and approve the UAC prompt, or open an administrator terminal before running npm.");
  }
}
