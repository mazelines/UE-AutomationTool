import fs from "node:fs/promises";
import path from "node:path";
import {
  createProvider,
  resolveProviderOrder,
  formatDiagnosisPrompt,
  parseJsonResponse,
  makeFallbackResponse,
  truncateLog
} from "./providers.js";

const DEFAULT_MAX_CHARS = 100000; // rough char budget before truncation

function buildLogCandidates(logRoot, run) {
  const candidates = [];
  if (run?.buildLogName) candidates.push(run.buildLogName);
  if (run?.logName) {
    // Wrapper log may reference the build output log by name; also try common patterns.
    candidates.push(run.logName);
  }
  return candidates;
}

async function readBuildLogTail(logRoot, buildLogName, maxBytes = 256 * 1024) {
  if (!buildLogName) return "";
  const fullPath = path.join(logRoot, buildLogName);
  try {
    const stat = await fs.stat(fullPath);
    const handle = await fs.open(fullPath, "r");
    try {
      const start = Math.max(0, stat.size - maxBytes);
      const length = Math.min(maxBytes, stat.size);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, start);
      return buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return "";
  }
}

export async function diagnoseRun({ logRoot, run, repoInfo, aiConfig, tailFile }) {
  const order = resolveProviderOrder(aiConfig);
  if (!order.length) {
    return { ok: false, error: "No AI providers are enabled. Configure at least one provider in AI Diagnostics settings." };
  }

  const maxTokens = aiConfig?.maxTokens || DEFAULT_MAX_CHARS;
  const maxChars = Math.max(4000, Math.floor(maxTokens * 0.75)); // conservative chars per token

  const wrapperLogName = run?.logName;
  let wrapperLog = "";
  if (wrapperLogName) {
    try {
      wrapperLog = await tailFile(wrapperLogName, 600);
    } catch {
      wrapperLog = "";
    }
  }

  let buildLog = "";
  if (run?.buildLogName) {
    buildLog = await readBuildLogTail(logRoot, run.buildLogName, 512 * 1024);
  }
  if (!buildLog && wrapperLogName) {
    // Try to discover a build output log from the same timestamp as the wrapper log.
    const ts = /(\d{8}-\d{6})/.exec(wrapperLogName)?.[1];
    if (ts) {
      try {
        const entries = await fs.readdir(logRoot, { withFileTypes: true });
        const buildLogEntry = entries.find((e) =>
          e.isFile() && e.name.startsWith("InstalledBuild-") && e.name.includes(ts) && e.name.endsWith("-output.log")
        );
        if (buildLogEntry) buildLog = await readBuildLogTail(logRoot, buildLogEntry.name, 512 * 1024);
      } catch {}
    }
  }

  wrapperLog = truncateLog(wrapperLog, Math.floor(maxChars * 0.35));
  buildLog = truncateLog(buildLog, Math.floor(maxChars * 0.55));

  const prompt = formatDiagnosisPrompt({
    wrapperLog,
    buildLog,
    runInfo: run,
    repoInfo
  });

  const usedProviders = [];
  let lastError = "";

  for (const { id, config } of order) {
    const provider = createProvider(config);
    if (!provider) {
      lastError = `Provider ${id} is not configured correctly.`;
      usedProviders.push({ id, ok: false, error: lastError });
      continue;
    }

    const result = await provider.diagnose(prompt);
    usedProviders.push({ id, ok: result.ok, error: result.error });

    if (!result.ok) {
      lastError = result.error;
      continue;
    }

    const parsed = parseJsonResponse(result.text) || makeFallbackResponse(result.text, id);
    if (!parsed.providerId) parsed.providerId = id;
    return {
      ok: true,
      providerId: id,
      providerName: config.name,
      diagnosis: parsed,
      usedProviders,
      runId: run?.id,
      logName: run?.logName,
      buildLogName: run?.buildLogName,
      at: new Date().toISOString()
    };
  }

  return { ok: false, error: lastError || "All configured AI providers failed.", usedProviders };
}

export function buildEmptyDiagnosis(runId) {
  return {
    ok: false,
    error: "Diagnosis not run yet.",
    runId,
    at: null,
    diagnosis: null
  };
}
