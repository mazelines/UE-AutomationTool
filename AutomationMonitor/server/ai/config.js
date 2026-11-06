export function mergeProviderConfig(id, base, incoming) {
  return {
    ...base,
    enabled: id === "codex" ? true : typeof incoming.enabled === "boolean" ? incoming.enabled : Boolean(base.enabled),
    apiKey: incoming.apiKey === "[REDACTED]" ? base.apiKey
      : typeof incoming.apiKey === "string" ? incoming.apiKey : base.apiKey,
    baseUrl: typeof incoming.baseUrl === "string" ? incoming.baseUrl : base.baseUrl,
    model: typeof incoming.model === "string" ? incoming.model : base.model,
    cliPath: typeof incoming.cliPath === "string" ? incoming.cliPath : base.cliPath
  };
}
