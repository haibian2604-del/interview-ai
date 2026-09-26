import { notFound, redirect } from "next/navigation";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { ScoreRadar, type DimensionKey } from "@/components/report/score-radar";
import { GenerateReportButton } from "@/components/report/generate-report-button";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
import { BackButton } from "@/components/back-button";
import { COPY } from "@/lib/copy";

const DIMENSION_KEYS = ["relevance", "depth", "structure", "communication"] as const;

type ReportView = {
  overallScore: number;
  dimensionScores: Record<DimensionKey, number>;
  summary: string;
  strengths: string;
  improvements: string;
};

type QuestionAnnotation = {
  idx: number;
  content: string;
  scores: Record<DimensionKey, number>;
  strengths: string;
  improvements: string;
};

export const metadata = { title: COPY.report.title };

export default async function ReportPage({
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
    .select("id, position, status")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (interviewError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-10 py-14">
        <ErrorAnnotation text={COPY.report.loadFailed} />
      </main>
    );
  }
  if (!interview) notFound();

  const { data: reportRow, error: reportError } = await supabase
    .from("reports")
    .select("overall_score, dimension_scores, summary_md, strengths_md, improvements_md")
    .eq("interview_id", id)
    .maybeSingle();
  if (reportError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-10 py-14">
        <ErrorAnnotation text={COPY.report.loadFailed} />
      </main>
    );
  }

  const copy = COPY.report;
  const header = (
    <header className="border-b border-ink/15 px-10 py-5">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-baseline gap-x-6 gap-y-1">
        <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
          {copy.headerLabel}
        </p>
        <h1 className="font-heading text-xl font-semibold tracking-wide">
          {interview.position}
        </h1>
        <p className="ml-auto font-mono text-xs tabular-nums text-pencil">
          卷号 {interview.id.slice(0, 8)}
        </p>
      </div>
    </header>
  );

  // 空态：无报告。completed → 「誊写评分报告」按钮；否则（进行中 / 缺考 / 出卷中）无可评卷
  if (!reportRow) {
    const completed = interview.status === "completed";
    return (
      <main className="flex min-h-screen flex-col bg-paper text-ink">
        {header}
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-10 py-16">
          {completed ? (
            <div className="w-full max-w-lg border border-ink/20 px-10 py-12 text-center">
              <p className="font-mono text-xs tracking-[0.35em] text-pencil">
                {copy.headerLabel}
              </p>
              <h2 className="mt-3 font-heading text-2xl font-semibold tracking-wide">
                {copy.emptyTitle}
              </h2>
              <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-ink/60">
                {copy.emptyHint}
              </p>
              <div className="mt-6 flex justify-center">
                <GenerateReportButton interviewId={interview.id} />
              </div>
            </div>
          ) : (
            <ErrorAnnotation text={copy.notCompleted} />
          )}
        </div>
      </main>
    );
  }

  // 有报告：取逐题批注（questions 按 idx，evaluations 按 question_id 对齐）
  const { data: questionRows, error: questionsError } = await supabase
    .from("questions")
    .select("id, idx, content")
    .eq("interview_id", id)
    .order("idx");
  if (questionsError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-10 py-14">
        <ErrorAnnotation text={COPY.report.loadFailed} />
      </main>
    );
  }
  const questionIds = (questionRows ?? []).map((q) => q.id);
  let evalRows: { question_id: string; scores: unknown; strengths: string; improvements: string }[] | null =
    null;
  let evalsError: { message: string } | null = null;
  if (questionIds.length > 0) {
    const res = await supabase
      .from("evaluations")
      .select("question_id, scores, strengths, improvements")
      .in("question_id", questionIds);
    evalRows = res.data;
    evalsError = res.error;
  }
  if (evalsError) {
    return (
      <main className="mx-auto w-full max-w-3xl px-10 py-14">
        <ErrorAnnotation text={COPY.report.loadFailed} />
      </main>
    );
  }

  const evaluationByQuestion = new Map(
    (evalRows ?? []).map((e) => [e.question_id, e]),
  );
  const annotations: QuestionAnnotation[] = (questionRows ?? []).map((q) => {
    const e = evaluationByQuestion.get(q.id);
    return {
      idx: q.idx,
      content: q.content,
      scores: (e?.scores ?? {}) as Record<DimensionKey, number>,
      strengths: e?.strengths ?? "",
      improvements: e?.improvements ?? "",
    };
  });

  const report: ReportView = {
    overallScore: Number(reportRow.overall_score),
    dimensionScores: reportRow.dimension_scores as Record<DimensionKey, number>,
    summary: reportRow.summary_md,
    strengths: reportRow.strengths_md,
    improvements: reportRow.improvements_md,
  };

  return (
    <main className="flex min-h-screen flex-col bg-paper text-ink">
      <BackButton className="mb-6" />
      {header}

      <div className="mx-auto w-full max-w-6xl flex-1 px-10 pb-16 pt-10">
        {/* 卷首：总分大号印章（缓入落章）+ 四维雷达（先偏差后数值） */}
        <section className="grid items-center gap-10 border border-ink/20 px-8 py-10 lg:grid-cols-[auto_minmax(0,1fr)]">
          <div className="flex justify-center">
            <div className="mirror-stamp-in inline-block -rotate-2 border-2 border-ink-red px-2 py-2 text-ink-red">
              <div className="border border-ink-red/50 px-10 py-8 text-center">
                <p className="font-mono text-xs tracking-[0.35em]">{copy.overallLabel}</p>
                <p className="mt-2 font-mono text-7xl font-semibold leading-none tabular-nums">
                  {Math.round(report.overallScore)}
                </p>
                <p className="mt-3 font-mono text-xs text-ink-red/70">{copy.fullMarkLabel}</p>
              </div>
            </div>
          </div>
          <ScoreRadar dimensionScores={report.dimensionScores} />
        </section>

        {/* 逐题批注卡：题号 + 题干 + 四维分框 + 黑墨亮点 / 红墨不足（附具体改法） */}
        <section className="mt-12">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b-2 border-ink pb-3">
            <h2 className="font-heading text-lg font-semibold tracking-wide">
              {copy.perQuestionTitle}
            </h2>
            <p className="font-mono text-xs text-pencil">{copy.perQuestionHint}</p>
          </div>
          <div className="mt-5 space-y-5">
            {annotations.map((a) => (
              <article key={a.idx} className="border border-ink/20">
                <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-ink/15 px-5 py-3">
                  <span className="shrink-0 font-mono text-xs tracking-[0.3em] text-pencil">
                    {copy.questionLabelPrefix} {a.idx + 1} {copy.questionLabelSuffix}
                  </span>
                  <h3 className="min-w-0 flex-1 text-[15px] font-bold leading-6">{a.content}</h3>
                </header>
                <div className="px-5 py-4">
                  <div className="inline-block border border-ink-red/70 px-3 py-2 text-ink-red">
                    <p className="font-mono text-[10px] tracking-[0.35em]">{copy.scoresLabel}</p>
                    <dl className="mt-1.5 grid grid-cols-4 gap-x-5 gap-y-1">
                      {DIMENSION_KEYS.map((key) => (
                        <div key={key}>
                          <dt className="text-[10px] text-ink-red/80">
                            {COPY.interview.dimensions[key]}
                          </dt>
                          <dd className="font-mono text-sm tabular-nums">
                            {Number(a.scores[key]).toFixed(2)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">
                    <div>
                      <p className="font-mono text-[10px] tracking-[0.35em] text-pencil">
                        {copy.strengthsLabel}
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-ink pl-3 text-sm leading-6 text-ink">
                        {a.strengths}
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] tracking-[0.35em] text-ink-red/70">
                        {copy.improvementsLabel}
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap border-l-2 border-ink-red pl-3 text-sm leading-6 text-ink-red">
                        {a.improvements}
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* 底部：教练评语三段（黑墨印刷，whitespace-pre-wrap） */}
        <section className="mt-12 border border-ink/20">
          <header className="border-b border-ink/15 px-5 py-3">
            <h2 className="font-heading text-lg font-semibold tracking-wide">
              {copy.coachTitle}
            </h2>
          </header>
          <div className="px-5">
            <div className="border-b border-ink/10 py-5">
              <p className="font-mono text-[10px] tracking-[0.35em] text-pencil">
                {copy.coachSummaryLabel}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7">{report.summary}</p>
            </div>
            <div className="border-b border-ink/10 py-5">
              <p className="font-mono text-[10px] tracking-[0.35em] text-pencil">
                {copy.coachStrengthsLabel}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7">{report.strengths}</p>
            </div>
            <div className="py-5">
              <p className="font-mono text-[10px] tracking-[0.35em] text-pencil">
                {copy.coachImprovementsLabel}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7">
                {report.improvements}
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
