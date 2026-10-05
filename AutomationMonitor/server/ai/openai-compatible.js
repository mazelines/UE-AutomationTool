import https from "node:https";
import http from "node:http";
import { URL } from "node:url";

function requestJson(url, options, body) {
  return new Promise((resolve) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const req = transport.request(parsed, { method: options.method || "POST", headers: options.headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve({ ok: true, data: JSON.parse(data) });
          } catch (e) {
            resolve({ ok: false, error: `Invalid JSON response: ${e.message}` });
          }
        } else {
          resolve({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}: ${data.slice(0, 500)}` });
        }
      });
    });
    req.on("error", (error) => resolve({ ok: false, error: error.message }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Retry only transient 5xx (short linear backoff, max 2 retries); everything else —
// 4xx auth/validation errors included — surfaces immediately.
async function requestJsonWithRetry(url, options, body) {
  let result = await requestJson(url, options, body);
  for (let attempt = 0; attempt < 2 && !result.ok && result.status >= 500; attempt++) {
    await new Promise((r) => setTimeout(r, 1500 + attempt * 2500));
    result = await requestJson(url, options, body);
  }
  return result;
}

export function createProvider(config) {
  if (!config.baseUrl || !config.apiKey || !config.model) return null;

  // Normalize base URL: strip trailing slash, add /chat/completions if absent.
  let baseUrl = config.baseUrl.replace(/\/$/, "");
  if (!/\/chat\/completions$/.test(baseUrl)) baseUrl += "/chat/completions";

  return {
    id: config.id,
    name: config.name,
    async diagnose(prompt) {
      const body = {
        model: config.model,
        messages: [
          { role: "system", content: "You are an expert Unreal Engine build automation engineer." },
          { role: "user", content: prompt }
        ]
        // No temperature: some endpoints reject any value but their own default.
      };
      const result = await requestJsonWithRetry(baseUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": `Bearer ${config.apiKey}`
        }
      }, body);

      if (!result.ok) {
        // Some endpoints list models the account cannot actually use; name the remedy
        // instead of dumping raw JSON.
        if (/ModelNotOpen|InvalidEndpointOrModel/i.test(result.error)) {
          return { ok: false, error: `모델 '${config.model}'을(를) 이 계정에서 사용할 수 없습니다. '목록 새로고침'으로 접근 가능한 모델을 선택하세요.` };
        }
        // z.ai error code 1113 and friends: the account is out of credit, not misconfigured.
        if (/insufficient balance|no resource package|recharge/i.test(result.error)) {
          return { ok: false, error: "계정 잔액이 부족합니다. 해당 AI 서비스 콘솔에서 충전/리소스 패키지를 확인하세요. (HTTP 429, 잔액 부족)" };
        }
        return result;
      }

      // GLM reasoning models sometimes answer with empty content and put the real text
      // in reasoning_content — accept either.
      const message = result.data?.choices?.[0]?.message;
      const text = message?.content || message?.reasoning_content;
      if (!text) return { ok: false, error: "Model returned empty content" };
      return { ok: true, text };
    }
  };
}

// List models from the OpenAI-compatible GET /models endpoint. Used to auto-pick a
// default model after a successful connection test. Returns [] on any failure — a
// missing /models route must not break the connection test itself.
export async function listModels(config) {
  if (!config.baseUrl || !config.apiKey) return [];
  const root = config.baseUrl.replace(/\/$/, "").replace(/\/chat\/completions$/, "");
  const result = await requestJson(`${root}/models`, {
    method: "GET",
    headers: { "authorization": `Bearer ${config.apiKey}` }
  });
  if (!result.ok) return [];
  const data = result.data?.data;
  if (!Array.isArray(data)) return [];
  return data.map((entry) => entry?.id).filter((id) => typeof id === "string" && id);
}
