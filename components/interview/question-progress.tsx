import { Progress } from "@/components/ui/progress";
import { cn } from "cn";
import { COPY } from "@/lib/copy";

// 进行中题号方格的呼吸动画（蓝作答 = 「进行中」状态）
const BREATHE_CSS = `
@keyframes mirror-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
.mirror-breathe { animation: mirror-breathe 1.6s ease-in-out infinite; }
`;

type QuestionProgressProps = {
  currentIndex: number;
  questionCount: number;
  skillTag: string | null;
  /** 出现过追问轮的题号（方格右上角小「追」记号） */
  followupIdxs?: number[];
  /** 本场已终结（阅卷完成/缺考）：当前格不再呼吸 */
  frozen?: boolean;
  /** 阅卷完成：当前格也视为已答填墨 */
  allDone?: boolean;
};

export function QuestionProgress({
  currentIndex,
  questionCount,
  skillTag,
  followupIdxs = [],
  frozen = false,
  allDone = false,
}: QuestionProgressProps) {
  const copy = COPY.interview;
  const followupSet = new Set(followupIdxs);
  const answered = allDone ? questionCount : Math.min(currentIndex, questionCount);
  const progressValue = questionCount > 0 ? (answered / questionCount) * 100 : 0;
  const currentLabel = Math.min(currentIndex + 1, questionCount);

  return (
    <section aria-label={copy.progressTitle} className="rounded-none border border-ink/15">
      <style>{BREATHE_CSS}</style>
      <div className="border-b border-ink/15 px-5 py-4">
        <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
          {copy.progressTitle}
        </p>
        <p className="mt-3 font-heading text-2xl font-semibold tabular-nums">
          {copy.questionLabelPrefix} {currentLabel}{" "}
          <span className="text-pencil">/ {questionCount} 题</span>
        </p>
        <div className="mt-4">
          <Progress value={progressValue} aria-label={copy.progressTitle} className="gap-2" />
        </div>
      </div>

      {/* 答题卡式题号方格导航：已答填墨 / 进行中呼吸 / 未答空格 */}
      <div className="border-b border-ink/15 px-5 py-4">
        <ol className="flex flex-wrap gap-2">
          {Array.from({ length: questionCount }, (_, i) => {
            const done = i < currentIndex || (allDone && i === currentIndex);
            const current = i === currentIndex && !allDone;
            return (
              <li key={i}>
                <span
                  aria-label={`${copy.questionLabelPrefix} ${i + 1} ${copy.questionLabelSuffix}${
                    done ? ` ${copy.questionStateAnswered}` : current ? ` ${copy.questionStateCurrent}` : ` ${copy.questionStatePending}`
                  }`}
                  className={cn(
                    "relative flex size-8 items-center justify-center border font-mono text-[11px] tabular-nums",
                    done && "border-ink bg-ink text-paper",
                    current && "border-ink-blue text-ink-blue",
                    !done && !current && "border-ink/25 text-pencil",
                    current && !frozen && "mirror-breathe",
                  )}
                >
                  {String(i + 1).padStart(2, "0")}
                  {followupSet.has(i) && (
                    <span
                      aria-label={copy.followupBadgeAria}
                      className="absolute -right-2 -top-2 font-mono text-[9px] leading-none text-ink-blue"
                    >
                      {copy.followupBadgeMark}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      {/* 当前题考察点标签 */}
      <div className="px-5 py-4">
        <p className="text-xs tracking-wide text-pencil">{copy.skillTagLabel}</p>
        <p className="mt-2 inline-block rounded-none border border-ink/30 px-2 py-1 font-mono text-xs">
          {skillTag ?? "—"}
        </p>
      </div>
    </section>
  );
}
