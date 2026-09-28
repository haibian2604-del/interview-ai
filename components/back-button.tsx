"use client";

import { useRouter } from "next/navigation";
import { COPY } from "@/lib/copy";

/** 评分簿「返回」按钮：默认回退浏览器历史，无历史（直达链接/刷新）时回落目录页；
 * 传 href 时固定跳转——评语册等终端页的「返回」语义是回目录，不是回退进已结束的卷面 */
export function BackButton({ className = "", href }: { className?: string; href?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => {
        if (href) {
          router.push(href);
          return;
        }
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
