import { createSupabaseServerClient } from "@/lib/supabase/server";
import { optionalEnv } from "@/lib/env";
import { decryptSecret, maskSecret } from "@/lib/settings/crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export type LlmConfig = { baseURL: string; apiKey: string; chatModel: string; evalModel?: string };

/** 端点预设（llm_endpoint_presets 表行的展示形状） */
export type LlmUrlPreset = { label: string; url: string };

/** 未知形状的预设行防御性映射：缺字段/空串一律丢弃（种子数据脏行不该炸设置页） */
export function mapPresetRows(
  rows: { label: unknown; url: unknown }[] | null,
): LlmUrlPreset[] {
  return (rows ?? [])
    .filter(
      (r): r is { label: string; url: string } =>
        typeof r?.label === "string" &&
        typeof r?.url === "string" &&
        r.label.trim() !== "" &&
        r.url.trim() !== "",
    )
    .map((r) => ({ label: r.label, url: r.url }));
}

/** 系统级端点预设：读取失败/表未建（0007 未应用）视同无预设——纯便利功能，不阻塞设置页 */
export async function listLlmUrlPresets(supabase: SupabaseClient): Promise<LlmUrlPreset[]> {
  const { data, error } = await supabase
    .from("llm_endpoint_presets")
    .select("label, url")
    .order("sort_order");
  if (error) {
    console.error("[settings] load llm_endpoint_presets failed:", error.message);
    return [];
  }
  return mapPresetRows(data);
}

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
  // 0003 未应用（asr_* 列不存在）时合并 select 整体失败——若直接视同未配置，
  // LLM 掩码也丢失且「保存」会以空串清掉已存 LLM 字段。先试全列，失败回退仅 LLM 列。
  const full = await supabase
    .from("user_settings")
    .select(
      "llm_base_url, llm_api_key_enc, llm_chat_model, llm_eval_model, asr_base_url, asr_api_key_enc, asr_model",
    )
    .eq("user_id", userId)
    .maybeSingle();
  let settings = full.data as
    | {
        llm_base_url: string | null;
        llm_api_key_enc: string | null;
        llm_chat_model: string | null;
        llm_eval_model: string | null;
        asr_base_url?: string | null;
        asr_api_key_enc?: string | null;
        asr_model?: string | null;
      }
    | null;
  if (full.error) {
    console.error("[settings] load user_settings(full) failed, retry LLM-only:", full.error.message);
    const llmOnly = await supabase
      .from("user_settings")
      .select("llm_base_url, llm_api_key_enc, llm_chat_model, llm_eval_model")
      .eq("user_id", userId)
      .maybeSingle();
    // 回退查询也失败（如 0002 未应用）才真正视同未配置。
    // 回退行没有 asr 列（asr_* 为 undefined），?? 兜底后语义 = ASR 未配置。
    settings = llmOnly.data;
    if (llmOnly.error) {
      console.error("[settings] load user_settings(llm-only) failed, treat as unconfigured:", llmOnly.error.message);
    }
  }
  const hasKey = !!settings?.llm_api_key_enc;
  // 解密失败（如 SETTINGS_SECRET 轮换）时 keyMask 返回空串：设置页据此显示「请重新填写」红墨批注
  let keyMask = "";
  if (settings?.llm_api_key_enc) {
    const plaintext = safeDecrypt(settings.llm_api_key_enc);
    if (plaintext !== undefined) keyMask = maskSecret(plaintext);
  }
  // ASR 侧同规则：密文解密失败 → 空 mask，设置页显示「请重新填写」
  let asrKeyMask = "";
  if (settings?.asr_api_key_enc) {
    const plaintext = safeDecrypt(settings.asr_api_key_enc);
    if (plaintext !== undefined) asrKeyMask = maskSecret(plaintext);
  }
  return {
    hasUserConfig: !!settings,
    llmBaseUrl: settings?.llm_base_url ?? "",
    llmChatModel: settings?.llm_chat_model ?? "",
    llmEvalModel: settings?.llm_eval_model ?? "",
    hasKey,
    keyMask,
    asrBaseUrl: settings?.asr_base_url ?? "",
    asrModel: settings?.asr_model ?? "",
    asrHasKey: !!settings?.asr_api_key_enc,
    asrKeyMask,
  };
}

