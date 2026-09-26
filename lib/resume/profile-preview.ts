import type { ResumeProfile } from "@/lib/ai/schemas";

/** 简历卡画像摘要视图（B12）：summary 截断 80 字 + skills 前 6 个 */
export type ResumeProfilePreview = {
  summary: string;
  /** summary 是否因超出 80 字被截断（客户端据此补省略号） */
  truncated: boolean;
  skills: string[];
};

export const PROFILE_SUMMARY_MAX_CHARS = 80;
export const PROFILE_SKILLS_LIMIT = 6;

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
    summary: candidate.summary.slice(0, PROFILE_SUMMARY_MAX_CHARS),
    truncated: candidate.summary.length > PROFILE_SUMMARY_MAX_CHARS,
    skills: skills.slice(0, PROFILE_SKILLS_LIMIT),
  };
}
