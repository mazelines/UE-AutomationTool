import { createProvider as createOpenAiProvider } from "./openai-compatible.js";
import { createProvider as createCodexProvider } from "./codex.js";

export const PROVIDER_META = {
  codex: {
    id: "codex",
    name: "Codex CLI",
    description: "Reuses the locally installed Codex CLI's ChatGPT OAuth session."
  },
  zai: {
    id: "zai",
    name: "Z.AI International",
    description: "OpenAI-compatible Z.AI international endpoint (configure base URL and model)."
  }
};

export function createProvider(config) {
  if (!config) return null;
  if (config.kind === "codex-cli") return createCodexProvider(config);
  if (config.kind === "openai-compatible" && config.enabled) return createOpenAiProvider(config);
  return null;
}

// Resolve provider order: primary first, then secondary, then remaining enabled providers.
export function resolveProviderOrder(aiConfig) {
  const providers = aiConfig?.providers || {};
  const ids = new Set();
  const order = [];
  const add = (id) => {
    if (!id || ids.has(id)) return;
    const cfg = providers[id];
    if (!cfg) return;
    if (cfg.kind === "openai-compatible" && !cfg.enabled) return;
    ids.add(id);
    order.push({ id, config: cfg });
  };
  add(aiConfig?.primaryProviderId);
  add(aiConfig?.secondaryProviderId);
  for (const id of Object.keys(providers)) add(id);
  return order;
}

export function formatDiagnosisPrompt({ wrapperLog, buildLog, runInfo, repoInfo }) {
  const sections = [];
  sections.push(`You are an expert Unreal Engine build automation engineer. Analyze the following build failure and identify the root cause precisely.`);
  sections.push(`\n## Repository Context`);
  sections.push(`- Branch: ${repoInfo?.branch || "unknown"}`);
  sections.push(`- Head: ${repoInfo?.head || "unknown"}`);
  sections.push(`- Upstream ref: ${repoInfo?.upstreamRef || "unknown"}`);
  sections.push(`- Build result: ${runInfo?.result || "unknown"}`);
  sections.push(`- Failure reason: ${runInfo?.reason || "unknown"}`);
  sections.push(`- Duration: ${runInfo?.durationSeconds != null ? `${runInfo.durationSeconds}s` : "unknown"}`);
  sections.push(`- Mode: ${runInfo?.mode || "unknown"}`);

  sections.push(`\n## Pipeline Wrapper Log`);
  sections.push(wrapperLog || "(no wrapper log available)");

  if (buildLog) {
    sections.push(`\n## Build Output Log (tail)`);
    sections.push(buildLog);
  }

  sections.push(`\n## Instructions`);
  sections.push(`1. Identify the exact stage and root cause of the failure.`);
  sections.push(`2. If the error is a known UE upstream issue (e.g., missing filter XML file, gitdeps prune, DDC regression), mention the specific file/path and upstream commit if known.`);
  sections.push(`3. Suggest concrete next steps to fix or work around the issue.`);
  sections.push(`4. Keep the answer concise but technically specific. Use Korean if possible, English is fine for file paths and technical terms.`);
  sections.push(`\nReturn the result as a JSON object with exactly these keys: summary, rootCause, affectedFiles (array), recommendedFix, confidence (low|medium|high), providerId (string).`);

  return sections.join("\n");
}

export function parseJsonResponse(text) {
  // Models often wrap JSON in prose or markdown fences — slice from the first { to the
  // last } instead of trusting the whole reply to be the object.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const sliced = text.slice(start, end + 1);
  try {
    return JSON.parse(sliced);
  } catch {
    return null;
  }
}

export function makeFallbackResponse(text, providerId) {
  return {
    summary: text.slice(0, 800),
    rootCause: "Failed to parse structured response from model",
    affectedFiles: [],
    recommendedFix: "Retry diagnosis or inspect logs manually.",
    confidence: "low",
    providerId
  };
}

export function truncateLog(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  // Keep the start (context) and the tail (actual error).
  const headSize = Math.min(maxChars * 0.15, 4000);
  const tailSize = maxChars - headSize;
  const head = text.slice(0, headSize);
  const tail = text.slice(-tailSize);
  return `${head}\n\n... [truncated ${text.length - headSize - tailSize} chars] ...\n\n${tail}`;
}
