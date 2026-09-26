import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { streamInterviewer } from "@/lib/agents/interviewer";
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
    .select("id, status, current_question_index, question_count")
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

  const { data: question, error: questionError } = await supabase
    .from("questions")
    .select("*")
    .eq("interview_id", interviewId)
    .eq("idx", interview.current_question_index)
    .maybeSingle();
  if (questionError) {
    return serverErrorResponse("[interview/start] load question failed:", questionError.message, 500);
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
