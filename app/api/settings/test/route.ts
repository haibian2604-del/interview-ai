import { NextResponse } from "next/server";
import { generateText } from "ai";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { getModel } from "@/lib/ai/provider";
import { resolveConfig, type UserLlmSettings } from "@/lib/settings/service";
import { encryptSecret } from "@/lib/settings/crypto";
import { optionalEnv } from "@/lib/env";
import { COPY } from "@/lib/copy";

export const maxDuration = 60;

type TestDraftBody = { llmBaseUrl?: unknown; llmApiKey?: unknown; llmChatModel?: unknown };

/** 草稿字段：仅「非空字符串」覆盖已存配置；未传 / 空串 / 非字符串均视同未覆盖 */
function draftOverride(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** 错误摘要：截断 + 抹去一切 key 形态（明文 key 绝不进响应体/日志的红线兜底） */
function scrubSummary(message: string, secrets: (string | undefined)[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return out.slice(0, 300);
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  // body 可整体缺省：不带 body = 用已保存配置测
  let body: TestDraftBody = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as TestDraftBody;
    }
  } catch {
    // 空 body / 非 JSON：视同不带草稿
  }

  // 读已存配置行：表不存在（0002 未应用）等失败视同未配置——测试连接不依赖 DB 中已存的用户行
  const supabase = await createSupabaseServerClient();
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("llm_base_url, llm_api_key_enc, llm_chat_model, llm_eval_model")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[settings] test: load user_settings failed, treat as unconfigured:", error.message);
  }

  // 草稿仅内存覆盖：与 getLlmConfig 同源的 resolveConfig 合成（用户优先、env 兜底）。
  // 草稿 key 是明文——只在内存临时加密以走同一条解密路径，绝不写库、绝不回显。
  // env 兜底值与 service.collectEnv 同一来源（optionalEnv 把空串归一为 undefined）。
  // 合成（含临时加密）也在 try 内：无 SETTINGS_SECRET 时同样返回业务失败而非 500。
  const draftBaseUrl = draftOverride(body.llmBaseUrl);
  const draftApiKey = draftOverride(body.llmApiKey);
  const draftChatModel = draftOverride(body.llmChatModel);
  const env = {
    llmBaseUrl: optionalEnv("LLM_BASE_URL"),
    llmApiKey: optionalEnv("LLM_API_KEY"),
    llmChatModel: optionalEnv("LLM_CHAT_MODEL"),
    llmEvalModel: optionalEnv("LLM_EVAL_MODEL"),
  };

  try {
    const synthesized: UserLlmSettings = {
      llmBaseUrl: draftBaseUrl ?? settings?.llm_base_url ?? "",
      llmApiKeyEnc: draftApiKey ? encryptSecret(draftApiKey) : (settings?.llm_api_key_enc ?? null),
      llmChatModel: draftChatModel ?? settings?.llm_chat_model ?? "",
      llmEvalModel: settings?.llm_eval_model ?? "",
    };
    const cfg = resolveConfig(synthesized, env);
    // 一句即可的探针：走廉价 Agent（resume-analyst → chatModel）
    await generateText({ model: getModel("resume-analyst", cfg), prompt: "ping" });
    return NextResponse.json({ ok: true, model: cfg.chatModel });
  } catch (e) {
    // 业务失败 ≠ 传输失败：HTTP 200 + ok:false
    const summary = scrubSummary(e instanceof Error ? e.message : String(e), [
      draftApiKey,
      env.llmApiKey,
    ]);
    console.error("[settings] test connection failed:", summary);
    return NextResponse.json({ ok: false, error: summary });
  }
}
