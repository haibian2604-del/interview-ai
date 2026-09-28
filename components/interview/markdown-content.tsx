"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 考官输出的 Markdown 渲染（评分簿世界规则）：
 * - 链接不用蓝——蓝墨保留给候选人作答；下划线纸墨色即可
 * - 强调靠加重不加色；代码块/引用用方角 hairline，与卷面同构
 * - 白空 pre-line：模型输出的单换行按换行显示（聊天惯例），
 *   块间距由 [&>*+*] 统一，段落内部交还 Markdown
 */
export function MarkdownContent({ content }: { content: string }) {
  return (
    <div
      className={`whitespace-pre-line text-[15px] leading-7 text-ink [&>*+*]:mt-3 [&_a]:underline [&_a]:decoration-ink/40 [&_a]:underline-offset-4 [&_blockquote]:border-l-2 [&_blockquote]:border-ink/20 [&_blockquote]:pl-3 [&_blockquote]:text-ink/70 [&_code]:border [&_code]:border-ink/20 [&_code]:bg-ink/[0.04] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] [&_h1]:font-heading [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_img]:max-w-full [&_li]:leading-7 [&_mark]:bg-ink/[0.08] [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:m-0 [&_pre]:overflow-x-auto [&_pre]:border [&_pre]:border-ink/20 [&_pre]:bg-transparent [&_pre]:px-3 [&_pre]:py-2 [&_pre_code]:border-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_strong]:font-semibold [&_table]:w-full [&_table]:border-collapse [&_table]:text-[13px] [&_td]:border [&_td]:border-ink/20 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-ink/20 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
