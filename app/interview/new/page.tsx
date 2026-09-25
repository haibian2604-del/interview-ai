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

type ResumeRow = { id: string; created_at: string };
type InterviewType = "skill" | "project" | "behavioral" | "mixed";
type Phase = "form" | "printing";

const TYPE_OPTIONS: { value: InterviewType; label: string }[] = [
  { value: "skill", label: COPY.interviewNew.typeSkill },
  { value: "project", label: COPY.interviewNew.typeProject },
  { value: "behavioral", label: COPY.interviewNew.typeBehavioral },
  { value: "mixed", label: COPY.interviewNew.typeMixed },
];

const COUNT_MIN = 3;
const COUNT_MAX = 10;
const COUNT_DEFAULT = 6;

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
`;

function PrintingPanel({ count }: { count: number }) {
  const copy = COPY.interviewNew;
  const rows = Array.from({ length: count }, (_, i) => i);
  const rowStep = 0.45;
  const bindingDelay = (count * rowStep + 0.6).toFixed(2);
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
            <span className="mirror-print-pulse shrink-0 font-mono text-xs text-pencil">
              {copy.printingRowWriting}
            </span>
          </li>
        ))}
        <li
          className="mirror-print-row flex items-center gap-4 pt-2"
          style={{ animationDelay: `${bindingDelay}s` }}
        >
          <span className="font-mono text-xs tracking-widest text-pencil">
            {copy.printingBinding}
          </span>
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
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error: fetchError } = await supabase
        .from("resumes")
        .select("id, created_at")
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
    if (!resumeId) {
      setError(COPY.interviewNew.noResume);
      return;
    }
    if (!position.trim()) {
      setError(COPY.interviewNew.noPosition);
      return;
    }
    setError(null);
    setPhase("printing");
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
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { interviewId?: string; error?: string }
        | null;
      if (res.ok && payload?.interviewId) {
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
      setPhase("form");
    }
  }

  const copy = COPY.interviewNew;
  const busy = phase === "printing";

  return (
    <main className="min-h-screen bg-paper text-ink">
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
            <PrintingPanel count={count} />
          </div>
        ) : (
          <>
            {error && (
              <div className="mt-6">
                <ErrorAnnotation text={error} />
              </div>
            )}

            <div className="mt-8 space-y-8">
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
                    <div role="radiogroup" aria-label={copy.stepOneTitle} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {resumes.map((resume, i) => {
                        const selected = resumeId === resume.id;
                        return (
                          <button
                            key={resume.id}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={busy}
                            onClick={() => setResumeId(resume.id)}
                            className={`flex items-center gap-3 rounded-none border px-4 py-3 text-left transition-colors focus-visible:border-ink-blue focus-visible:outline-none ${
                              selected
                                ? "border-ink bg-ink/[0.04]"
                                : "border-ink/15 hover:border-ink/40"
                            }`}
                          >
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
                            <span className="ml-auto font-mono text-xs text-pencil">
                              {formatDate(resume.created_at)}
                            </span>
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

              {/* 第三步 · 定题：题型勾选 + 题量 */}
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

              <Button
                className="h-11 w-full rounded-none text-base"
                disabled={busy}
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
