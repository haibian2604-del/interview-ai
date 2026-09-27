import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { collectAsrEnv, resolveAsrConfig } from "@/lib/settings/service";
import { buildTranscriptionRequest, extractTranscriptionText, probeWavBytes } from "@/lib/voice/transcribe";
import { COPY } from "@/lib/copy";

export const maxDuration = 60;

type TestAsrDraft = { asrBaseUrl?: unknown; asrApiKey?: unknown; asrModel?: unknown };

/** 草稿字段：仅「非空字符串」覆盖已存配置；未传/空串/非字符串均视同未覆盖 */
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

  // body 可整体缺省：不带 body = 用已存配置测
  let body: TestAsrDraft = {};
  try {
    const parsed: unknown = await request.json();
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      body = parsed as TestAsrDraft;
    }
  } catch {
    // 空 body / 非 JSON：视同不带草稿
  }

  // 读已存配置行：表/列不存在等查询失败视同未配置——探针不依赖 DB 中已存的用户行
  const supabase = await createSupabaseServerClient();
  const { data: settings, error } = await supabase
    .from("user_settings")
    .select("asr_base_url, asr_api_key_enc, asr_model, llm_base_url, llm_api_key_enc")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) {
    console.error("[settings/test-asr] load user_settings failed, treat as unconfigured:", error.message);
  }

  // 草稿 key 是明文：走 Task 1 预埋的 overrideKey 最高优先级通道，
  // 压过用户已存 ASR/LLM key 的解密回落；明文绝不入库、绝不回显，仅本请求内存内生效。
  const draftKey = draftOverride(body.asrApiKey);
  const cfg = resolveAsrConfig({
    user: {
      asrBaseUrl: draftOverride(body.asrBaseUrl) ?? settings?.asr_base_url ?? null,
      asrApiKeyEnc: settings?.asr_api_key_enc ?? null,
      asrModel: draftOverride(body.asrModel) ?? settings?.asr_model ?? null,
      llmBaseUrl: settings?.llm_base_url ?? null,
      llmApiKeyEnc: settings?.llm_api_key_enc ?? null,
    },
    env: collectAsrEnv(),
    overrideKey: draftKey,
  });
  if (!cfg) {
    return NextResponse.json({ ok: false, error: COPY.voice.notConfigured });
  }

  try {
    const { url, init } = buildTranscriptionRequest(
      cfg,
      new Blob([probeWavBytes() as BlobPart], { type: "audio/wav" }),
      "probe.wav",
    );
    const res = await fetch(url, init);
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      // 日志同样过 scrub：上游网关在错误体中回显 Authorization key 是真实行为
      console.error("[settings/test-asr] upstream", res.status, scrubSummary(raw, [cfg.apiKey, draftKey]));
      return NextResponse.json({
        ok: false,
        error: scrubSummary(raw || `HTTP ${res.status}`, [cfg.apiKey, draftKey]),
      });
    }
    const payload: unknown = await res.json().catch(() => null);
    if (extractTranscriptionText(payload) === undefined) {
      // 探针是 1 秒静音：空转写文本也算端点正常，但响应缺 text 形状怪异视为不可用
      console.error("[settings/test-asr] upstream payload missing text field");
      return NextResponse.json({ ok: false, error: COPY.voice.transcribeFailed });
    }
    return NextResponse.json({ ok: true, model: cfg.model });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: scrubSummary(message, [cfg.apiKey, draftKey]) });
  }
}
