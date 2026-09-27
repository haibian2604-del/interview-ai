import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { generateNextQuestion } from "@/lib/agents/question-setter";
import { loadInterviewProfile } from "@/lib/interview/profile";
import { loadCompositeScores } from "@/lib/interview/scores";
import { rowToQuestion } from "@/lib/interview/mappers";
import { checkTermination } from "@/lib/orchestrator/real-mode";
import { teeWithPersist } from "@/lib/interview/stream-persist";
import { COPY } from "@/lib/copy";
import { serverErrorResponse } from "@/lib/api/server-error";
import { streamInterviewer } from "@/lib/agents/interviewer";

export const maxDuration = 300;

/** 真实面试专用：现场生成下一题并流式题干。practice 调用 → 409。 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: interviewId } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, status, current_question_index, mode, resume_id, position, jd_text")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (interviewError) {
    return serverErrorResponse("[interview/next-question] load interview failed:", interviewError.message, 500);
  }
  if (!interview) return NextResponse.json({ error: COPY.interview.notFound }, { status: 404 });
  if (interview.mode !== "real" || interview.status !== "in_progress") {
    return NextResponse.json({ error: COPY.interview.notInProgress }, { status: 409 });
  }

  // 双重检查终止规则（answer 已查过一次；这里是竞态兜底——已该收尾时不再生成新题）
  const composites = await loadCompositeScores(supabase, interviewId);
  if (checkTermination(composites).terminate) {
    return NextResponse.json({ error: COPY.interview.notInProgress }, { status: 409 });
  }

  const idx = interview.current_question_index;
  const nextIdx = idx + 1;

  // 竞态/重试兜底：该题已存在（唯一索引）→ 不重复生成不重复落盘
  const { data: existing } = await supabase
    .from("questions")
    .select("*")
    .eq("interview_id", interviewId)
    .eq("idx", nextIdx)
    .maybeSingle();
  if (existing) {
    const advanced = await advanceInterview(supabase, interviewId, nextIdx);
    if (advanced) {
      return serverErrorResponse("[interview/next-question] advance on duplicate failed:", advanced.message, 500);
    }
    const meta = { idx: nextIdx, skillTag: existing.skill_tag, content: existing.content };
    return NextResponse.json(
      { duplicate: true, meta },
      { headers: { "X-Question-Meta": encodeURIComponent(JSON.stringify(meta)) } },
    );
  }

  let generated;
  try {
    const profile = await loadInterviewProfile(supabase, user.id, interview.resume_id);
    const { data: askedRows } = await supabase
      .from("questions")
      .select("content, skill_tag")
      .eq("interview_id", interviewId)
      .order("idx");
    // 最近一轮问答（顺延候选人暴露的点深挖）：最后一条候选人消息
    const { data: lastCandidate } = await supabase
      .from("messages")
      .select("content")
      .eq("interview_id", interviewId)
      .in("role", ["candidate", "followup"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    generated = await generateNextQuestion(user.id, {
      profile,
      jdText: interview.jd_text ?? "",
      position: interview.position,
      askedQuestions: (askedRows ?? []).map((q) => ({ content: q.content, skillTag: q.skill_tag })),
      lastExchange: lastCandidate
        ? { question: (askedRows ?? [])[idx]?.content ?? "", answer: lastCandidate.content }
        : undefined,
    });
  } catch (e) {
    return serverErrorResponse("[interview/next-question] generate question failed:", e, 502);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("questions")
    .insert({
      interview_id: interviewId,
      idx: nextIdx,
      content: generated.content,
      type: generated.type,
      skill_tag: generated.skillTag,
      followup_anchor: generated.followupAnchor,
    })
    .select("*")
    .single();
  if (insertError) {
    // 唯一索引兜底：并发重试时后到方读已有行，返回 duplicate 而非报错
    if (insertError.code === "23505") {
      const { data: row } = await supabase
        .from("questions")
        .select("*")
        .eq("interview_id", interviewId)
        .eq("idx", nextIdx)
        .single();
      if (row) {
        const advanced = await advanceInterview(supabase, interviewId, nextIdx);
        if (advanced) {
          return serverErrorResponse("[interview/next-question] advance on duplicate failed:", advanced.message, 500);
        }
        const meta = { idx: nextIdx, skillTag: row.skill_tag, content: row.content };
        return NextResponse.json(
          { duplicate: true, meta },
          { headers: { "X-Question-Meta": encodeURIComponent(JSON.stringify(meta)) } },
        );
      }
    }
    return serverErrorResponse("[interview/next-question] insert question failed:", insertError.message, 500);
  }

  // real 模式索引推进的唯一入口（answer 的 real 分支不推进）：落题即指向新题，
  // 保证下一轮 answer 按新题落账；question_count 与推进同事务语义一次性更新
  const advanceError = await advanceInterview(supabase, interviewId, nextIdx);
  if (advanceError) {
    return serverErrorResponse("[interview/next-question] advance interview failed:", advanceError.message, 500);
  }

  let result: Awaited<ReturnType<typeof streamInterviewer>>;
  try {
    result = await streamInterviewer(user.id, "ask", {
      question: rowToQuestion(inserted),
      history: [],
      followupText: null,
    });
  } catch (e) {
    return serverErrorResponse("[interview/next-question]", e, 502);
  }

  const textStreamForClient = teeWithPersist(
    result.textStream,
    async (full) => {
      const { error } = await supabase.from("messages").insert({
        interview_id: interviewId,
        question_id: inserted.id,
        role: "interviewer",
        content: full,
      });
      if (error) throw new Error(error.message);
    },
    "interview/next-question",
  );

  const meta = { idx: nextIdx, skillTag: inserted.skill_tag, content: inserted.content };
  return new Response(textStreamForClient, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Interview-Action": "ask",
      "X-Question-Meta": encodeURIComponent(JSON.stringify(meta)),
    },
  });
}

/**
 * 落题后的面试行推进（question_count + current_question_index 一次更新）。
 * 幂等：duplicate 兜底路径与主路径可能重复执行，写入值相同无副作用。
 */
async function advanceInterview(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  interviewId: string,
  nextIdx: number,
) {
  const { error } = await supabase
    .from("interviews")
    .update({ question_count: nextIdx + 1, current_question_index: nextIdx })
    .eq("id", interviewId);
  return error;
}
