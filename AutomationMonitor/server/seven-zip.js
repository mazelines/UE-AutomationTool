import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
export function resolveSevenZip(exists = fs.existsSync) {
  const candidates = [...new Set([process.env.ProgramFiles, process.env["ProgramFiles(x86)"], "C:\\Program Files"]
    .filter(Boolean).map((root) => path.join(root, "7-Zip", "7z.exe")))];
  return candidates.find((candidate) => exists(candidate)) || "7z";
}

export async function ensureSevenZip({ platform = process.platform, resolve = resolveSevenZip,
  run = (command, args) => execute(command, args, { windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }),
  log = console.log
} = {}) {
  const command = resolve();
  if (command !== "7z" || platform !== "win32") return command;
  // Support custom installations already available on PATH.
  try { await run("7z", ["i"]); return "7z"; } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  log("[7-Zip] Missing. Installing via winget; approve the Windows administrator prompt if shown.");
  try {
    await run("winget.exe", ["install", "--id", "7zip.7zip", "--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]);
    const installed = resolve();
    await run(installed, ["i"]);
    log(`[7-Zip] Ready: ${installed}`);
    return installed;
  } catch (error) {
    throw new Error(`7-Zip 자동 설치 실패: ${error.message}. 관리자 터미널에서 winget install --id 7zip.7zip --exact 실행 후 배포를 다시 시도하세요.`);
  }
}
