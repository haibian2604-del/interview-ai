import type { SupabaseClient } from "@supabase/supabase-js";
import { averageScore } from "@/lib/orchestrator/state-machine";
import type { Dimension } from "@/lib/orchestrator/rubric";

/** 按题序返回各题综合分（四维均值；缺评估的题跳过）。终止规则引擎的输入。 */
export async function loadCompositeScores(
  supabase: SupabaseClient,
  interviewId: string,
): Promise<number[]> {
  const { data: qRows, error: qError } = await supabase
    .from("questions")
    .select("id")
    .eq("interview_id", interviewId)
    .order("idx");
  if (qError) throw new Error(qError.message);
  const ids = (qRows ?? []).map((q) => q.id as string);
  if (ids.length === 0) return [];
  const { data: eRows, error: eError } = await supabase
    .from("evaluations")
    .select("question_id, scores")
    .in("question_id", ids);
  if (eError) throw new Error(eError.message);
  const byQuestion = new Map(
    (eRows ?? []).map((e) => [e.question_id as string, e.scores as Record<Dimension, number>]),
  );
  return ids
    .map((id) => byQuestion.get(id))
    .filter((s): s is Record<Dimension, number> => !!s)
    .map((s) => averageScore(s));
}
