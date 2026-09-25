import { createSupabaseServerClient } from "@/lib/supabase/server";
import { optionalEnv } from "@/lib/env";
import { decryptSecret, maskSecret } from "@/lib/settings/crypto";

export type LlmConfig = { baseURL: string; apiKey: string; chatModel: string; evalModel?: string };

/** user_settings 行的 camelCase 形状（snake_case 列名由 service 层负责映射，铁律） */
export type UserLlmSettings = {
  llmBaseUrl: string | null;
  llmApiKeyEnc: string | null;
  llmChatModel: string | null;
  llmEvalModel: string | null;
};

/** env 侧可选兜底值（camelCase；undefined/空串视同未配置） */
export type LlmEnv = {
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmChatModel?: string;
  llmEvalModel?: string;
};

/** key 解密失败（如 SETTINGS_SECRET 轮换）不炸整个配置：记日志并回落 env key */
function safeDecrypt(enc: string): string | undefined {
  try {
    return decryptSecret(enc);
  } catch (e) {
    console.error("[settings] decrypt failed:", e);
    return undefined;
  }
}

/**
 * 纯合并逻辑：用户配置逐字段优先，env 兜底（Global Constraint）。
 * 必填字段（baseURL/apiKey/chatModel）两侧都没有时抛出带 env key 名的错误。
 */
export function resolveConfig(user: UserLlmSettings | null, env: LlmEnv): LlmConfig {
  const userKey = user?.llmApiKeyEnc ? safeDecrypt(user.llmApiKeyEnc) : undefined;
  const baseURL = user?.llmBaseUrl || env.llmBaseUrl;
  const apiKey = userKey || env.llmApiKey;
  const chatModel = user?.llmChatModel || env.llmChatModel;
  if (!baseURL) throw new Error("Missing required env: LLM_BASE_URL");
  if (!apiKey) throw new Error("Missing required env: LLM_API_KEY");
  if (!chatModel) throw new Error("Missing required env: LLM_CHAT_MODEL");
  return {
    baseURL,
    apiKey,
    chatModel,
    evalModel: user?.llmEvalModel || env.llmEvalModel || undefined,
  };
}

/** 从 process.env 收集 LLM 兜底值（optionalEnv 把空串归一为 undefined） */
function collectEnv(): LlmEnv {
  return {
    llmBaseUrl: optionalEnv("LLM_BASE_URL"),
    llmApiKey: optionalEnv("LLM_API_KEY"),
    llmChatModel: optionalEnv("LLM_CHAT_MODEL"),
    llmEvalModel: optionalEnv("LLM_EVAL_MODEL"),
  };
}

export async function getLlmConfig(userId: string): Promise<LlmConfig> {
  const supabase = await createSupabaseServerClient();
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("llm_base_url, llm_api_key_enc, llm_chat_model, llm_eval_model")
    .eq("user_id", userId)
    .maybeSingle();
  // 迁移未应用（表不存在）等查询失败：视同未配置回落 env，不 crash
  if (error) {
    console.error("[settings] load user_settings failed, fallback to env:", error.message);
  }

  // snake_case 列 → camelCase 形状后交给纯函数（映射铁律）
  const user: UserLlmSettings | null = settings
    ? {
        llmBaseUrl: settings.llm_base_url,
        llmApiKeyEnc: settings.llm_api_key_enc,
        llmChatModel: settings.llm_chat_model,
        llmEvalModel: settings.llm_eval_model,
      }
    : null;
  return resolveConfig(user, collectEnv());
}

/** 供 /api/settings GET 返回掩码形态；解密后的明文永不离开服务端 */
export async function getMaskedLlmSettings(userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("llm_base_url, llm_api_key_enc, llm_chat_model, llm_eval_model")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[settings] load user_settings failed, treat as unconfigured:", error.message);
  }
  const hasKey = !!settings?.llm_api_key_enc;
  return {
    hasUserConfig: !!settings,
    llmBaseUrl: settings?.llm_base_url ?? "",
    llmChatModel: settings?.llm_chat_model ?? "",
    llmEvalModel: settings?.llm_eval_model ?? "",
    hasKey,
    keyMask: hasKey ? maskSecret(safeDecrypt(settings.llm_api_key_enc) ?? "") : "",
  };
}
