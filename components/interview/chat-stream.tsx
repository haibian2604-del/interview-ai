"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { QuestionProgress } from "@/components/interview/question-progress";
import { COPY } from "@/lib/copy";
import type { ChatMessage, StampData } from "@/lib/interview/mappers";

const DIMENSION_KEYS = ["relevance", "depth", "structure", "communication"] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];

type InterviewStatus =
  | "draft"
  | "generating"
  | "ready"
  | "in_progress"
  | "completed"
  | "abandoned";

export type ChatStreamProps = {
  interviewId: string;
  initialStatus: InterviewStatus;
  initialCurrentIndex: number;
  initialMessages: ChatMessage[];
  questions: { content: string; skillTag: string }[];
  initialStamps: Record<number, StampData>;
  initialFollowupIdxs: number[];
};

function parseScoresHeader(value: string | null): StampData | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { scores, starCompleteness } = parsed as {
    scores?: Record<string, unknown>;
    starCompleteness?: unknown;
  };
  if (!scores || typeof starCompleteness !== "number") return null;
  const result = {} as Record<DimensionKey, number>;
  for (const key of DIMENSION_KEYS) {
    const v = scores[key];
    if (typeof v !== "number") return null;
    result[key] = v;
  }
  return { scores: result, starCompleteness };
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const copy = COPY.interview;
  if (message.role === "interviewer") {
    // 面试官 = 黑墨笔迹（印刷体）
    return (
      <li className="max-w-[52rem]">
        <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-pencil">
          {copy.examinerLabel}
          {message.isFollowupQuestion && (
            <span className="border border-ink/50 px-1.5 py-0.5 text-[10px] tracking-[0.2em] text-ink/70">
              {copy.followupTag}
            </span>
          )}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-7 text-ink">
          {message.content || "……"}
        </p>
      </li>
    );
  }
  // 候选人 = 蓝墨作答（含追问轮回答）
  return (
    <li className="flex justify-end">
      <div className="max-w-[44rem] border-l-2 border-ink-blue pl-4">
        <p className="font-mono text-xs tracking-widest text-ink-blue/70">
          {copy.candidateLabel}
        </p>
        <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-7 text-ink-blue">
          {message.content}
        </p>
      </div>
    </li>
  );
}

