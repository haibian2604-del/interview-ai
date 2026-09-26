"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog, NoticeDialog } from "@/components/ui/confirm-dialog";
import { COPY } from "@/lib/copy";

/** 目录页「销档」：删除整份面试卷宗（questions/messages/evaluations/reports 经外键级联一并删除） */
export function DeleteInterviewButton({ interviewId }: { interviewId: string }) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [errorOpen, setErrorOpen] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const copy = COPY.dashboard;

  async function destroy() {
    setConfirmOpen(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/interview/${interviewId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrorText(body?.error ?? copy.deleteFailed);
        setErrorOpen(true);
        return;
      }
      router.refresh();
    } catch {
      setErrorText(copy.deleteFailed);
      setErrorOpen(true);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        disabled={deleting}
        className="relative rounded-none border border-transparent px-1.5 py-1 font-mono text-xs before:absolute before:inset-[-10px] before:content-[''] tracking-[0.2em] text-pencil transition-colors hover:border-ink-red/40 hover:text-ink-red focus-visible:border-ink-blue focus-visible:outline-none disabled:opacity-50"
      >
        {copy.deleteLabel}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={copy.deleteLabel}
        description={copy.deleteConfirm}
        confirmLabel={copy.deleteLabel}
        destructive
        onConfirm={() => void destroy()}
      />
      <NoticeDialog
        open={errorOpen}
        onOpenChange={setErrorOpen}
        title={copy.deleteFailedTitle}
        description={errorText}
      />
    </>
  );
}
