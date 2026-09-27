import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { getMaskedLlmSettings } from "@/lib/settings/service";
import { encryptSecret } from "@/lib/settings/crypto";
import { validateLlmSettingsInput } from "@/lib/settings/validation";
import { COPY } from "@/lib/copy";

export async function GET() {
  // /api/* 不在 middleware 的 PROTECTED 名单内，这里自己兜住未登录（先例同 /api/resume/parse）
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }
  // 掩码形态：绝无密文、绝无明文 key
  const masked = await getMaskedLlmSettings(user.id);
  return NextResponse.json(masked);
}

export async function PUT(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: COPY.settings.errInvalidBody }, { status: 400 });
  }
  const validated = validateLlmSettingsInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const fields = validated.value;

  // 组装 upsert 载荷：仅携带本次要写的列（undefined=保持不变，不进载荷）。
  // PostgREST merge-duplicates 对已存在行只 UPDATE 载荷中出现的列，未提及列原样保留——
  // 部分更新语义由此成立；对不存在的行则整行插入，缺席列落默认值 null（等价「无配置」）。
  // 0002 迁移无 updated_at 触发器，这里手动 set（Task 14 台账交接项）。
  const record: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  };
  if (fields.llmBaseUrl !== undefined) record.llm_base_url = fields.llmBaseUrl;
  if (fields.llmApiKey !== undefined) {
    // 空串 = 清除用户 key（回落 env）；非空 = 加密覆盖。
    // 加密发生在任何写库动作之前：无 SETTINGS_SECRET 时此处抛错 → 500，不落半成品。
    try {
      record.llm_api_key_enc =
        fields.llmApiKey === "" ? "" : encryptSecret(fields.llmApiKey);
    } catch (e) {
      console.error("[settings] encrypt api key failed:", e);
      return NextResponse.json({ error: COPY.settings.saveFailed }, { status: 500 });
    }
  }
  if (fields.llmChatModel !== undefined) record.llm_chat_model = fields.llmChatModel;
  if (fields.llmEvalModel !== undefined) record.llm_eval_model = fields.llmEvalModel;
  if (fields.asrBaseUrl !== undefined) record.asr_base_url = fields.asrBaseUrl;
  if (fields.asrApiKey !== undefined) {
    // 空串 = 清除用户 ASR key（回落链自动顶上）；非空 = AES-GCM 加密覆盖
    // 加密发生在任何写库动作之前：无 SETTINGS_SECRET 时此处抛错 → 500，不落半成品
    try {
      record.asr_api_key_enc = fields.asrApiKey === "" ? "" : encryptSecret(fields.asrApiKey);
    } catch (e) {
      console.error("[settings] encrypt asr key failed:", e);
      return NextResponse.json({ error: COPY.settings.saveFailed }, { status: 500 });
    }
  }
  if (fields.asrModel !== undefined) record.asr_model = fields.asrModel;

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("user_settings").upsert(record);
  if (error) {
    // 日志只记 message，载荷里不含明文 key（密文也无必要）
    console.error("[settings] upsert user_settings failed:", error.message);
    // 42P01 = undefined_table：0002 迁移未应用 →「系统尚未启用该功能」语义，而非笼统失败
    const featureNotEnabled = error.code === "42P01";
    return NextResponse.json(
      { error: featureNotEnabled ? COPY.settings.featureNotEnabled : COPY.settings.saveFailed },
      { status: 500 },
    );
  }

  // 成功返回最新掩码形态（客户端就地刷新，无需二次 GET）
  const masked = await getMaskedLlmSettings(user.id);
  return NextResponse.json(masked);
}