/** 分数框：红批改印章（复写纸分数框，双线框 + 微倾），四维分 + STAR 完整度 */
function ScoreStamp({ data, animate }: { data: StampData; animate: boolean }) {
  const copy = COPY.interview;
  return (
    <li className={animate ? "mirror-stamp-in" : undefined}>
      <div className="inline-block -rotate-2 border-2 border-ink-red px-1.5 py-1.5 text-ink-red">
        <div className="border border-ink-red/50 px-3 py-2.5">
          <p className="font-mono text-[10px] tracking-[0.35em]">{copy.stampLabel}</p>
          <dl className="mt-2 grid grid-cols-4 gap-x-4 gap-y-1">
            {DIMENSION_KEYS.map((key) => (
              <div key={key}>
                <dt className="text-[10px] text-ink-red/80">{copy.dimensions[key]}</dt>
                <dd className="font-mono text-sm tabular-nums">
                  {data.scores[key].toFixed(2)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 border-t border-ink-red/40 pt-1.5 font-mono text-[10px] tabular-nums">
            {copy.stampStarLabel} {data.starCompleteness.toFixed(2)}
          </p>
        </div>
      </div>
    </li>
  );
}

export function ChatStream(props: ChatStreamProps) {
  const copy = COPY.interview;
  const router = useRouter();
  const { interviewId, questions } = props;
  const questionCount = questions.length;

  const [status, setStatus] = useState<InterviewStatus>(props.initialStatus);
  const [messages, setMessages] = useState<ChatMessage[]>(props.initialMessages);
  const [stamps, setStamps] = useState<Record<number, StampData>>(props.initialStamps);
  const [liveStampIdxs, setLiveStampIdxs] = useState<number[]>([]);
  const [followupIdxs, setFollowupIdxs] = useState<number[]>(props.initialFollowupIdxs);
  const [currentIndex, setCurrentIndex] = useState(props.initialCurrentIndex);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startedRef = useRef(false);
  const localIdRef = useRef(0);
  const scrollRef = useRef<HTMLOListElement | null>(null);

  const isAbandoned = status === "abandoned";
  const isCompleted = status === "completed";
  const ended = isAbandoned || isCompleted;
  const inputDisabled = busy || ended || status === "draft" || status === "generating";
  const safeIndex = Math.min(currentIndex, Math.max(questionCount - 1, 0));
  const currentQuestion = questions[safeIndex];

  const nextLocalId = () => `local-${interviewId}-${++localIdRef.current}`;

  // 卷面随新内容滚动到底（打字机 + 新气泡）
  useEffect(() => {
    const list = scrollRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, error]);

  function appendMessage(m: ChatMessage) {
    setMessages((prev) => [...prev, m]);
  }

  function appendToMessage(id: string, chunk: string) {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m)),
    );
  }

  function errorForStatus(res: Response, fallback: string): string {
    if (res.status === 401) return copy.unauthorized;
    if (res.status === 404) return copy.notFound;
    if (res.status === 409) return copy.notInProgress;
    if (res.status === 502) return copy.llmFailed;
    return fallback;
  }

  /** 把面试官流式响应逐 chunk 写入一条黑墨气泡（打字机效果） */
  async function streamIntoBubble(
    res: Response,
    meta: { questionIdx: number | null; isFollowupQuestion: boolean },
  ): Promise<boolean> {
    const id = nextLocalId();
    appendMessage({
      id,
      role: "interviewer",
      content: "",
      questionIdx: meta.questionIdx,
      isFollowupQuestion: meta.isFollowupQuestion,
    });
    const reader = res.body?.getReader();
    if (!reader) {
      appendToMessage(id, COPY.interview.streamInterrupted);
      setError(copy.streamBroken);
      return false;
    }
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        appendToMessage(id, decoder.decode(value, { stream: true }));
      }
      appendToMessage(id, decoder.decode());
      return true;
    } catch {
      // 流式断流（I2）：保留已收到的部分并补截断标记（与刷新还原的落盘卷面一致），
      // 提示刷新可恢复
      appendToMessage(id, COPY.interview.streamInterrupted);
      setError(copy.streamBroken);
      return false;
    }
  }

  async function startInterview() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId }),
      });
      if (!res.ok) {
        setError(errorForStatus(res, copy.startFailed));
        return;
      }
      const contentType = res.headers.get("Content-Type") ?? "";
      if (contentType.includes("application/json")) {
        // 幂等分支：返回已有第一条面试官消息（中断恢复）
        const payload = (await res.json()) as { firstMessage?: string | null };
        const text = payload.firstMessage?.trim();
        if (text) {
          appendMessage({
            id: nextLocalId(),
            role: "interviewer",
            content: text,
            questionIdx: 0,
            isFollowupQuestion: false,
          });
        }
        return;
      }
      await streamIntoBubble(res, { questionIdx: 0, isFollowupQuestion: false });
    } catch {
      setError(copy.startFailed);
    } finally {
      setBusy(false);
    }
  }

  // 挂载时：ready 自动开场；in_progress 且无历史消息（中断恢复）同样调 start（幂等）。
  // 定时器把首次 setState 移出 effect 主体（react-hooks/set-state-in-effect），
  // startedRef 兜住 StrictMode 双挂载导致的重复开场。
  useEffect(() => {
    const s = props.initialStatus;
    if (s !== "ready" && !(s === "in_progress" && props.initialMessages.length === 0)) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      void startInterview();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitAnswer() {
    const text = draft.trim();
    if (!text || inputDisabled) return;
    const answeredIdx = safeIndex;
    const optimisticId = nextLocalId();
    setError(null);
    setBusy(true);
    setDraft("");
    appendMessage({
      id: optimisticId,
      role: "candidate",
      content: text,
      questionIdx: answeredIdx,
      isFollowupQuestion: false,
    });

    let res: Response;
    try {
      res = await fetch("/api/interview/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId, answer: text }),
      });
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(text);
      setError(copy.answerFailed);
      setBusy(false);
      return;
    }
    if (!res.ok) {
      // 作答未被接受：回滚乐观气泡
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(text);
      setError(errorForStatus(res, copy.answerFailed));
      setBusy(false);
      return;
    }

    // 自定义头：编排结果 + 批改分（评估在流式前完成，响应头即时可得）
    const action = res.headers.get("X-Interview-Action") ?? "";
    const scores = parseScoresHeader(res.headers.get("X-Interview-Scores"));

    await streamIntoBubble(res, {
      questionIdx: answeredIdx,
      isFollowupQuestion: action === "followup",
    });
    if (action === "followup") {
      setFollowupIdxs((prev) =>
        prev.includes(answeredIdx) ? prev : [...prev, answeredIdx],
      );
    }

    // 流结束后拉取编排状态：判断跳报告页 / 刷新进度
    let nextStatus: InterviewStatus | null = null;
    let nextIndex: number | null = null;
    try {
      const statusRes = await fetch(`/api/interview/${interviewId}/status`);
      if (statusRes.ok) {
        const s = (await statusRes.json()) as {
          status: InterviewStatus;
          currentIndex: number;
        };
        nextStatus = s.status;
        nextIndex = s.currentIndex;
      }
    } catch {
      // 进度刷新失败时以本地为准，不打断作答流
    }

    // 盖章触发：X-Interview-Action 为 next_question / finish 时，上一题批改分盖章出现
    if (scores && (action === "next_question" || action === "finish")) {
      setStamps((prev) => ({ ...prev, [answeredIdx]: scores }));
      setLiveStampIdxs((prev) =>
        prev.includes(answeredIdx) ? prev : [...prev, answeredIdx],
      );
    }

    if (nextStatus === "completed") {
      setStatus("completed");
      setBusy(false);
      // 完成瞬间：合卷「阅卷完成」稍作停留后跳报告页（报告页由下一任务提供）
      window.setTimeout(() => router.push(`/report/${interviewId}`), 1600);
      return;
    }
    if (nextIndex !== null) setCurrentIndex(nextIndex);
    setBusy(false);
  }

  async function abandon() {
    if (busy || ended) return;
    if (!window.confirm(copy.abandonConfirm)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/interview/${interviewId}/abandon`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(errorForStatus(res, copy.abandonFailed));
        return;
      }
      router.push("/dashboard");
    } catch {
      setError(copy.abandonFailed);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter 发送 / Shift+Enter 换行；中文输入法选词回车不发送
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submitAnswer();
    }
  }

  /** 作答流：逐题分组，题组末尾（转场话术之后）落下该题批改章 */
  function renderFlow(): ReactNode[] {
    const items: ReactNode[] = [];
    messages.forEach((m, i) => {
      items.push(<ChatBubble key={m.id} message={m} />);
      const next = messages[i + 1];
      const lastOfGroup = !next || next.questionIdx !== m.questionIdx;
      const idx = m.questionIdx;
      if (lastOfGroup && idx !== null) {
        const stamp = stamps[idx];
        // 只在题已答完（已推进到下一题 / 阅卷完成 / 缺考封存）时展示批改章
        const revealed = isCompleted || isAbandoned || idx < currentIndex;
        if (stamp && revealed) {
          items.push(
            <ScoreStamp
              key={`stamp-${idx}`}
              data={stamp}
              animate={liveStampIdxs.includes(idx)}
            />,
          );
        }
      }
    });
    return items;
  }

  const abandonControl = (
    <Button
      type="button"
      variant="outline"
      className="w-full rounded-none border-ink/25 text-ink/60 hover:text-ink"
      disabled={busy || ended}
      onClick={() => void abandon()}
    >
      {copy.abandonButton}
    </Button>
  );

  return (
    <div className="flex min-h-0 w-full flex-1 gap-8">
      {/* 左栏（桌面）：答题卡 + 放弃面试 */}
      <aside className="hidden w-64 shrink-0 flex-col gap-6 lg:flex">
        <QuestionProgress
          currentIndex={safeIndex}
          questionCount={questionCount}
          skillTag={currentQuestion?.skillTag ?? null}
          followupIdxs={followupIdxs}
          frozen={ended}
          allDone={isCompleted}
        />
        <div className="mt-auto">{abandonControl}</div>
      </aside>

      {/* 主区：题干 + 作答流 + 输入区 */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 移动端降级：左栏折叠为顶部进度条 */}
        <div className="mb-5 flex items-center gap-4 border-b border-ink/15 pb-4 lg:hidden">
          <p className="shrink-0 font-heading text-lg font-semibold tabular-nums">
            {copy.questionLabelPrefix} {safeIndex + 1} / {questionCount}
          </p>
          <Progress
            value={questionCount > 0 ? ((isCompleted ? questionCount : safeIndex) / questionCount) * 100 : 0}
            aria-label={copy.progressTitle}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 rounded-none border-ink/25 text-ink/60"
            disabled={busy || ended}
            onClick={() => void abandon()}
          >
            {copy.abandonButton}
          </Button>
        </div>

        {/* 当前题干：考卷题干气质（黑体大字） */}
        {currentQuestion && (
          <div className="border-b border-ink/15 pb-5">
            <p className="font-mono text-xs tracking-[0.35em] text-pencil">
              {copy.questionLabelPrefix} {safeIndex + 1} 题
              {followupIdxs.includes(safeIndex) && (
                <span className="ml-3 border border-ink/40 px-1.5 py-0.5 text-[10px] tracking-[0.2em] text-ink/70">
                  {copy.followupTag}
                </span>
              )}
            </p>
            <h2 className="mt-3 text-xl font-bold leading-relaxed md:text-2xl">
              {currentQuestion.content}
            </h2>
          </div>
        )}

        {error && (
          <div className="mt-4">
            <ErrorAnnotation text={error} />
          </div>
        )}
        {isAbandoned && (
          <div className="mt-6 flex items-center gap-4 border border-ink/20 px-5 py-4">
            {/* 灰章文字用 ink-stamp（D3）：pencil 对比度不足 4.5:1，加深一档 */}
            <span className="-rotate-3 border-2 border-ink-stamp px-3 py-1 font-heading text-lg font-semibold tracking-[0.3em] text-ink-stamp">
              {copy.abandonedStamp}
            </span>
            <p className="text-sm leading-6 text-ink/60">{copy.abandonedHint}</p>
          </div>
        )}

        {/* 作答流：考官黑墨 / 候选人蓝墨 / 批改红章 */}
        <ol
          ref={scrollRef}
          aria-label={copy.answerLabel}
          className="min-h-0 flex-1 space-y-6 overflow-y-auto py-6 pr-1"
        >
          {renderFlow()}
          {isCompleted && (
            <li className="flex justify-center pt-4">
              <div className="mirror-stamp-in border border-ink px-10 py-6 text-center">
                <p className="font-heading text-2xl font-semibold tracking-[0.3em]">
                  {copy.gradingDoneTitle}
                </p>
                <p className="mt-2 text-sm leading-6 text-ink/60">{copy.gradingDoneHint}</p>
                <Button
                  type="button"
                  className="mt-4 rounded-none"
                  onClick={() => router.push(`/report/${interviewId}`)}
                >
                  {copy.viewReport}
                </Button>
              </div>
            </li>
          )}
        </ol>

        {/* 底部大输入区：作答蓝焦点态 */}
        <div className="border-t border-ink/15 pt-4">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={copy.answerPlaceholder}
            aria-label={copy.answerLabel}
            disabled={inputDisabled}
            rows={4}
            className="min-h-28 rounded-none border-ink/20 text-[15px] leading-7 focus-visible:border-ink-blue focus-visible:ring-ink-blue/20"
          />
          <div className="mt-3 flex items-center justify-between">
            <p className="font-mono text-xs text-pencil">{copy.shortcutHint}</p>
            <Button
              type="button"
              className="rounded-none"
              disabled={inputDisabled || !draft.trim()}
              onClick={() => void submitAnswer()}
            >
              {copy.sendButton}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
