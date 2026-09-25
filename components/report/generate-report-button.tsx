"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { COPY } from "@/lib/copy";

/**
 * 「誊写评分报告」按钮（无报告空态）：
 * 调 POST /api/interview/report → 成功后 router.refresh() 让服务端重取报告；
 * 生成中用印刷反馈态（誊写中提示，不是干转 spinner）。
 */
export function GenerateReportButton({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const copy = COPY.report;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/interview/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          setError(copy.unauthorized);
          return;
        }
        if (res.status === 409) {
          // 存在未评估的题目：面试尚未阅卷完成
          setError(copy.notCompleted);
          return;
        }
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? copy.generateFailed);
        return;
      }
      // 报告已落库：刷新服务端组件，评语册就地展开
      router.refresh();
    } catch {
      setError(copy.generateFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Button
        type="button"
        className="rounded-none"
        disabled={busy}
        onClick={() => void generate()}
      >
        {copy.generateButton}
      </Button>
      {busy ? (
        <p className="mt-4 flex items-center justify-center gap-2 font-mono text-sm tracking-[0.2em] text-pencil">
          {copy.generating}
          <span className="animate-pulse" aria-hidden>
            ▌
          </span>
        </p>
      ) : null}
      {error && !busy ? (
        <p
          role="alert"
          className="mt-4 border-l-2 border-ink-red bg-ink-red/[0.04] px-3 py-2 text-left text-sm leading-6 text-ink-red"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
