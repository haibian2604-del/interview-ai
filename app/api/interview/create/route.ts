import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { analyzeResume } from "@/lib/agents/resume-analyst";
import { generateQuestions } from "@/lib/agents/question-setter";
import type { ResumeProfile } from "@/lib/ai/schemas";
import { clampQuestionCount } from "@/lib/interview/count";
import { parseDifficulty, parseMode, parseTargetQuestions } from "@/lib/orchestrator/real-mode";
import { COPY } from "@/lib/copy";
import { serverErrorResponse } from "@/lib/api/server-error";

export const maxDuration = 120;

export async function POST(request: Request) {
  // /api/* 不在 middleware 的 PROTECTED 名单内，这里自己兜住未登录（与 /api/resume/parse 同一先例）
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }
  let body: {
    resumeId: string;
    position: string;
    jdText?: string;
    interviewType: "skill" | "project" | "behavioral" | "mixed";
    questionCount?: number;
    mode?: unknown;
    targetQuestions?: unknown;
    difficulty?: unknown;
  };
  // B3：非法 body 兜底 400（对齐 answer/start 先例）
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: COPY.api.invalidJson }, { status: 400 });
  }
  // 服务端钳制：请求值不可信，题库对账以落库事实为准（见 lib/interview/count.ts）
  const count = clampQuestionCount(body.questionCount);
  const mode = parseMode(body.mode);
  // 真实面试选项（题数 10/15/20 + 难度三档）：parse* 容错，practice 不消费
  const targetQuestions = parseTargetQuestions(body.targetQuestions);
  const difficulty = parseDifficulty(body.difficulty);
  const supabase = await createSupabaseServerClient();

  const { data: resume } = await supabase
    .from("resumes")
    .select("id, raw_text, structured_json")
    .eq("id", body.resumeId)
    .eq("user_id", user.id)
    .single();
  if (!resume) return NextResponse.json({ error: COPY.api.resumeNotFound }, { status: 404 });

  const { data: interview, error } = await supabase
    .from("interviews")
    .insert({
      user_id: user.id,
      resume_id: resume.id,
      position: body.position,
      jd_text: body.jdText ?? null,
      interview_type: mode === "real" ? "mixed" : body.interviewType,
      question_count: mode === "real" ? 0 : count,
      status: mode === "real" ? "ready" : "generating",
      mode,
      target_questions: targetQuestions,
      difficulty,
    })
    .select("id")
    .single();
  if (error) {
    return serverErrorResponse("[interview/create] insert interview failed:", error.message, 500);
  }

  // 真实面试：不出卷不建题库，第一题由 start 现场生成（考官「翻档案」的开场感）
  if (mode === "real") {
    return NextResponse.json({ interviewId: interview.id });
  }

  try {
    // B11：画像已结构化的档案不重复跑分析、不重复回写
    const existingProfile = (resume.structured_json as ResumeProfile | null) ?? null;
    const profile = existingProfile ?? (await analyzeResume(user.id, resume.raw_text));
    if (!existingProfile) {
      // 副作用写入一律检查 error：失败走 catch 回滚 draft，避免静默产出打不开的卷
      const { error: profileWriteError } = await supabase
        .from("resumes")
        .update({ structured_json: profile })
        .eq("id", resume.id);
      if (profileWriteError) throw new Error(profileWriteError.message);
    }

    const questions = await generateQuestions(user.id, {
      profile,
      jdText: body.jdText ?? "",
      position: body.position,
      interviewType: body.interviewType,
      count,
    });
    const { error: questionsInsertError } = await supabase
      .from("questions")
      .insert(
        questions.map((q, idx) => ({
          interview_id: interview.id,
          idx,
          content: q.content,
          type: q.type,
          skill_tag: q.skillTag,
          followup_anchor: q.followupAnchor,
        })),
      );
    if (questionsInsertError) throw new Error(questionsInsertError.message);

    // 对账：模型返回题数可能与请求值不等，声明值让位于落库行数
    const { error: readyError } = await supabase
      .from("interviews")
      .update({ status: "ready", question_count: questions.length })
      .eq("id", interview.id);
    if (readyError) throw new Error(readyError.message);
    return NextResponse.json({ interviewId: interview.id });
  } catch (e) {
    await supabase
      .from("interviews")
      .update({ status: "draft" })
      .eq("id", interview.id);
    // NoObjectGeneratedError 携带模型原始输出（.text），带上头部片段便于定位 schema 不匹配的根因
    const raw = typeof (e as { text?: unknown })?.text === "string" ? (e as { text: string }).text : undefined;
    const detail = e instanceof Error ? e.message : String(e);
    if (raw) console.error("[interview/create] raw model output:\n", raw.slice(0, 4000));
    if (!raw) {
      // B1：非 schema 类失败（DB 写入等）——原始 message 只进日志，客户端拿通用文案
      console.error("[interview/create] question set failed:", detail);
      return NextResponse.json({ error: COPY.api.questionSetFailed }, { status: 502 });
    }
    // 诊断拼接逻辑保留（产品决策）：schema 不匹配时带错误描述与模型输出头部
    return NextResponse.json(
      { error: `${detail}（模型输出头部：${raw.slice(0, 300)}…）` },
      { status: 502 },
    );
  }
}
