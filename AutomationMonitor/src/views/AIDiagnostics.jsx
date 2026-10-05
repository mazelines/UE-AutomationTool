import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { IconSpark, IconCheck } from "../icons.jsx";

const DEFAULT_AI_CONFIG = {
  autoDiagnose: false,
  maxTokens: 120000,
  primaryProviderId: "codex",
  secondaryProviderId: ""
};

const AI_PROVIDERS = [
  { id: "codex", name: "Codex CLI", kind: "codex-cli", desc: "로컬 codex CLI 재사용 (ChatGPT OAuth 세션)" },
  { id: "zai", name: "Z.AI International", kind: "openai-compatible", desc: "OpenAI 호환 API" }
];

const INPUT_STYLE = {
  border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", borderRadius: 7, padding: "7px 9px", outline: "none", fontSize: 12
};

const SELECT_STYLE = {
  ...INPUT_STYLE,
  appearance: "none",
  paddingRight: "28px",
  backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 9px center"
};

function Section({ title, children }) {
  return (
    <div className="card" style={{ padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, color: "var(--text)" }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children, help }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 500, color: "var(--text)" }}>
        {label}
        {help && <span style={{ color: "var(--text-mute)", fontWeight: 400, fontSize: 11 }}>{help}</span>}
      </div>
      {children}
    </div>
  );
}

