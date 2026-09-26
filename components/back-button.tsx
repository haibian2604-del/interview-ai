"use client";

import { useRouter } from "next/navigation";
import { COPY } from "@/lib/copy";

/** 评分簿「返回」按钮：回退浏览器历史，无历史（直达链接/刷新）时回落目录页 */
export function BackButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push("/dashboard");
      }}
      className={`inline-flex items-center gap-1.5 rounded-none border border-ink/15 bg-transparent px-3 py-1.5 font-mono text-xs tracking-widest text-ink/70 transition-colors hover:border-ink/40 hover:text-ink focus-visible:border-ink-blue focus-visible:outline-none ${className}`}
    >
      <span aria-hidden>←</span>
      {COPY.common.back}
    </button>
  );
}
