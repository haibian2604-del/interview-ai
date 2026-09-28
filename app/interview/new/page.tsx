"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { COPY } from "@/lib/copy";
import { BackButton } from "@/components/back-button";
import { resumeDigest } from "@/lib/resume/profile-preview";

type ResumeRow = { id: string; created_at: string; structured_json: unknown; raw_text: string | null; name: string | null };
type InterviewType = "skill" | "project" | "behavioral" | "mixed";
type Phase = "form" | "printing" | "binding" | "entering";

const TYPE_OPTIONS: { value: InterviewType; label: string }[] = [
  { value: "skill", label: COPY.interviewNew.typeSkill },
  { value: "project", label: COPY.interviewNew.typeProject },
  { value: "behavioral", label: COPY.interviewNew.typeBehavioral },
  { value: "mixed", label: COPY.interviewNew.typeMixed },
];

const COUNT_MIN = 3;
const COUNT_MAX = 10;
const COUNT_DEFAULT = 6;

// 真实面试选项（服务端 parseTargetQuestions/parseDifficulty 容错兜底）
const TARGET_OPTIONS = [10, 15, 20] as const;
const DIFFICULTY_OPTIONS = [
  { value: "easy" as const, label: COPY.interviewNew.diffEasy, desc: COPY.interviewNew.diffEasyDesc },
  { value: "medium" as const, label: COPY.interviewNew.diffMedium, desc: COPY.interviewNew.diffMediumDesc },
  { value: "hard" as const, label: COPY.interviewNew.diffHard, desc: COPY.interviewNew.diffHardDesc },
];

