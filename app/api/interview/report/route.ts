import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { generateReport } from "@/lib/agents/report-writer";
import type { Evaluation } from "@/lib/ai/schemas";
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
  const { interviewId } = (await request.json()) as { interviewId: string };
  const supabase = await createSupabaseServerClient();

  const { data: interview } = await supabase
    .from("interviews")
    .select("id, position, status")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .single();
  if (!interview) return NextResponse.json({ error: "面试不存在" }, { status: 404 });

  // 幂等：已有报告直接返回
  const { data: existing } = await supabase
    .from("reports").select("id").eq("interview_id", interviewId).maybeSingle();
  if (existing) return NextResponse.json({ reportId: existing.id });

  // 先查题目（带 id），再按 question_id 查评估，按 idx 对齐
  const { data: questions } = await supabase
    .from("questions").select("id, idx, content")
    .eq("interview_id", interviewId).order("idx");
  // 零题（draft/generating 面试）不进报告生成：PostgREST 空 in() 列表会 400，
  // 且没有题目的面试永远谈不上「阅卷完成」，语义同未完成 → 409
  if (!questions || questions.length === 0) {
    return NextResponse.json({ error: "存在未评估的题目，面试尚未完成" }, { status: 409 });
  }
  const qIds = questions.map((q) => q.id);
  const { data: evalRows } = await supabase
    .from("evaluations")
    .select("question_id, scores, star_completeness, strengths, improvements")
    .in("question_id", qIds);

  const byQuestion = new Map((evalRows ?? []).map((e) => [e.question_id, e]));
  const aligned: Evaluation[] = [];
  for (const q of questions) {
    const e = byQuestion.get(q.id);
    if (!e) return NextResponse.json({ error: "存在未评估的题目，面试尚未完成" }, { status: 409 });
    aligned.push({
      scores: e.scores as Evaluation["scores"],
      starCompleteness: Number(e.star_completeness),
      strengths: e.strengths,
      improvements: e.improvements,
    });
  }

  const report = await generateReport(user.id, {
    position: interview.position,
    questionContents: questions.map((q) => q.content),
    evaluations: aligned,
  });

  const { data: inserted, error } = await supabase
    .from("reports")
    .insert({
      interview_id: interviewId,
      overall_score: report.overallScore,
      dimension_scores: report.dimensionScores,
      summary_md: report.summary,
      strengths_md: report.strengths,
      improvements_md: report.improvements,
    })
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ reportId: inserted.id });
}
