import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeResume } from "@/lib/agents/resume-analyst";
import type { ResumeProfile } from "@/lib/ai/schemas";

type Db = SupabaseClient;

/**
 * 面试用的候选人画像：已结构化直接用；否则现场分析并回写
 * （写库失败仅记日志——画像已拿到，回写失败不影响本场面试）。
 * 与 create practice 分支的区别：回写失败不回滚（这里没有"整卷"要回滚）。
 */
export async function loadInterviewProfile(
  supabase: Db,
  userId: string,
  resumeId: string,
): Promise<ResumeProfile> {
  const { data: resume, error } = await supabase
    .from("resumes")
    .select("raw_text, structured_json")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .single();
  if (error || !resume) throw new Error(error?.message ?? "resume not found");
  const existing = (resume.structured_json as ResumeProfile | null) ?? null;
  if (existing) return existing;
  const profile = await analyzeResume(userId, resume.raw_text);
  const { error: writeError } = await supabase
    .from("resumes")
    .update({ structured_json: profile })
    .eq("id", resumeId);
  if (writeError) {
    console.error("[interview/profile] writeback structured_json failed:", writeError.message);
  }
  return profile;
}
