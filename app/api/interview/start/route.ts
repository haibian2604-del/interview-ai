import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { streamInterviewer } from "@/lib/agents/interviewer";
import { generateNextQuestion } from "@/lib/agents/question-setter";
import { parseDifficulty } from "@/lib/orchestrator/real-mode";
import { loadInterviewProfile } from "@/lib/interview/profile";
import type { Question, ResumeProfile } from "@/lib/ai/schemas";
import { rowToQuestion } from "@/lib/interview/mappers";
import { teeWithPersist } from "@/lib/interview/stream-persist";
import { COPY } from "@/lib/copy";
import { serverErrorResponse } from "@/lib/api/server-error";

export const maxDuration = 300;

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  let body: { interviewId?: string };
  try {
    body = (await request.json()) as { interviewId?: string };
  } catch {
    return NextResponse.json({ error: COPY.api.invalidJson }, { status: 400 });
  }
  const { interviewId } = body;
  if (!interviewId) {
    return NextResponse.json({ error: COPY.api.missingInterviewId }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, status, current_question_index, question_count, mode, resume_id, position, jd_text, target_questions, difficulty")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (interviewError) {
    return serverErrorResponse("[interview/start] load interview failed:", interviewError.message, 500);
  }
  if (!interview) {
    return NextResponse.json({ error: COPY.interview.notFound }, { status: 404 });
  }

  // 幂等：已开考时返回已有第一条面试官消息，不重复开播
  if (interview.status === "in_progress") {
    const { data: firstMessage, error: firstMessageError } = await supabase
      .from("messages")
      .select("content")
      .eq("interview_id", interviewId)
      .eq("role", "interviewer")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (firstMessageError) {
      return serverErrorResponse("[interview/start] load first message failed:", firstMessageError.message, 500);
    }
    if (firstMessage) {
      return NextResponse.json({
        resumed: true,
        firstMessage: firstMessage.content,
      });
    }
    // in_progress 但一条面试官消息都没有：上次开场流被打断，落回重播第一题
  } else if (interview.status !== "ready") {
    return NextResponse.json({ error: COPY.interview.notInProgress }, { status: 409 });
  }

  const { data: loadedQuestion, error: questionError } = await supabase
    .from("questions")
    .select("*")
    .eq("interview_id", interviewId)
    .eq("idx", interview.current_question_index)
    .maybeSingle();
  if (questionError) {
    return serverErrorResponse("[interview/start] load question failed:", questionError.message, 500);
  }
  let question = loadedQuestion;

  // 真实面试：首题现场生成（ready 且题库为空时）。并发双开场靠 questions(interview_id, idx)
  // 唯一索引兜底：后到方 insert 23505 后改读已有行。
  if (interview.mode === "real" && !question) {
    if (interview.status !== "ready") {
      return NextResponse.json({ error: COPY.api.questionNotFound }, { status: 404 });
    }
    // 画像分析与出题都会调 LLM：失败走 502 统一出口（原始错误只进日志），不让路由裸抛
    let profile: ResumeProfile;
    let generated: Question;
    try {
      profile = await loadInterviewProfile(supabase, user.id, interview.resume_id);
      generated = await generateNextQuestion(user.id, {
        profile,
        jdText: interview.jd_text ?? "",
        position: interview.position,
        askedQuestions: [],
        target: interview.target_questions,
        difficulty: parseDifficulty(interview.difficulty),
      });
    } catch (e) {
      return serverErrorResponse("[interview/start] generate first question failed:", e, 502);
    }
    const { data: inserted, error: insertError } = await supabase
      .from("questions")
      .insert({
        interview_id: interviewId,
        idx: 0,
        content: generated.content,
        type: generated.type,
        skill_tag: generated.skillTag,
        followup_anchor: generated.followupAnchor,
      })
      .select("*")
      .single();
    // 唯一索引兜底：并发双开场时后到方读已有行
    const row = inserted ?? (
      await supabase
        .from("questions")
        .select("*")
        .eq("interview_id", interviewId)
        .eq("idx", 0)
        .single()
    ).data;
    if (!row) {
      return serverErrorResponse("[interview/start] insert first question failed:", insertError?.message ?? "no row", 500);
    }
    const { error: countError } = await supabase
      .from("interviews")
      .update({ question_count: 1 })
      .eq("id", interviewId);
    if (countError) {
      return serverErrorResponse("[interview/start] update question_count failed:", countError.message, 500);
    }
    question = row;
  }

  if (!question) {
    return NextResponse.json({ error: COPY.api.questionNotFound }, { status: 404 });
  }

  if (interview.status === "ready") {
    // B4：状态条件守卫——双标签页同时开场时，后到的 update 因 status 已离开 ready 而 0 行生效，
    // 不会覆盖先到方已写入的 in_progress
    const { error: updateError } = await supabase
      .from("interviews")
      .update({ status: "in_progress" })
      .eq("id", interviewId)
      .eq("status", "ready");
    if (updateError) {
      return serverErrorResponse("[interview/start] mark in_progress failed:", updateError.message, 500);
    }
  }

  let result: Awaited<ReturnType<typeof streamInterviewer>>;
  try {
    result = await streamInterviewer(user.id, "ask", {
      question: rowToQuestion(question),
      history: [],
      followupText: null,
    });
  } catch (e) {
    return serverErrorResponse("[interview/start]", e, 502);
  }

  // 旁路累积全文，流结束后落盘面试官消息
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
    "interview/start",
  );

  return new Response(textStreamForClient, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Interview-Action": "ask",
    },
  });
}
