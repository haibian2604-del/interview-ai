import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { getAsrConfig } from "@/lib/settings/service";
import {
  buildTranscriptionRequest,
  extractTranscriptionText,
  validateAudioUpload,
} from "@/lib/voice/transcribe";
import { serverErrorResponse } from "@/lib/api/server-error";
import { scrubSummary } from "@/lib/api/scrub";
import { COPY } from "@/lib/copy";

export const maxDuration = 60;

/**
 * 语音作答转写（纯转发）：音频只在内存过路，服务端不落盘、不记录内容；
 * 转写文本进响应体后由前端回填答题框，用户保留最终编辑权。
 */
export async function POST(request: Request) {
  // /api/* 不在 middleware 的 PROTECTED 名单内，这里自己兜住未登录
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: COPY.voice.errNoAudio }, { status: 400 });
  }
  const audio = form.get("audio");
  const guard = validateAudioUpload(audio);
  if (guard) {
    // 无有效音频 / 超 4MB 统一 400（413 语义放弃：Vercel 平台层会拦截，统一文案更可控）
    return NextResponse.json({ error: guard }, { status: 400 });
  }

  const cfg = await getAsrConfig(user.id);
  if (!cfg) {
    return NextResponse.json({ error: COPY.voice.notConfigured }, { status: 409 });
  }

  try {
    const { url, init } = buildTranscriptionRequest(cfg, audio as Blob);
    const res = await fetch(url, init);
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      // 日志同样过 scrub：上游网关在错误体中回显 Authorization key 是真实行为
      console.error("[voice/transcribe] upstream", res.status, scrubSummary(raw, [cfg.apiKey]));
      return NextResponse.json({ error: COPY.voice.transcribeFailed }, { status: 502 });
    }
    const payload: unknown = await res.json().catch(() => null);
    const text = extractTranscriptionText(payload);
    if (text === undefined) {
      // 响应缺 text：只记形状问题，转写内容不进日志
      console.error("[voice/transcribe] upstream payload missing text field");
      return NextResponse.json({ error: COPY.voice.transcribeFailed }, { status: 502 });
    }
    return NextResponse.json({ text });
  } catch (e) {
    return serverErrorResponse("voice/transcribe: upstream failed", e, 502);
  }
}
