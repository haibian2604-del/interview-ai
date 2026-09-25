import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { evaluateAnswer } from "@/lib/agents/evaluator";
import { streamInterviewer } from "@/lib/agents/interviewer";
import { averageScore, decideNextAction } from "@/lib/orchestrator/state-machine";
import type { Evaluation } from "@/lib/ai/schemas";
import { rowToQuestion } from "@/lib/interview/mappers";
import { teeWithPersist } from "@/lib/interview/stream-persist";
import { COPY } from "@/lib/copy";

export const maxDuration = 300;

export async function POST(request: Request) {
  // /api/* 不在 middleware 的 PROTECTED 名单内，这里自己兜住未登录（与 /api/resume/parse 同一先例）
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  let body: { interviewId?: string; answer?: string };
  try {
    body = (await request.json()) as { interviewId?: string; answer?: string };
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { interviewId, answer } = body;
  if (!interviewId || typeof answer !== "string" || !answer.trim()) {
    return NextResponse.json({ error: "缺少 interviewId 或 answer" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, status, current_question_index, question_count")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (interviewError) {
    return NextResponse.json({ error: interviewError.message }, { status: 500 });
  }
  if (!interview) {
    return NextResponse.json({ error: COPY.interview.notFound }, { status: 404 });
  }
  if (interview.status !== "in_progress") {
    return NextResponse.json({ error: COPY.interview.notInProgress }, { status: 409 });
  }

  const idx = interview.current_question_index;
  const [{ data: question, error: questionError }, { data: history, error: historyError }] =
    await Promise.all([
      supabase
        .from("questions")
        .select("*")
        .eq("interview_id", interviewId)
        .eq("idx", idx)
        .maybeSingle(),
      supabase
        .from("messages")
        .select("role, content")
        .eq("interview_id", interviewId)
        .order("created_at"),
    ]);
  if (questionError || historyError) {
    return NextResponse.json(
      { error: questionError?.message ?? historyError?.message },
      { status: 500 },
    );
  }
  if (!question) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }

  const followupCount = (history ?? []).filter((m) => m.role === "followup").length;
  const { error: candidateInsertError } = await supabase.from("messages").insert({
    interview_id: interviewId,
    question_id: question.id,
    role: followupCount > 0 ? "followup" : "candidate",
    content: answer,
  });
  if (candidateInsertError) {
    return NextResponse.json({ error: candidateInsertError.message }, { status: 500 });
  }

  // 评估 Agent（独立人格，只看题目与回答原文）；DB 行先过 camelCase 映射铁律
  let evaluation: Evaluation;
  try {
    evaluation = await evaluateAnswer({
      question: rowToQuestion(question),
      transcript: [
        ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
        { role: "candidate", content: answer },
      ],
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "评估失败" },
      { status: 502 },
    );
  }
  const { error: upsertError } = await supabase.from("evaluations").upsert(
    {
      question_id: question.id,
      scores: evaluation.scores,
      star_completeness: evaluation.starCompleteness,
      strengths: evaluation.strengths,
      improvements: evaluation.improvements,
    },
    { onConflict: "question_id" },
  );
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  // 编排器确定性决策（唯一事实来源）
  const next = decideNextAction({
    score: averageScore(evaluation.scores),
    followupCount,
    isLastQuestion: idx === interview.question_count - 1,
  });

  if (next.action === "finish") {
    const { error } = await supabase
      .from("interviews")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", interviewId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (next.action === "next_question") {
    const { error } = await supabase
      .from("interviews")
      .update({ current_question_index: idx + 1 })
      .eq("id", interviewId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 组装面试官话术 payload
  const typedHistory = (history ?? []) as {
    role: "interviewer" | "candidate" | "followup";
    content: string;
  }[];
  const payload: Parameters<typeof streamInterviewer>[1] = {
    question: rowToQuestion(question),
    history: [...typedHistory, { role: "candidate" as const, content: answer }],
    followupText: `针对回答的不足（${evaluation.improvements}），围绕追问锚点「${question.followup_anchor}」提出一个具体追问。`,
  };
  if (next.action === "next_question") {
    const { data: nextQuestion, error: nextQuestionError } = await supabase
      .from("questions")
      .select("*")
      .eq("interview_id", interviewId)
      .eq("idx", idx + 1)
      .maybeSingle();
    if (nextQuestionError) {
      return NextResponse.json({ error: nextQuestionError.message }, { status: 500 });
    }
    payload.nextQuestion = nextQuestion ? rowToQuestion(nextQuestion) : undefined;
  }

  let result: ReturnType<typeof streamInterviewer>;
  try {
    result = streamInterviewer(
      next.action === "followup" ? "followup" : "transition",
      payload,
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : COPY.interview.llmFailed },
      { status: 502 },
    );
  }

  // 旁路累积全文，流结束后落盘面试官消息；同时通过自定义头告知编排结果与批改分
  const textStreamForClient = teeWithPersist(
    result.textStream,
    async (full) => {
      const { error } = await supabase.from("messages").insert({
        interview_id: interviewId,
        question_id: question.id,
        role: "interviewer",
        content: full,
      });
      if (error) throw new Error(error.message);
    },
    "interview/answer",
  );

  return new Response(textStreamForClient, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Interview-Action": next.action,
      "X-Interview-Scores": JSON.stringify({
        scores: evaluation.scores,
        starCompleteness: evaluation.starCompleteness,
      }),
    },
  });
}
