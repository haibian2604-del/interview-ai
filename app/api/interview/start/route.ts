import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { streamInterviewer } from "@/lib/agents/interviewer";
import { rowToQuestion } from "@/lib/interview/mappers";
import { teeWithPersist } from "@/lib/interview/stream-persist";
import { COPY } from "@/lib/copy";

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
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const { interviewId } = body;
  if (!interviewId) {
    return NextResponse.json({ error: "缺少 interviewId" }, { status: 400 });
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
      return NextResponse.json({ error: firstMessageError.message }, { status: 500 });
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
    return NextResponse.json({ error: questionError.message }, { status: 500 });
  }
  if (!question) {
    return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  }

  if (interview.status === "ready") {
    const { error: updateError } = await supabase
      .from("interviews")
      .update({ status: "in_progress" })
      .eq("id", interviewId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : COPY.interview.llmFailed },
      { status: 502 },
    );
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
