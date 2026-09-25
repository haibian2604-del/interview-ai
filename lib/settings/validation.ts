import { COPY } from "@/lib/copy";

/** PUT /api/settings 的请求体（字段全部可选，值不信任——typeof 现场校验） */
export type LlmSettingsInputBody = {
  llmBaseUrl?: unknown;
  llmApiKey?: unknown;
  llmChatModel?: unknown;
  llmEvalModel?: unknown;
};

/**
 * 校验后的净值。字段语义（部分更新）：
 * - 键不存在（undefined）= 保持该字段不变（不进 upsert 载荷）
 * - 空串 "" = 清除该字段（回落系统默认 env）
 * - 非空 = 覆盖（已 trim）
 */
export type SanitizedLlmSettings = {
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmChatModel?: string;
  llmEvalModel?: string;
};

export type ValidateLlmSettingsResult =
  | { ok: true; value: SanitizedLlmSettings }
  | { ok: false; error: string };

export const LLM_SETTINGS_LIMITS = {
  baseUrlMax: 500,
  apiKeyMin: 8,
  apiKeyMax: 500,
  modelMax: 200,
} as const;

/** 逐字段校验的纯函数（可单测）：错误文案集中 COPY.settings，绝不回显 key 值 */
export function validateLlmSettingsInput(body: unknown): ValidateLlmSettingsResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: COPY.settings.errInvalidBody };
  }
  const raw = body as LlmSettingsInputBody;
  const value: SanitizedLlmSettings = {};

  // Base URL：undefined=保持；""=清除；非空必须 https?:// 开头、可被 new URL() 解析、长度 ≤ 500
  if (raw.llmBaseUrl !== undefined) {
    if (typeof raw.llmBaseUrl !== "string") {
      return { ok: false, error: COPY.settings.errInvalidType };
    }
    const baseUrl = raw.llmBaseUrl.trim();
    if (baseUrl !== "") {
      if (!/^https?:\/\//.test(baseUrl)) {
        return { ok: false, error: COPY.settings.errBaseUrlFormat };
      }
      try {
        new URL(baseUrl);
      } catch {
        return { ok: false, error: COPY.settings.errBaseUrlFormat };
      }
      if (baseUrl.length > LLM_SETTINGS_LIMITS.baseUrlMax) {
        return { ok: false, error: COPY.settings.errBaseUrlTooLong };
      }
    }
    value.llmBaseUrl = baseUrl;
  }

  // API Key：undefined=保持现有；""=清除用户 key；非空 trim 后长度 8-500
  if (raw.llmApiKey !== undefined) {
    if (typeof raw.llmApiKey !== "string") {
      return { ok: false, error: COPY.settings.errInvalidType };
    }
    const apiKey = raw.llmApiKey.trim();
    if (
      apiKey !== "" &&
      (apiKey.length < LLM_SETTINGS_LIMITS.apiKeyMin ||
        apiKey.length > LLM_SETTINGS_LIMITS.apiKeyMax)
    ) {
      return { ok: false, error: COPY.settings.errApiKeyLength };
    }
    value.llmApiKey = apiKey;
  }

  // 模型名：undefined=保持；""=清除；非空 trim 后长度 ≤ 200
  for (const field of ["llmChatModel", "llmEvalModel"] as const) {
    if (raw[field] === undefined) continue;
    if (typeof raw[field] !== "string") {
      return { ok: false, error: COPY.settings.errInvalidType };
    }
    const model = (raw[field] as string).trim();
    if (model !== "" && model.length > LLM_SETTINGS_LIMITS.modelMax) {
      return { ok: false, error: COPY.settings.errModelTooLong };
    }
    value[field] = model;
  }

  return { ok: true, value };
}
