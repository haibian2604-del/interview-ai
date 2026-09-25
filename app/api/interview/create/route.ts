import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { analyzeResume } from "@/lib/agents/resume-analyst";
import { generateQuestions } from "@/lib/agents/question-setter";
import type { ResumeProfile } from "@/lib/ai/schemas";
import { clampQuestionCount } from "@/lib/interview/count";
import { COPY } from "@/lib/copy";

export const maxDuration = 120;

export async function POST(request: Request) {
  // /api/* 不在 middleware 的 PROTECTED 名单内，这里自己兜住未登录（与 /api/resume/parse 同一先例）
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }
  const body = (await request.json()) as {
    resumeId: string;
    position: string;
    jdText?: string;
    interviewType: "skill" | "project" | "behavioral" | "mixed";
    questionCount?: number;
  };
  // 服务端钳制：请求值不可信，题库对账以落库事实为准（见 lib/interview/count.ts）
  const count = clampQuestionCount(body.questionCount);
  const supabase = await createSupabaseServerClient();

  const { data: resume } = await supabase
    .from("resumes")
    .select("id, raw_text, structured_json")
    .eq("id", body.resumeId)
    .eq("user_id", user.id)
    .single();
  if (!resume) return NextResponse.json({ error: "简历不存在" }, { status: 404 });

  const { data: interview, error } = await supabase
    .from("interviews")
    .insert({
      user_id: user.id,
      resume_id: resume.id,
      position: body.position,
      jd_text: body.jdText ?? null,
      interview_type: body.interviewType,
      question_count: count,
      status: "generating",
    })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  try {
    const profile = (resume.structured_json as ResumeProfile | null) ??
      await analyzeResume(resume.raw_text);
    // 副作用写入一律检查 error：失败走 catch 回滚 draft，避免静默产出打不开的卷
    const { error: profileWriteError } = await supabase
      .from("resumes")
      .update({ structured_json: profile })
      .eq("id", resume.id);
    if (profileWriteError) throw new Error(profileWriteError.message);

    const questions = await generateQuestions({
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "出题失败" },
      { status: 502 },
    );
  }
}