export type AsrConfig = { baseURL: string; apiKey: string; model: string };

/** user_settings 行 ASR 列的 camelCase 形状（连同 LLM 同行字段一起传入，供回落链使用） */
export type UserAsrSettings = {
  asrBaseUrl: string | null;
  asrApiKeyEnc: string | null;
  asrModel: string | null;
};

/** env 侧 ASR 兜底值；LLM 两项用于「用户没单配 ASR 时回落到同一网关」 */
export type AsrEnv = {
  asrBaseUrl?: string;
  asrApiKey?: string;
  asrModel?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
};

/**
 * 纯合并逻辑（语音是可选能力，解析不出必填项 → null = 功能未配置，不抛错）：
 * baseURL/apiKey 逐字段回落链：用户 ASR → 用户 LLM → env ASR_* → env LLM_*；
 * model 只认用户 asrModel 与 env ASR_MODEL（不做默认值猜测，避免指向不存在的模型）。
 * apiKey 的最高优先级是 overrideKey：test-asr 路由的明文草稿 key 不能走密文列通道，
 * 必须压过用户已存 key 的解密回落。
 */
export function resolveAsrConfig(input: {
  user: (UserAsrSettings & { llmBaseUrl: string | null; llmApiKeyEnc: string | null }) | null;
  env: AsrEnv;
  overrideKey?: string;
}): AsrConfig | null {
  const u = input.user;
  const userKey = u?.asrApiKeyEnc ? safeDecrypt(u.asrApiKeyEnc) : undefined;
  const userLlmKey = u?.llmApiKeyEnc ? safeDecrypt(u.llmApiKeyEnc) : undefined;
  const baseURL = u?.asrBaseUrl || u?.llmBaseUrl || input.env.asrBaseUrl || input.env.llmBaseUrl;
  const apiKey = input.overrideKey || userKey || userLlmKey || input.env.asrApiKey || input.env.llmApiKey;
  const model = u?.asrModel || input.env.asrModel;
  if (!baseURL || !apiKey || !model) return null;
  return { baseURL, apiKey, model };
}

/** 从 process.env 收集 ASR 兜底值（导出：test-asr 路由的草稿覆盖也要用同一 env 集） */
export function collectAsrEnv(): AsrEnv {
  return {
    asrBaseUrl: optionalEnv("ASR_BASE_URL"),
    asrApiKey: optionalEnv("ASR_API_KEY"),
    asrModel: optionalEnv("ASR_MODEL"),
    llmBaseUrl: optionalEnv("LLM_BASE_URL"),
    llmApiKey: optionalEnv("LLM_API_KEY"),
  };
}

/** user_settings 行 → resolveAsrConfig 的 user 形状（getAsrConfig 与 test-asr 草稿覆盖共用）。
 * 行缺失返回全 null 形状——resolveAsrConfig 对全 null 与 null user 判定一致（未配置）。 */
export function mapAsrUserRow(settings: {
  asr_base_url: string | null;
  asr_api_key_enc: string | null;
  asr_model: string | null;
  llm_base_url: string | null;
  llm_api_key_enc: string | null;
} | null): UserAsrSettings & { llmBaseUrl: string | null; llmApiKeyEnc: string | null } {
  return {
    asrBaseUrl: settings?.asr_base_url ?? null,
    asrApiKeyEnc: settings?.asr_api_key_enc ?? null,
    asrModel: settings?.asr_model ?? null,
    llmBaseUrl: settings?.llm_base_url ?? null,
    llmApiKeyEnc: settings?.llm_api_key_enc ?? null,
  };
}

export async function getAsrConfig(userId: string): Promise<AsrConfig | null> {
  const supabase = await createSupabaseServerClient();
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("asr_base_url, asr_api_key_enc, asr_model, llm_base_url, llm_api_key_enc")
    .eq("user_id", userId)
    .maybeSingle();
  // 迁移未应用（列不存在）等查询失败：视同未配置，语音是可选能力，不 crash
  if (error) {
    console.error("[settings] load user_settings(asr) failed, treat as unconfigured:", error.message);
  }

  // snake_case 列 → camelCase 形状后交给纯函数（映射铁律）
  return resolveAsrConfig({ user: mapAsrUserRow(settings ?? null), env: collectAsrEnv() });
}
