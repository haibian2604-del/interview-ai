import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { evaluateAnswer } from "@/lib/agents/evaluator";
import { streamInterviewer } from "@/lib/agents/interviewer";
import { averageScore, decideNextAction, type NextAction } from "@/lib/orchestrator/state-machine";
import { decideRealNextAction } from "@/lib/orchestrator/real-mode";
import { loadCompositeScores } from "@/lib/interview/scores";
import type { Evaluation } from "@/lib/ai/schemas";
import { rowToQuestion, questionFollowupCount, toAgentRole, type AgentRole } from "@/lib/interview/mappers";
import { teeWithPersist } from "@/lib/interview/stream-persist";
import { COPY } from "@/lib/copy";
import { serverErrorResponse } from "@/lib/api/server-error";

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
    return NextResponse.json({ error: COPY.api.invalidJson }, { status: 400 });
  }
  const { interviewId, answer } = body;
  if (!interviewId || typeof answer !== "string" || !answer.trim()) {
    return NextResponse.json({ error: COPY.api.missingInterviewIdOrAnswer }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, status, current_question_index, question_count, mode")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (interviewError) {
    return serverErrorResponse("[interview/answer] load interview failed:", interviewError.message, 500);
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
        .select("role, content, question_id")
        .eq("interview_id", interviewId)
        .order("created_at"),
    ]);
  if (questionError || historyError) {
    const message = questionError?.message ?? historyError?.message ?? "";
    return serverErrorResponse("[interview/answer] load question/history failed:", message, 500);
  }
  if (!question) {
    return NextResponse.json({ error: COPY.api.questionNotFound }, { status: 404 });
  }

  // C1：按「本题」计追问轮（状态机契约），不能用全场 followup 行数
  const followupCount = questionFollowupCount(history ?? [], question.id);
  const { data: insertedMessage, error: candidateInsertError } = await supabase
    .from("messages")
    .insert({
      interview_id: interviewId,
      question_id: question.id,
      role: followupCount > 0 ? "followup" : "candidate",
      content: answer,
    })
    .select("id")
    .single();
  if (candidateInsertError || !insertedMessage) {
    return serverErrorResponse(
      "[interview/answer] insert candidate message failed",
      candidateInsertError ?? new Error("inserted message missing"),
    );
  }

  // C2：追问轮回答（role=followup）也是候选人的原话，喂 Agent 前归一，
  // 否则评估里被标成「面试官：」、面试官对话史里被当成 assistant 自己的话
  const agentHistory: { role: AgentRole; content: string }[] = (history ?? []).map(
    (m) => ({ role: toAgentRole(m.role), content: m.content }),
  );

  // 评估 Agent（独立人格，只看题目与回答原文）；DB 行先过 camelCase 映射铁律
  let evaluation: Evaluation;
  try {
    evaluation = await evaluateAnswer(user.id, {
      question: rowToQuestion(question),
      transcript: [...agentHistory, { role: "candidate", content: answer }],
    });
  } catch (e) {
    // I1：评估失败回滚刚插入的 candidate 行——重试不重复落盘、transcript 不被污染
    const { error: rollbackError } = await supabase
      .from("messages")
      .delete()
      .eq("id", insertedMessage.id);
    if (rollbackError) {
      console.error("[interview/answer] rollback candidate message failed:", rollbackError.message);
    }
    // B1：评估失败原因（可能含上游网关细节）只进服务端日志，客户端拿通用文案
    return serverErrorResponse("[interview/answer]", e, 502);
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
    return serverErrorResponse("[interview/answer] upsert evaluation failed:", upsertError.message, 500);
  }

  // 编排器确定性决策（唯一事实来源）。real 模式：追问优先于终止；结束只来自终止规则引擎。
  let next: NextAction;
  let endEarly = false;
  if (interview.mode === "real") {
    const composites = await loadCompositeScores(supabase, interviewId);
    const real = decideRealNextAction({
      score: averageScore(evaluation.scores),
      followupCount,
      composites,
    });
    next = real.action;
    endEarly = real.endEarly;
  } else {
    next = decideNextAction({
      score: averageScore(evaluation.scores),
      followupCount,
      isLastQuestion: idx === interview.question_count - 1,
    });
  }

  if (next.action === "finish") {
    const { error } = await supabase
      .from("interviews")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", interviewId);
    if (error) {
      return serverErrorResponse("[interview/answer] mark completed failed:", error.message, 500);
    }
  } else if (next.action === "next_question" && interview.mode !== "real") {
    const { error } = await supabase
      .from("interviews")
      .update({ current_question_index: idx + 1 })
      .eq("id", interviewId);
    if (error) {
      return serverErrorResponse("[interview/answer] advance question failed:", error.message, 500);
    }
  }

  // 组装面试官话术 payload（history 用 C2 归一后的角色：followup 轮回答也是候选人）
  const payload: Parameters<typeof streamInterviewer>[2] = {
    question: rowToQuestion(question),
    history: [...agentHistory, { role: "candidate" as const, content: answer }],
    followupText: `针对回答的不足（${evaluation.improvements}），围绕追问锚点「${question.followup_anchor}」提出一个具体追问。`,
  };
  if (next.action === "next_question" && interview.mode !== "real") {
    const { data: nextQuestion, error: nextQuestionError } = await supabase
      .from("questions")
      .select("*")
      .eq("interview_id", interviewId)
      .eq("idx", idx + 1)
      .maybeSingle();
    if (nextQuestionError) {
      return serverErrorResponse("[interview/answer] load next question failed:", nextQuestionError.message, 500);
    }
    payload.nextQuestion = nextQuestion ? rowToQuestion(nextQuestion) : undefined;
  }

  let result: Awaited<ReturnType<typeof streamInterviewer>>;
  try {
    const interviewerMode =
      next.action === "followup"
        ? "followup"
        : next.action === "finish"
          ? "transition"
          : interview.mode === "real"
            ? "comment"
            : "transition";
    result = await streamInterviewer(user.id, interviewerMode, payload);
  } catch (e) {
    return serverErrorResponse("[interview/answer]", e, 502);
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
    COPY.interview.streamInterrupted,
  );

  return new Response(textStreamForClient, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Interview-Action": next.action,
      "X-Interview-Scores": JSON.stringify({
        scores: evaluation.scores,
        starCompleteness: evaluation.starCompleteness,
      }),
      ...(interview.mode === "real" && next.action === "next_question"
        ? { "X-Interview-Next": "generate" }
        : {}),
      ...(endEarly ? { "X-Interview-End": "early" } : {}),
    },
  });
}
