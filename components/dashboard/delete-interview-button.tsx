"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { COPY } from "@/lib/copy";

/** 目录页「销档」：删除整份面试卷宗（questions/messages/evaluations/reports 经外键级联一并删除） */
export function DeleteInterviewButton({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const copy = COPY.dashboard;

  async function destroy() {
    if (deleting) return;
    if (!window.confirm(copy.deleteConfirm)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/interview/${interviewId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        window.alert(body?.error ?? copy.deleteFailed);
        return;
      }
      router.refresh();
    } catch {
      window.alert(copy.deleteFailed);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={destroy}
      disabled={deleting}
      className="relative rounded-none border border-transparent px-1.5 py-1 font-mono text-xs before:absolute before:inset-[-10px] before:content-[''] tracking-[0.2em] text-pencil transition-colors hover:border-ink-red/40 hover:text-ink-red focus-visible:border-ink-blue focus-visible:outline-none disabled:opacity-50"
    >
      {copy.deleteLabel}
    </button>
  );
}