export default function AIDiagnosticsView({ flash }) {
  const [config, setConfig] = useState(null);
  const [providers, setProviders] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(null);
  const [testResult, setTestResult] = useState(null);
  // Model lists fetched from /models after a successful connection test, per provider.
  const [modelOptions, setModelOptions] = useState({});
  const [loadingModels, setLoadingModels] = useState(null);

  // Fetch a provider's model list into modelOptions so the Model field becomes a dropdown.
  const fetchModels = async (id, providerCfg) => {
    setLoadingModels(id);
    try {
      const result = await api("/api/ai/models", { method: "POST", body: JSON.stringify({ providerId: id, config: providerCfg || {} }) });
      if (result?.ok && Array.isArray(result.models) && result.models.length) {
        setModelOptions((prev) => ({ ...prev, [id]: result.models }));
        return result.models;
      }
    } catch {}
    finally { setLoadingModels(null); }
    return null;
  };

  const load = async () => {
    try {
      const data = await api("/api/ai/config");
      setConfig({
        autoDiagnose: data.autoDiagnose ?? DEFAULT_AI_CONFIG.autoDiagnose,
        maxTokens: data.maxTokens ?? DEFAULT_AI_CONFIG.maxTokens,
        primaryProviderId: data.primaryProviderId ?? DEFAULT_AI_CONFIG.primaryProviderId,
        secondaryProviderId: data.secondaryProviderId ?? DEFAULT_AI_CONFIG.secondaryProviderId
      });
      setProviders(data.providers || {});
      // Providers with saved credentials can offer their model dropdown right away —
      // a saved API key arrives as "[REDACTED]", which the server maps back to the real key.
      for (const [id, p] of Object.entries(data.providers || {})) {
        if (p.kind === "openai-compatible" && p.baseUrl && p.apiKey) fetchModels(id, p);
      }
    } catch (error) {
      flash("error", error.message || "AI 설정을 불러오지 못했습니다");
    }
  };

  useEffect(() => { load(); }, []);

  const enabledProviderIds = useMemo(() => Object.entries(providers)
    .filter(([id, p]) => id === "codex" ? true : p?.enabled)
    .map(([id]) => id), [providers]);

  const updateProvider = (id, patch) => {
    setProviders((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  };

  const updateConfig = (patch) => setConfig((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...config, providers };
      const result = await api("/api/ai/config", { method: "POST", body: JSON.stringify(payload) });
      if (result?.error) throw new Error(result.error);
      setConfig({
        autoDiagnose: result.autoDiagnose ?? config.autoDiagnose,
        maxTokens: result.maxTokens ?? config.maxTokens,
        primaryProviderId: result.primaryProviderId ?? config.primaryProviderId,
        secondaryProviderId: result.secondaryProviderId ?? config.secondaryProviderId
      });
      setProviders(result.providers || providers);
      flash("success", "AI 설정이 저장되었습니다");
    } catch (error) {
      flash("error", error.message || "AI 설정 저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const testProvider = async (id) => {
    setTesting(id);
    setTestResult(null);
    try {
      // Send the current form values so unsaved edits can be tested too.
      const result = await api("/api/ai/test", { method: "POST", body: JSON.stringify({ providerId: id, config: providers[id] || {} }) });
      setTestResult({ id, ...result });
      if (result?.ok) {
        // Auto-set the default model discovered from the endpoint's /models list.
        if (Array.isArray(result.models) && result.models.length) {
          setModelOptions((prev) => ({ ...prev, [id]: result.models }));
          if (result.model && !providers[id]?.model) updateProvider(id, { model: result.model });
        }
        flash("success", `${AI_PROVIDERS.find((p) => p.id === id)?.name || id} 연결 성공`);
      }
      else flash("error", result?.error || `${id} 연결 실패`);
    } catch (error) {
      setTestResult({ id, ok: false, error: error.message || String(error) });
      flash("error", error.message || String(error));
    } finally {
      setTesting(null);
    }
  };

  const runManualDiagnosis = async () => {
    try {
      const result = await api("/api/ai/diagnose", { method: "POST" });
      if (result?.error) throw new Error(result.error);
      setTestResult({ id: "manual", ...result });
      flash("success", "AI 진단이 완료되었습니다");
    } catch (error) {
      flash("error", error.message || "AI 진단 실패");
    }
  };

  if (!config) return <div className="loading" />;

  return (
    <div style={{ padding: 16, maxWidth: 880 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <IconSpark />
        <h1 style={{ fontSize: 18, margin: 0 }}>AI 빌드 진단</h1>
      </div>

      <Section title="프로바이더 선택">
        <Row label="Primary Provider" help="빌드 실패 시 먼저 사용할 AI">
          <select
            value={config.primaryProviderId}
            onChange={(event) => updateConfig({ primaryProviderId: event.target.value })}
            style={SELECT_STYLE}
          >
            {AI_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Row>
        <Row label="Secondary Provider" help="Primary 실패/오류 시 Fallback">
          <select
            value={config.secondaryProviderId}
            onChange={(event) => updateConfig({ secondaryProviderId: event.target.value })}
            style={SELECT_STYLE}
          >
            <option value="">사용 안 함</option>
            {enabledProviderIds.map((id) => {
              const p = AI_PROVIDERS.find((x) => x.id === id);
              return <option key={id} value={id}>{p?.name || id}</option>;
            })}
          </select>
        </Row>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}>
            <input
              type="checkbox"
              checked={config.autoDiagnose}
              onChange={(event) => updateConfig({ autoDiagnose: event.target.checked })}
            />
            빌드 실패 시 자동으로 AI 진단 실행
          </label>
        </div>
      </Section>

      {AI_PROVIDERS.map((p) => {
        const provider = providers[p.id] || {};
        const isEnabled = p.id === "codex" ? true : provider.enabled;
        return (
          <Section key={p.id} title={p.name}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: "var(--text-mute)" }}>{p.desc}</div>
              {p.id !== "codex" && (
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={provider.enabled || false}
                    onChange={(event) => updateProvider(p.id, { enabled: event.target.checked })}
                  />
                  활성화
                </label>
              )}
            </div>
            {p.kind === "codex-cli" && (
              <>
                <Row label="CLI 경로" help="비워두면 PATH에서 자동 검색">
                  <input
                    value={provider.cliPath || ""}
                    onChange={(event) => updateProvider(p.id, { cliPath: event.target.value })}
                    placeholder="codex"
                    style={{ ...INPUT_STYLE, fontFamily: "var(--font-mono)" }}
                  />
                </Row>
                {/* Free text: codex model IDs change per CLI release, so no fixed dropdown. */}
                <Row label="모델" help="비워두면 CLI 기본 모델 사용">
                  <input
                    value={provider.model || ""}
                    onChange={(event) => updateProvider(p.id, { model: event.target.value })}
                    placeholder={provider.modelHint || "gpt-6-astra"}
                    style={{ ...INPUT_STYLE, fontFamily: "var(--font-mono)" }}
                  />
                </Row>
              </>
            )}
            {p.kind === "openai-compatible" && (
              <>
                <Row label="Base URL">
                  <input
                    value={provider.baseUrl || ""}
                    onChange={(event) => updateProvider(p.id, { baseUrl: event.target.value })}
                    placeholder="https://api.example.com/v1"
                    style={{ ...INPUT_STYLE, fontFamily: "var(--font-mono)" }}
                  />
                </Row>
                <Row label="API Key" help="브라우저에는 저장 후 마스킹됨">
                  <input
                    type="password"
                    value={provider.apiKey || ""}
                    onChange={(event) => updateProvider(p.id, { apiKey: event.target.value })}
                    placeholder="sk-..."
                    style={{ ...INPUT_STYLE, fontFamily: "var(--font-mono)" }}
                  />
                </Row>
                <Row label="Model" help={modelOptions[p.id]?.length ? "연결 테스트로 가져온 목록" : "연결 테스트 성공 시 자동 설정됨"}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {modelOptions[p.id]?.length ? (
                      <select
                        value={provider.model || ""}
                        onChange={(event) => updateProvider(p.id, { model: event.target.value })}
                        style={{ ...SELECT_STYLE, fontFamily: "var(--font-mono)", flex: 1 }}
                      >
                        {/* Keep a previously saved value selectable even if it is not in the fresh list. */}
                        {(provider.model && !modelOptions[p.id].includes(provider.model) ? [provider.model, ...modelOptions[p.id]] : modelOptions[p.id]).map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={provider.model || ""}
                        onChange={(event) => updateProvider(p.id, { model: event.target.value })}
                        placeholder={provider.modelHint || "gpt-4o"}
                        style={{ ...INPUT_STYLE, fontFamily: "var(--font-mono)", flex: 1 }}
                      />
                    )}
                    {/* Re-fetch the provider's model list (uses the form's current URL/key). */}
                    {provider.baseUrl && provider.apiKey && (
                      <button
                        className="btn sm"
                        disabled={loadingModels === p.id}
                        onClick={async () => {
                          const models = await fetchModels(p.id, provider);
                          if (models) flash("success", `모델 ${models.length}개를 불러왔습니다`);
                          else flash("error", "모델 목록을 불러오지 못했습니다");
                        }}
                      >
                        {loadingModels === p.id ? "조회 중..." : "목록 새로고침"}
                      </button>
                    )}
                  </div>
                </Row>
              </>
            )}
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button className="btn sm" disabled={testing === p.id} onClick={() => testProvider(p.id)}>
                {testing === p.id ? "테스트 중..." : "연결 테스트"}
              </button>
              {testResult?.id === p.id && (
                <span style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 5, color: testResult.ok ? "var(--success)" : "var(--danger)" }}>
                  {testResult.ok ? <><IconCheck size={12} /> 연결 성공</> : <>연결 실패: {testResult.error}</>}
                </span>
              )}
            </div>
          </Section>
        );
      })}

      <div className="card" style={{ padding: 16, display: "flex", gap: 10, alignItems: "center" }}>
        <button className="btn accent" disabled={saving} onClick={save}>
          {saving ? "저장 중..." : "설정 저장"}
        </button>
        <button className="btn sm" onClick={runManualDiagnosis}>
          최근 실패 로그 수동 진단
        </button>
      </div>

      {testResult?.id === "manual" && testResult?.ok && (
        <div className="card" style={{ padding: 16, marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>AI 진단 결과</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{testResult.summary}</div>
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.45 }}>
              <b>원인:</b> {testResult.rootCause}
            </div>
            {Array.isArray(testResult.affectedFiles) && testResult.affectedFiles.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text-mute)", lineHeight: 1.4 }}>
                <b>파일:</b> {testResult.affectedFiles.join(", ")}
              </div>
            )}
            <div style={{ fontSize: 11.5, color: "var(--text-dim)", lineHeight: 1.45, borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <b>권장 해결:</b> {testResult.recommendedFix}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-mute)", marginTop: 4 }}>
              <span>Provider: {testResult.providerName || testResult.providerId}</span>
              <span>신뢰도: {testResult.confidence}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