// 档案编号：与简历库一致，最早归档的是 No.001
function archiveNo(index: number) {
  return `No.${String(index + 1).padStart(3, "0")}`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 「考官正在出卷」印刷过程反馈：占位题行逐条浮现，钩稽线从左向右誊写（纯 CSS 动画，非真实进度）
const PRINT_CSS = `
@keyframes mirror-print-row { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@keyframes mirror-print-line { from { transform: scaleX(0); } to { transform: scaleX(1); } }
@keyframes mirror-print-pulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
.mirror-print-row { opacity: 0; animation: mirror-print-row 0.4s ease-out forwards; }
.mirror-print-line { transform: scaleX(0); animation: mirror-print-line 1.1s ease-in-out forwards; }
.mirror-print-pulse { animation: mirror-print-pulse 1.4s ease-in-out infinite; }
/* 前庭安全：本地动画降静态终态（row 基态 opacity:0，裸禁用会整版隐形；line 停满线） */
@media (prefers-reduced-motion: reduce) {
  .mirror-print-row { animation: none; opacity: 1; transform: none; }
  .mirror-print-line { animation: none; transform: scaleX(1); }
}
`;

// 考官工作节拍：出卷调用的真实工序叙事，随时间递减节奏推进（最坏等待也不坠入静止）
const STAGE_KEYS = [
  "printingStageTune",
  "printingStageProfile",
  "printingStageCompose",
  "printingStageTranscribe",
  "printingStageBind",
] as const;
const STAGE_DELAYS_MS = [2500, 5000, 10000, 18000];

// 「考官入场」过场（真实面试）：create 即时返回、无卷可装订，
// 用短节拍（调卷→画像→开场）与练习模式保持同一仪式感，翻卷间隙由 loading 兜底接住
const ENTER_STAGE_KEYS = [
  "printingStageTune",
  "printingStageProfile",
  "printingStageOpen",
] as const;
const ENTER_STAGE_DELAYS_MS = [600, 1300];

function EnteringPanel() {
  const copy = COPY.interviewNew;
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timers = ENTER_STAGE_DELAYS_MS.map((ms, i) =>
      window.setTimeout(() => setStage(i + 1), ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  return (
    <section
      aria-busy="true"
      aria-live="polite"
      className="rounded-none border border-ink/15 bg-transparent"
    >
      <div className="border-b border-ink/15 px-6 py-5">
        <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
          {copy.stepThreeLabel}
        </p>
        <h2 className="mt-3 font-heading text-2xl font-semibold">
          {copy.enteringTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink/60">{copy.enteringHint}</p>
      </div>
      <div className="px-6 py-8">
        {/* 节拍行：已过工序落墨、当前工序高亮、未到处极浅 + 循环活墨线 */}
        <div className="flex items-center gap-3">
          {ENTER_STAGE_KEYS.map((key, i) => (
            <span
              key={key}
              className={`font-mono text-xs tracking-widest ${
                i < stage ? "text-ink" : i === stage ? "text-ink/70" : "text-pencil/40"
              }`}
            >
              {copy[key]}
            </span>
          ))}
          <span aria-hidden className="mirror-print-cycle h-px flex-1 origin-left bg-ink/50" />
        </div>
      </div>
    </section>
  );
}

function PrintingPanel({ count, done }: { count: number; done: boolean }) {
  const copy = COPY.interviewNew;
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (done) return;
    const timers = STAGE_DELAYS_MS.map((ms, i) =>
      window.setTimeout(() => setStage(i + 1), ms),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [done]);
  const rows = Array.from({ length: count }, (_, i) => i);
  // 浮现节奏封顶：题多也不让入场动画拖过 ~2.5s，等待期的活感交给节拍行与循环墨线
  const rowStep = Math.min(0.45, 2.4 / Math.max(count, 1));
  const stageKey = done ? STAGE_KEYS[STAGE_KEYS.length - 1] : STAGE_KEYS[stage];
  return (
    <section
      aria-busy={!done}
      aria-live="polite"
      className="rounded-none border border-ink/15 bg-transparent"
    >
      <div className="border-b border-ink/15 px-6 py-5">
        <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
          {copy.stepThreeLabel}
        </p>
        <h2 className="mt-3 font-heading text-2xl font-semibold">
          {copy.printingTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-ink/60">{copy.printingHint}</p>
      </div>
      <ol className="space-y-4 px-6 py-6">
        {rows.map((i) => (
          <li
            key={i}
            className="mirror-print-row flex items-center gap-4"
            style={{ animationDelay: `${(i * rowStep).toFixed(2)}s` }}
          >
            <span className="w-14 shrink-0 font-mono text-xs tracking-widest text-ink">
              {copy.printingRowPrefix} {String(i + 1).padStart(2, "0")}
            </span>
            <span
              className="mirror-print-line h-px flex-1 origin-left bg-ink/50"
              style={{ animationDelay: `${(i * rowStep + 0.15).toFixed(2)}s` }}
            />
            {!done && (
              <span className="mirror-print-pulse shrink-0 font-mono text-xs text-pencil">
                {copy.printingRowWriting}
              </span>
            )}
          </li>
        ))}
        {/* 节拍行：等待期=当前工序+循环墨线；成卷=墨线落定、黑章盖下（本页 focal moment） */}
        <li
          className="mirror-print-row flex items-center gap-4 pt-2"
          style={{ animationDelay: `${(count * rowStep).toFixed(2)}s` }}
        >
          <span
            className={`w-28 shrink-0 font-mono text-xs tracking-widest ${
              done ? "text-ink" : "text-pencil"
            }`}
          >
            {done ? copy.printingBinding : copy[stageKey]}
          </span>
          <span
            aria-hidden
            className={`h-px flex-1 origin-left bg-ink/50 ${
              done ? "" : "mirror-print-cycle"
            }`}
          />
          {done && (
            <span
              aria-hidden
              className="mirror-stamp-in inline-block shrink-0 -rotate-2 border-2 border-ink p-1"
            >
              <span className="block border border-ink/50 px-2.5 py-1.5 font-heading text-lg font-semibold leading-none text-ink">
                {copy.bindingStamp}
              </span>
            </span>
          )}
        </li>
      </ol>
      <style>{PRINT_CSS}</style>
    </section>
  );
}

function StepHeader({ label, title, hint }: { label: string; title: string; hint: string }) {
  return (
    <div className="border-b border-ink/15 px-6 py-5">
      <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">{label}</p>
      <h2 className="mt-3 font-heading text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-ink/60">{hint}</p>
    </div>
  );
}

export default function InterviewNewPage() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [resumes, setResumes] = useState<ResumeRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [resumeId, setResumeId] = useState<string | null>(null);
  const [position, setPosition] = useState("");
  const [jdText, setJdText] = useState("");
  const [interviewType, setInterviewType] = useState<InterviewType>("mixed");
  const [count, setCount] = useState(COUNT_DEFAULT);
  const [mode, setMode] = useState<"practice" | "real">("practice");
  const [targetQuestions, setTargetQuestions] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [phase, setPhase] = useState<Phase>("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: fetchError } = await supabase
        .from("resumes")
        .select("id, created_at, structured_json, raw_text, name")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (fetchError) {
        setListError(COPY.interviewNew.loadFailed);
        return;
      }
      setResumes((data ?? []) as ResumeRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function create() {
    if (submitting) return;
    if (!resumeId) {
      setError(COPY.interviewNew.noResume);
      return;
    }
    if (!position.trim()) {
      setError(COPY.interviewNew.noPosition);
      return;
    }
    setError(null);
    setSubmitting(true);
    if (mode === "practice") setPhase("printing");
    let succeeded = false;
    try {
      const res = await fetch("/api/interview/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeId,
          position: position.trim(),
          jdText: jdText.trim() || undefined,
          interviewType,
          questionCount: count,
          mode,
          ...(mode === "real" ? { targetQuestions, difficulty } : {}),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { interviewId?: string; error?: string }
        | null;
      if (res.ok && payload?.interviewId) {
        // 进场先于切页：练习=成卷盖章（~1s），真实=考官入场节拍（~2s），
        // 翻卷间隙由面试路由的 loading 兜底页接住。成功后不回表单（旧版闪回的根源）。
        succeeded = true;
        if (mode === "practice") {
          setPhase("binding");
          await new Promise((resolve) => setTimeout(resolve, 950));
        } else {
          setPhase("entering");
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        router.push(`/interview/${payload.interviewId}`);
        return;
      }
      if (res.status === 401) {
        setError(COPY.interviewNew.unauthorized);
      } else if (res.status === 502 && payload?.error) {
        setError(payload.error);
      } else {
        setError(COPY.interviewNew.createFailed);
      }
    } catch {
      setError(COPY.interviewNew.createFailed);
    } finally {
      // 只在未成功时回卷表单；成功路径维持出卷面板直到路由切走
      if (!succeeded) {
        setPhase("form");
        setSubmitting(false);
      }
    }
  }

  const copy = COPY.interviewNew;
  const busy = phase !== "form";

  // D6：radiogroup 方向键——↑/↓（含 ←/→）在档案卡间循环移动选中项并跟随焦点
  function onRadiogroupKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!keys.includes(e.key)) return;
    if (!resumes || resumes.length === 0) return;
    e.preventDefault();
    const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
    const currentIdx = resumes.findIndex((r) => r.id === resumeId);
    const nextIdx =
      currentIdx === -1
        ? forward
          ? 0
          : resumes.length - 1
        : (currentIdx + (forward ? 1 : -1) + resumes.length) % resumes.length;
    const next = resumes[nextIdx];
    setResumeId(next.id);
    document.getElementById(`resume-radio-${next.id}`)?.focus();
  }

  return (
    <main className="min-h-screen bg-paper text-ink">
      <BackButton className="mb-6" />
      <div className="mx-auto w-full max-w-3xl px-10 py-14">
        {/* 卷首 */}
        <header className="border-b border-ink/15 pb-8">
          <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
            {copy.headerLabel}
          </p>
          <h1 className="mt-4 font-heading text-4xl font-semibold tracking-wide">
            {copy.headerTitle}
          </h1>
          <p className="mt-3 max-w-xl border-l-2 border-ink/20 pl-4 text-sm leading-6 text-ink/70">
            {copy.headerHint}
          </p>
        </header>

        {busy ? (
          <div className="mt-10">
            {phase === "entering" ? (
              <EnteringPanel />
            ) : (
              <PrintingPanel count={count} done={phase === "binding"} />
            )}
          </div>
        ) : (
          <>
            {error && (
              <div className="mt-6">
                <ErrorAnnotation text={error} />
              </div>
            )}

            <div className="mt-8 space-y-8">
              {/* 第零步 · 定模式 */}
              <section className="rounded-none border border-ink/15 bg-transparent">
                <StepHeader label={copy.modeSectionLabel} title={copy.modeLabel} hint={copy.modeRealDesc} />
                <div className="grid grid-cols-1 gap-3 px-6 py-6 sm:grid-cols-2">
                  {(
                    [
                      { value: "practice", name: copy.modePracticeName, desc: copy.modePracticeDesc },
                      { value: "real", name: copy.modeRealName, desc: copy.modeRealDesc },
                    ] as const
                  ).map((option) => {
                    const selected = mode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={busy}
                        onClick={() => setMode(option.value)}
                        className={`rounded-none border px-4 py-4 text-left transition-colors focus-visible:border-ink-blue focus-visible:outline-none ${
                          selected ? "border-ink bg-ink/[0.04]" : "border-ink/15 hover:border-ink/40"
                        }`}
                      >
                        <p className="font-heading text-lg font-semibold">{option.name}</p>
                        <p className="mt-1.5 text-xs leading-5 text-pencil">{option.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* 第一步 · 调卷：档案卡选择 */}
              <section className="rounded-none border border-ink/15 bg-transparent">
                <StepHeader label={copy.stepOneLabel} title={copy.stepOneTitle} hint={copy.stepOneHint} />
                <div className="px-6 py-6">
                  {resumes === null && !listError && (
                    <p className="text-sm text-pencil">{copy.loading}</p>
                  )}
                  {listError && <ErrorAnnotation text={listError} />}
                  {resumes !== null && resumes.length === 0 && (
                    <div className="border border-dashed border-ink/20 px-6 py-10 text-center">
                      <p className="font-heading text-lg font-semibold">
                        {copy.resumeEmptyTitle}
                      </p>
                      <p className="mt-2 text-sm leading-6 text-pencil">
                        {copy.resumeEmptyHint}
                      </p>
                      <Link
                        href="/resumes"
                        className="mt-4 inline-block text-sm text-ink/70 underline decoration-ink/30 underline-offset-4 hover:text-ink"
                      >
                        {copy.resumeEmptyLink}
                      </Link>
                    </div>
                  )}
                  {resumes !== null && resumes.length > 0 && (
                    <div
                      role="radiogroup"
                      aria-label={copy.stepOneTitle}
                      onKeyDown={onRadiogroupKeyDown}
                      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                    >
                      {resumes.map((resume, i) => {
                        const selected = resumeId === resume.id;
                        const digest = resumeDigest(resume);
                        return (
                          <button
                            key={resume.id}
                            type="button"
                            role="radio"
                            id={`resume-radio-${resume.id}`}
                            aria-checked={selected}
                            disabled={busy}
                            onClick={() => setResumeId(resume.id)}
                            className={`rounded-none border px-4 py-3 text-left transition-colors focus-visible:border-ink-blue focus-visible:outline-none ${
                              selected
                                ? "border-ink bg-ink/[0.04]"
                                : "border-ink/15 hover:border-ink/40"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              {/* 勾稽方格：选中填墨 */}
                              <span
                                aria-hidden
                                className={`flex size-4 shrink-0 items-center justify-center border ${
                                  selected ? "border-ink bg-ink" : "border-ink/40"
                                }`}
                              />
                              <span className="font-mono text-sm tracking-widest">
                                {archiveNo(i)}
                              </span>
                              {/* 自命名（可选）：与档案库卡片同款，未命名回落仅显编号 */}
                              {resume.name && (
                                <span className="min-w-0 truncate text-sm font-medium text-ink">
                                  {resume.name}
                                </span>
                              )}
                              <span className="ml-auto shrink-0 font-mono text-xs text-pencil">
                                {formatDate(resume.created_at)}
                              </span>
                            </div>
                            {/* 简历缩略：让用户选卡前就知道档案大概内容 */}
                            {digest && (
                              <p className="mt-2 line-clamp-2 text-xs leading-5 text-pencil">
                                {digest}
                              </p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>

              {/* 第二步 · 报岗：岗位 + JD */}
              <section className="rounded-none border border-ink/15 bg-transparent">
                <StepHeader label={copy.stepTwoLabel} title={copy.stepTwoTitle} hint={copy.jdHint} />
                <div className="space-y-5 px-6 py-6">
                  <div className="space-y-2">
                    <label htmlFor="interview-position" className="block text-xs tracking-wide text-pencil">
                      {copy.positionLabel}
                    </label>
                    <Input
                      id="interview-position"
                      value={position}
                      onChange={(e) => setPosition(e.target.value)}
                      placeholder={copy.positionPlaceholder}
                      disabled={busy}
                      className="rounded-none border-ink/20 focus-visible:border-ink-blue focus-visible:ring-ink-blue/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="interview-jd" className="block text-xs tracking-wide text-pencil">
                      {copy.jdLabel}
                    </label>
                    <Textarea
                      id="interview-jd"
                      value={jdText}
                      onChange={(e) => setJdText(e.target.value)}
                      placeholder={copy.jdPlaceholder}
                      disabled={busy}
                      className="min-h-36 rounded-none border-ink/20 focus-visible:border-ink-blue focus-visible:ring-ink-blue/20"
                    />
                  </div>
                </div>
              </section>

              {/* 第三步 · 定题：题型勾选 + 题量（仅练习试卷） */}
              {mode === "practice" && (
                <section className="rounded-none border border-ink/15 bg-transparent">
                  <StepHeader label={copy.stepThreeLabel} title={copy.stepThreeTitle} hint={copy.countHint} />
                  <div className="space-y-5 px-6 py-6">
                    <div className="space-y-2">
                      <p className="text-xs tracking-wide text-pencil">{copy.typeLabel}</p>
                      <div className="flex flex-wrap gap-3">
                        {TYPE_OPTIONS.map((option) => {
                          const selected = interviewType === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={selected}
                              disabled={busy}
                              onClick={() => setInterviewType(option.value)}
                              className={`flex items-center gap-2 rounded-none border px-3 py-2 text-sm transition-colors focus-visible:border-ink-blue focus-visible:outline-none ${
                                selected
                                  ? "border-ink bg-ink/[0.04]"
                                  : "border-ink/20 hover:border-ink/40"
                              }`}
                            >
                              <span
                                aria-hidden
                                className={`flex size-3.5 shrink-0 items-center justify-center border ${
                                  selected ? "border-ink bg-ink" : "border-ink/40"
                                }`}
                              />
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      {interviewType === "mixed" && (
                        <p className="text-xs leading-5 text-pencil">{copy.typeMixedHint}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs tracking-wide text-pencil">{copy.countLabel}</p>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center rounded-none border border-ink/20">
                          <button
                            type="button"
                            aria-label={copy.countDecrease}
                            disabled={busy || count <= COUNT_MIN}
                            onClick={() => setCount((c) => Math.max(COUNT_MIN, c - 1))}
                            className="px-3 py-2 font-mono text-sm text-ink/70 hover:text-ink disabled:opacity-30 focus-visible:border-ink-blue focus-visible:outline-none"
                          >
                            −
                          </button>
                          <span aria-live="polite" className="w-12 text-center font-mono text-sm">
                            {count}
                          </span>
                          <button
                            type="button"
                            aria-label={copy.countIncrease}
                            disabled={busy || count >= COUNT_MAX}
                            onClick={() => setCount((c) => Math.min(COUNT_MAX, c + 1))}
                            className="px-3 py-2 font-mono text-sm text-ink/70 hover:text-ink disabled:opacity-30 focus-visible:border-ink-blue focus-visible:outline-none"
                          >
                            +
                          </button>
                        </div>
                        <span className="font-mono text-xs text-pencil">{copy.countHint}</span>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* 第三步（真实面试）· 目标题数 + 难度 */}
              {mode === "real" && (
                <section className="rounded-none border border-ink/15 bg-transparent">
                  <StepHeader
                    label={copy.stepThreeLabel}
                    title={copy.stepThreeTitle}
                    hint={copy.modeRealDesc}
                  />
                  <div className="space-y-5 px-6 py-6">
                    <div className="space-y-2">
                      <p className="text-xs tracking-wide text-pencil">{copy.realCountLabel}</p>
                      <div className="flex flex-wrap gap-3">
                        {TARGET_OPTIONS.map((option) => {
                          const selected = targetQuestions === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              aria-pressed={selected}
                              disabled={busy}
                              onClick={() => setTargetQuestions(option)}
                              className={`flex items-center gap-2 rounded-none border px-3 py-2 text-sm transition-colors focus-visible:border-ink-blue focus-visible:outline-none ${
                                selected
                                  ? "border-ink bg-ink/[0.04]"
                                  : "border-ink/20 hover:border-ink/40"
                              }`}
                            >
                              <span
                                aria-hidden
                                className={`flex size-3.5 shrink-0 items-center justify-center border ${
                                  selected ? "border-ink bg-ink" : "border-ink/40"
                                }`}
                              />
                              <span className="font-mono">{option} {COPY.interview.questionLabelSuffix}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs tracking-wide text-pencil">{copy.realDifficultyLabel}</p>
                      <div className="flex flex-wrap gap-3">
                        {DIFFICULTY_OPTIONS.map((option) => {
                          const selected = difficulty === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={selected}
                              disabled={busy}
                              onClick={() => setDifficulty(option.value)}
                              className={`flex items-center gap-2 rounded-none border px-3 py-2 text-sm transition-colors focus-visible:border-ink-blue focus-visible:outline-none ${
                                selected
                                  ? "border-ink bg-ink/[0.04]"
                                  : "border-ink/20 hover:border-ink/40"
                              }`}
                            >
                              <span
                                aria-hidden
                                className={`flex size-3.5 shrink-0 items-center justify-center border ${
                                  selected ? "border-ink bg-ink" : "border-ink/40"
                                }`}
                              />
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-xs leading-5 text-pencil">
                        {DIFFICULTY_OPTIONS.find((o) => o.value === difficulty)?.desc}
                      </p>
                    </div>
                  </div>
                </section>
              )}

              <Button
                className="h-11 w-full rounded-none text-base"
                disabled={busy || submitting}
                onClick={() => void create()}
              >
                {copy.submitButton}
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
