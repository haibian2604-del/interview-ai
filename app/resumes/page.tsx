"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ErrorAnnotation } from "@/components/ui/error-annotation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { COPY } from "@/lib/copy";
import { BackButton } from "@/components/back-button";
import { resumeDigest, resumeProfilePreview } from "@/lib/resume/profile-preview";

type ResumeRow = {
  id: string;
  created_at: string;
  storage_path: string | null;
  structured_json: unknown;
};

// 归档日期：等宽表格数字，印刷品节奏
function formatDate(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 卷号：按归档时间递增，最早的档案是 No.001
function archiveNo(indexFromOldest: number) {
  return `No.${String(indexFromOldest + 1).padStart(3, "0")}`;
}

function NewArchiveCard({
  onCreated,
}: {
  onCreated: (message: string) => void;
}) {
  const supabase = createSupabaseBrowserClient();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setPasteText("");
    const input = document.getElementById("resume-file") as HTMLInputElement | null;
    if (input) input.value = "";
  }

  // PDF 路径：交给 /api/resume/parse 誊录（Storage + 文本抽取）
  async function uploadPdf() {
    if (!file) {
      setError(COPY.resumes.uploadHint);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume/parse", { method: "POST", body: form });
      if (!res.ok) {
        setError(
          res.status === 400
            ? COPY.resumes.notPdf
            : res.status === 422
              ? COPY.resumes.scanned
              : COPY.resumes.uploadFailed,
        );
        return;
      }
      reset();
      onCreated(COPY.resumes.successNote);
      router.refresh();
    } catch {
      setError(COPY.resumes.uploadFailed);
    } finally {
      setBusy(false);
    }
  }

  // 粘贴路径：平等的次入口，直接入卷（storage_path 留空）
  async function savePastedText() {
    const text = pasteText.trim();
    if (text.length < 50) {
      setError(COPY.resumes.pasteTooShort);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        setError(COPY.resumes.pasteFailed);
        return;
      }
      const { error: insertError } = await supabase
        .from("resumes")
        .insert({ user_id: data.user.id, raw_text: text });
      if (insertError) {
        setError(COPY.resumes.pasteFailed);
        return;
      }
      reset();
      onCreated(COPY.resumes.successNote);
      router.refresh();
    } catch {
      setError(COPY.resumes.pasteFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="rounded-none border border-ink/15 bg-transparent shadow-none">
      <CardHeader className="border-b border-ink/15">
        <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
          {COPY.resumes.newArchiveEyebrow}
        </p>
        <CardTitle className="font-heading text-xl font-semibold">
          {COPY.resumes.newArchiveTitle}
        </CardTitle>
        <p className="text-sm leading-6 text-ink/60">{COPY.resumes.newArchiveHint}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* 主入口：PDF 誊录 */}
        <div className="space-y-2">
          <label
            htmlFor="resume-file"
            className="block text-xs tracking-wide text-pencil"
          >
            {COPY.resumes.uploadLabel}
          </label>
          <input
            id="resume-file"
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full border border-ink/20 bg-transparent px-2.5 py-2 text-sm file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-ink/70 focus-visible:border-ink-blue focus-visible:outline-none"
          />
          <p className="text-xs leading-5 text-pencil">{COPY.resumes.uploadHint}</p>
          <Button className="w-full" disabled={busy} onClick={() => void uploadPdf()}>
            {busy ? COPY.resumes.uploading : COPY.resumes.uploadButton}
          </Button>
        </div>

        {/* 次入口：粘贴文本，效力等同 */}
        <div className="space-y-2 border-t border-dashed border-ink/20 pt-5">
          <label
            htmlFor="resume-paste"
            className="block text-xs tracking-wide text-pencil"
          >
            {COPY.resumes.pasteLabel}
          </label>
          <Textarea
            id="resume-paste"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={COPY.resumes.pastePlaceholder}
            className="min-h-36 rounded-none border-ink/20 focus-visible:border-ink-blue focus-visible:ring-ink-blue/25"
          />
          <p className="text-xs leading-5 text-pencil">{COPY.resumes.pasteHint}</p>
          <Button
            variant="outline"
            className="w-full rounded-none"
            disabled={busy}
            onClick={() => void savePastedText()}
          >
            {busy ? COPY.resumes.saving : COPY.resumes.pasteButton}
          </Button>
        </div>

        {error && <ErrorAnnotation text={error} />}
      </CardContent>
    </Card>
  );
}

