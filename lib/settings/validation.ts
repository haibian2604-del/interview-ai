import { COPY } from "@/lib/copy";

/** PUT /api/settings 的请求体（字段全部可选，值不信任——typeof 现场校验） */
export type LlmSettingsInputBody = {
  llmBaseUrl?: unknown;
  llmApiKey?: unknown;
  llmChatModel?: unknown;
  llmEvalModel?: unknown;
  asrBaseUrl?: unknown;
  asrApiKey?: unknown;
  asrModel?: unknown;
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
  asrBaseUrl?: string;
  asrApiKey?: string;
  asrModel?: string;
};

export type ValidateLlmSettingsResult =
  | { ok: true; value: SanitizedLlmSettings }
  | { ok: false; error: string };

export const SETTINGS_FIELD_LIMITS = {
  baseUrlMax: 500,
  apiKeyMin: 8,
  apiKeyMax: 500,
  modelMax: 200,
} as const;

type FieldKind = "url" | "key" | "model";

/** 单字段净化：非字符串 → 类型错；空串放行（清除语义）；其余按类型规则 */
function sanitizeField(kind: FieldKind, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: COPY.settings.errInvalidType };
  const value = raw.trim();
  if (value === "") return { ok: true, value: "" };
  if (kind === "url") {
    // 必须以 https?:// 开头、可被 new URL() 解析、长度 ≤ baseUrlMax
    if (!/^https?:\/\//.test(value)) {
      return { ok: false, error: COPY.settings.errBaseUrlFormat };
    }
    try {
      new URL(value);
    } catch {
      return { ok: false, error: COPY.settings.errBaseUrlFormat };
    }
    if (value.length > SETTINGS_FIELD_LIMITS.baseUrlMax) {
      return { ok: false, error: COPY.settings.errBaseUrlTooLong };
    }
  } else if (kind === "key") {
    // 非空 trim 后长度 8-500
    if (value.length < SETTINGS_FIELD_LIMITS.apiKeyMin) {
      return { ok: false, error: COPY.settings.errApiKeyLength };
    }
    if (value.length > SETTINGS_FIELD_LIMITS.apiKeyMax) {
      return { ok: false, error: COPY.settings.errApiKeyLength };
    }
  } else if (value.length > SETTINGS_FIELD_LIMITS.modelMax) {
    return { ok: false, error: COPY.settings.errModelTooLong };
  }
  return { ok: true, value };
}

/** 字段 → 校验类型（url/key/model，规则与错误文案 LLM、ASR 同源） */
const FIELD_RULES = [
  ["llmBaseUrl", "url"],
  ["llmApiKey", "key"],
  ["llmChatModel", "model"],
  ["llmEvalModel", "model"],
  ["asrBaseUrl", "url"],
  ["asrApiKey", "key"],
  ["asrModel", "model"],
] as const;

/** 逐字段校验的纯函数（可单测）：错误文案集中 COPY.settings，绝不回显 key 值 */
export function validateLlmSettingsInput(body: unknown): ValidateLlmSettingsResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: COPY.settings.errInvalidBody };
  }
  const raw = body as LlmSettingsInputBody;
  const value: SanitizedLlmSettings = {};
  for (const [key, kind] of FIELD_RULES) {
    const input = raw[key];
    if (input === undefined) continue; // 键不存在 = 保持不变
    const result = sanitizeField(kind, input);
    if (!result.ok) return result;
    value[key] = result.value;
  }
  return { ok: true, value };
}
