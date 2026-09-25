import { DIMENSIONS, FOLLOWUP_THRESHOLD, type Dimension } from "./rubric";

export { FOLLOWUP_THRESHOLD };

export type NextAction =
  | { action: "followup" }
  | { action: "next_question" }
  | { action: "finish" };

export function averageScore(scores: Record<Dimension, number>): number {
  return DIMENSIONS.reduce((sum, d) => sum + scores[d], 0) / DIMENSIONS.length;
}

/**
 * 编排器的确定性追问规则（唯一事实来源，模型不得决策）：
 * score < 0.65 且本题未追问过 → 追问（即使已是最后一题，也要先追问再结束）
 */
export function decideNextAction(params: {
  score: number;
  followupCount: number;
  isLastQuestion: boolean;
}): NextAction {
  if (params.score < FOLLOWUP_THRESHOLD && params.followupCount < 1) {
    return { action: "followup" };
  }
  return params.isLastQuestion
    ? { action: "finish" }
    : { action: "next_question" };
}
