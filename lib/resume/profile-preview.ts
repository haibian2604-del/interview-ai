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
