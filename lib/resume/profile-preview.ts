import type { ResumeProfile } from "@/lib/ai/schemas";

/** 简历卡画像摘要视图（B12）：summary 截断 80 字 + skills 前 6 个 */
export type ResumeProfilePreview = {
  summary: string;
  /** summary 是否因超出 80 字被截断（客户端据此补省略号） */
  truncated: boolean;
  skills: string[];
};

/** 从未知形状的 structured_json 里防御性取画像视图：形状不符（含数组/null）一律视为未生成 */
export function resumeProfilePreview(structuredJson: unknown): ResumeProfilePreview | null {
  if (structuredJson === null || typeof structuredJson !== "object" || Array.isArray(structuredJson)) {
    return null;
  }
  const candidate = structuredJson as Partial<ResumeProfile>;
  if (typeof candidate.summary !== "string" || !Array.isArray(candidate.skills)) {
    return null;
  }
  const skills = candidate.skills.filter((s): s is string => typeof s === "string");
  return {
    summary: candidate.summary.slice(0, 80),
    truncated: candidate.summary.length > 80,
    skills: skills.slice(0, 6),
  };
}

/**
 * 简历原文摘录视图（展开区默认态）：空白归一后截前 limit 字，
 * 配 truncated 标记供客户端补省略号。全文展示不用这里（保留原排版）。
 */
export type ResumeRawExcerpt = { text: string; truncated: boolean };

export function resumeRawExcerpt(
  rawText: string | null | undefined,
  limit = 400,
): ResumeRawExcerpt {
  const flat = (rawText ?? "").replace(/\s+/g, " ").trim();
  return { text: flat.slice(0, limit), truncated: flat.length > limit };
}

/** 按原件路径判断简历是否 Markdown（粘贴档案无原件 = 纯文本，不参与渲染） */
export function isMarkdownResume(storagePath: string | null | undefined): boolean {
  const p = (storagePath ?? "").toLowerCase();
  return p.endsWith(".md") || p.endsWith(".markdown");
}

/**
 * 轻量 Markdown 标记剥离（供纯文本摘录用）：不追求 AST 级无损，
 * 常见语法清干净即可——标题前缀、列表符、强调、链接取文本、行内代码、转义符。
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/```[a-z]*\n?/g, "") // 代码围栏行（保留围栏内内容）
    .replace(/\\([\\`*_{}[\]()#+.!~-])/g, "$1") // 转义符
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // 图片 → alt 文本
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 链接文本
    .replace(/^#{1,6}\s+/gm, "") // 标题前缀
    .replace(/^[ \t]*[-*+][ \t]+/gm, "") // 无序列表符
    .replace(/^[ \t]*\d+\.[ \t]+/gm, "") // 有序列表符
    .replace(/\*\*([^*]+)\*\*/g, "$1") // 粗体
    .replace(/\*([^*\n]+)\*/g, "$1") // 斜体
    .replace(/`([^`]+)`/g, "$1") // 行内代码
    .replace(/[ \t]{2,}/g, " "); // 剥离后的连缀空格
}

/**
 * 简历缩略：让用户一眼知道这份档案大概是什么。
 * 画像已生成用 summary；否则从 raw_text 摘前 80 个非空白字符兜底
 * （未跑过画像分析的档案也有内容可看）。两者皆无 → null（显示占位）。
 */
export function resumeDigest(resume: {
  structured_json: unknown;
  raw_text?: string | null;
}): string | null {
  const preview = resumeProfilePreview(resume.structured_json);
  if (preview?.summary) return preview.summary;
  const flat = (resume.raw_text ?? "").replace(/\s+/g, " ").trim();
  return flat ? flat.slice(0, 80) : null;
}