function ResumeCard({
  resume,
  no,
  onDeleted,
  onError,
}: {
  resume: ResumeRow;
  no: string;
  onDeleted: () => void;
  onError: () => void;
}) {
  const supabase = createSupabaseBrowserClient();
  const [expanded, setExpanded] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // B12：画像已结构化的档案展示摘要 + 考察点，未结构化的维持「画像待生成」占位
  const profile = resumeProfilePreview(resume.structured_json);
  // 简历缩略（常显）：画像 summary 优先，raw_text 摘录兜底——不看展开就能知道档案大概内容
  const digest = resumeDigest(resume);

  // 销档（B6）：先销索引行（ cascade 清面试记录），再尽力而为清 Storage 原件——
  // 顺序反过来会在行删除失败时留下「指向已删原件」的孤儿行
  async function destroy() {
    // 确认弹窗已前置：此函数由 ConfirmDialog 的 onConfirm 调用
    setDeleting(true);
    try {
      const { error } = await supabase
        .from("resumes")
        .delete()
        .eq("id", resume.id);
      if (error) {
        onError();
        return;
      }
      if (resume.storage_path) {
        // Storage 清理失败仅记日志：行已销毁，残留原件不影响数据正确性
        const { error: storageError } = await supabase.storage
          .from("resumes")
          .remove([resume.storage_path]);
        if (storageError) {
          console.error("[resumes] storage remove failed:", storageError.message);
        }
      }
      onDeleted();
    } catch {
      onError();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="border border-ink/15 bg-transparent">
      <div className="flex items-baseline justify-between border-b border-ink/15 px-5 py-4">
        <span className="font-mono text-sm tracking-widest">{no}</span>
        <span className="font-mono text-xs text-pencil">
          {COPY.resumes.dateLabel} {formatDate(resume.created_at)}
        </span>
      </div>
      {digest && (
        <p className="border-b border-ink/15 px-5 py-3 text-xs leading-5 text-pencil line-clamp-2">
          {digest}
        </p>
      )}
      <div className="px-5 py-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-sm text-ink/70 underline decoration-ink/30 underline-offset-4 hover:text-ink"
        >
          {expanded ? COPY.resumes.profileCollapse : COPY.resumes.profileExpand} ·{" "}
          {COPY.resumes.profileLabel}
        </button>
        {expanded && (
          profile ? (
            <div className="mt-3 border-l-2 border-ink/20 pl-4">
              <p className="text-sm leading-6 text-ink/80">
                {profile.summary}
                {profile.truncated ? "……" : ""}
              </p>
              {profile.skills.length > 0 && (
                <ul
                  aria-label={COPY.interview.skillTagLabel}
                  className="mt-3 flex flex-wrap gap-1.5"
                >
                  {profile.skills.map((skill) => (
                    <li
                      key={skill}
                      className="border border-ink/20 px-2 py-0.5 font-mono text-xs text-ink/70"
                    >
                      {skill}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-3 border-l-2 border-ink/20 pl-4 text-sm leading-6 text-pencil">
              {COPY.resumes.profilePending}
            </p>
          )
        )}
      </div>
      <div className="flex justify-end border-t border-ink/15 px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-none text-pencil hover:text-ink"
          disabled={deleting}
          onClick={() => setConfirmOpen(true)}
        >
          {deleting ? COPY.resumes.deleting : COPY.resumes.deleteButton}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={COPY.resumes.deleteTitle}
        description={COPY.resumes.deleteConfirm}
        confirmLabel={COPY.resumes.deleteButton}
        destructive
        onConfirm={() => void destroy()}
      />
    </li>
  );
}

export default function ResumesPage() {
  const supabase = createSupabaseBrowserClient();
  const [resumes, setResumes] = useState<ResumeRow[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("resumes")
      .select("id, created_at, storage_path, structured_json")
      .order("created_at", { ascending: true });
    if (error) {
      setListError(COPY.resumes.loadFailed);
      return;
    }
    setListError(null);
    setResumes((data ?? []) as ResumeRow[]);
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("resumes")
        .select("id, created_at, storage_path, structured_json, raw_text")
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) {
        setListError(COPY.resumes.loadFailed);
        return;
      }
      setListError(null);
      setResumes((data ?? []) as ResumeRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <BackButton className="mb-6" />
      <div className="mx-auto w-full max-w-6xl px-10 py-14">
        {/* 卷首 */}
        <header className="border-b border-ink/15 pb-8">
          <p className="font-mono text-xs tracking-[0.35em] text-pencil uppercase">
            {COPY.resumes.headerLabel}
          </p>
          <h1 className="mt-4 font-heading text-4xl font-semibold tracking-wide">
            {COPY.resumes.headerTitle}
          </h1>
          <p className="mt-3 max-w-xl border-l-2 border-ink/20 pl-4 text-sm leading-6 text-ink/70">
            {COPY.resumes.headerHint}
          </p>
        </header>

        {notice && (
          <p className="mt-6 border border-ink/20 bg-ink/[0.03] px-4 py-2 text-sm">
            ✓ {notice}
          </p>
        )}

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[380px_1fr]">
          <NewArchiveCard
            onCreated={(message) => {
              setNotice(message);
              void load();
            }}
          />

          {/* 档案索引：一卷一卡 */}
          <section>
            <div className="flex items-baseline justify-between border-b border-ink/15 pb-3">
              <h2 className="font-heading text-xl font-semibold">
                {COPY.resumes.listTitle}
              </h2>
              <span className="font-mono text-xs text-pencil">
                {COPY.resumes.listHint}
              </span>
            </div>
            {listError && (
              <div className="mt-5">
                <ErrorAnnotation text={listError} />
              </div>
            )}
            {resumes === null && !listError && (
              <p className="mt-5 text-sm text-pencil">{COPY.resumes.loading}</p>
            )}
            {resumes !== null && resumes.length === 0 && !listError && (
              <div className="mt-5 border border-dashed border-ink/20 px-6 py-10 text-center">
                <p className="font-heading text-lg font-semibold">
                  {COPY.resumes.listEmptyTitle}
                </p>
                <p className="mt-2 text-sm leading-6 text-pencil">
                  {COPY.resumes.listEmptyHint}
                </p>
              </div>
            )}
            {resumes !== null && resumes.length > 0 && (
              <ul className="mt-5 space-y-4">
                {resumes.map((resume, i) => (
                  <ResumeCard
                    key={resume.id}
                    resume={resume}
                    no={`${COPY.resumes.archiveNoPrefix} ${archiveNo(resumes.length - 1 - i)}`}
                    onDeleted={() => void load()}
                    onError={() => setListError(COPY.resumes.deleteFailed)}
                  />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
