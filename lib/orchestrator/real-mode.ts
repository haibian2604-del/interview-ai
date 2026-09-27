import { FOLLOWUP_THRESHOLD, decideNextAction, type NextAction } from "./state-machine";

/** 真实面试模式的编排器确定性常量（模型不得决策；与 FOLLOWUP_THRESHOLD 同性质） */
export const REAL_MODE = {
  target: 10,
  minBeforeEarlyStop: 5,
  consecutiveLimit: 3,
  consecutiveScore: 0.4,
  averageScore: 0.45,
  maxQuestions: 15,
} as const;

export type InterviewMode = "practice" | "real";

export function parseMode(v: unknown): InterviewMode {
  return v === "real" ? "real" : "practice";
}

export type Termination = { terminate: boolean; reason: "target" | "early" | null };

/**
 * 性能驱动的结束规则（spec 第三节）：
 * - 答满 target（或触达防御性上限）→ target；
 * - 已答 ≥ minBeforeEarlyStop 且（末尾连续 consecutiveLimit 题 < consecutiveScore
 *   或 累计均值 < averageScore）→ early；
 * - 否则继续。
 */
export function checkTermination(composites: number[]): Termination {
  if (composites.length >= REAL_MODE.maxQuestions) return { terminate: true, reason: "target" };
  if (composites.length >= REAL_MODE.target) return { terminate: true, reason: "target" };
  if (composites.length < REAL_MODE.minBeforeEarlyStop) return { terminate: false, reason: null };
  const tail = composites.slice(-REAL_MODE.consecutiveLimit);
  const consecutiveLow =
    tail.length === REAL_MODE.consecutiveLimit && tail.every((s) => s < REAL_MODE.consecutiveScore);
  const avg = composites.reduce((sum, s) => sum + s, 0) / composites.length;
  const avgLow = avg < REAL_MODE.averageScore;
  if (consecutiveLow || avgLow) return { terminate: true, reason: "early" };
  return { terminate: false, reason: null };
}

/**
 * real 模式的行动决策：追问优先于终止（与 practice「追问优先于结束」同语义）；
 * real 模式永不因「索引见底」而 finish——结束只来自 checkTermination。
 */
export function decideRealNextAction(params: {
  score: number;
  followupCount: number;
  composites: number[];
}): { action: NextAction; endEarly: boolean } {
  const followupDue = params.score < FOLLOWUP_THRESHOLD && params.followupCount < 1;
  if (!followupDue) {
    const termination = checkTermination(params.composites);
    if (termination.terminate) {
      return { action: { action: "finish" }, endEarly: termination.reason === "early" };
    }
  }
  return {
    action: decideNextAction({ score: params.score, followupCount: params.followupCount, isLastQuestion: false }),
    endEarly: false,
  };
}
