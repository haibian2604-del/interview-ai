import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { ChatStream } from "@/components/interview/chat-stream";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
import { BackButton } from "@/components/back-button";
import {
  deriveChatMessages,
  type StampData,
} from "@/lib/interview/mappers";
import { COPY } from "@/lib/copy";

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 页面在 middleware PROTECTED 名单内，这里再兜一层归属校验
  let user;
  try {
    user = await requireUser();
  } catch {
    redirect("/login");
  }

  const supabase = await createSupabaseServerClient();
  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, position, status, current_question_index, question_count")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (interviewError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-10 py-14">
        <ErrorAnnotation text={COPY.interview.loadFailed} />
      </main>
    );
  }
  if (!interview) notFound();

  const [{ data: questionRows, error: questionsError }, { data: messageRows, error: messagesError }] =
    await Promise.all([
      supabase
        .from("questions")
        .select("id, idx, content, skill_tag")
        .eq("interview_id", id)
        .order("idx"),
      supabase
        .from("messages")
        .select("id, role, content, question_id")
        .eq("interview_id", id)
        .order("created_at"),
    ]);

  if (questionsError || messagesError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-10 py-14">
        <ErrorAnnotation text={COPY.interview.loadFailed} />
      </main>
    );
  }

  const questionIdxById = new Map<string, number>(
    (questionRows ?? []).map((q) => [q.id, q.idx]),
  );
  const questions = (questionRows ?? []).map((q) => ({
    content: q.content,
    skillTag: q.skill_tag,
  }));
  const initialMessages = deriveChatMessages(messageRows ?? [], questionIdxById);

  // 已落盘的批改分（卷面还原：刷新后分数章原样归来）
  const questionIds = (questionRows ?? []).map((q) => q.id);
  const initialStamps: Record<number, StampData> = {};
  if (questionIds.length > 0) {
    const { data: evaluationRows, error: evaluationsError } = await supabase
      .from("evaluations")
      .select("question_id, scores, star_completeness")
      .in("question_id", questionIds);
    if (evaluationsError) {
      return (
        <main className="mx-auto w-full max-w-3xl px-10 py-14">
          <ErrorAnnotation text={COPY.interview.loadFailed} />
        </main>
      );
    }
    for (const e of evaluationRows ?? []) {
      const idx = questionIdxById.get(e.question_id);
      if (idx === undefined) continue;
      initialStamps[idx] = {
        scores: e.scores as StampData["scores"],
        starCompleteness: Number(e.star_completeness),
      };
    }
  }

  const initialFollowupIdxs = [
    ...new Set(
      initialMessages
        .filter((m) => m.role === "followup")
        .map((m) => m.questionIdx)
        .filter((x): x is number => x !== null),
    ),
  ];

  // 出卷未完成（draft/generating）时不开考卷
  if (interview.status === "draft" || interview.status === "generating") {
    return (
      <main className="mx-auto w-full max-w-3xl px-10 py-14">
        <ErrorAnnotation text={COPY.interview.notInProgress} />
      </main>
    );
  }

  const copy = COPY.interview;

  return (
    <main className="flex min-h-screen flex-col bg-paper text-ink">
      <BackButton className="mb-6" />
      {/* 卷首 */}
      <header className="border-b border-ink/15 px-10 py-5">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
            {copy.headerLabel}
          </p>
          <h1 className="font-heading text-xl font-semibold tracking-wide">
            {interview.position}
          </h1>
          <p className="ml-auto font-mono text-xs tabular-nums text-pencil">
            {COPY.common.volumeNo.replace("{no}", interview.id.slice(0, 8))}
          </p>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col px-10 py-8">
        <ChatStream
          interviewId={interview.id}
          initialStatus={interview.status}
          initialCurrentIndex={interview.current_question_index}
          initialMessages={initialMessages}
          questions={questions}
          initialStamps={initialStamps}
          initialFollowupIdxs={initialFollowupIdxs}
        />
      </div>
    </main>
  );
}
