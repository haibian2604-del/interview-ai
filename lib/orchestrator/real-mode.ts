import { FOLLOWUP_THRESHOLD, decideNextAction, type NextAction } from "./state-machine";

/** 真实面试模式的编排器确定性常量（模型不得决策；与 FOLLOWUP_THRESHOLD 同性质） */
export const REAL_MODE = {
  /** 默认目标题数（用户可在 10/15/20 中选择，逐场存 interviews.target_questions） */
  target: 10,
  targetOptions: [10, 15, 20] as const,
  minBeforeEarlyStop: 5,
  consecutiveLimit: 3,
  consecutiveScore: 0.4,
  averageScore: 0.45,
  /** 防御性上限 = 目标 + 5：正常终止在 target 必然触发，此值仅兜底 */
  maxOverrun: 5,
} as const;

export type InterviewMode = "practice" | "real";

export function parseMode(v: unknown): InterviewMode {
  return v === "real" ? "real" : "practice";
}

export type Difficulty = "easy" | "medium" | "hard";

export function parseDifficulty(v: unknown): Difficulty {
  return v === "easy" || v === "hard" ? v : "medium";
}

/** 题数仅认 10/15/20，其余（缺省/乱值）一律回落默认 10 */
export function parseTargetQuestions(v: unknown): number {
  return v === 15 || v === 20 ? v : REAL_MODE.target;
}

export type QuestionStage = "opening" | "core" | "deep";

/**
 * 难度阶梯（确定性）：由简到难是编排器规则，不是模型自由发挥——
 * 开局（前 30%）基础热身（基于简历与 JD 的基础题），中段核心考察，
 * 收尾（后 30%）项目深挖/全场最高难度（项目题放后）。
 * 阶段边界按所选目标题数等比划分（10/15/20 通用）。
 */
export function questionStage(askedCount: number, target: number = REAL_MODE.target): QuestionStage {
  const progress = askedCount / target;
  if (progress < 0.3) return "opening";
  if (progress < 0.7) return "core";
  return "deep";
}

export type Termination = { terminate: boolean; reason: "target" | "early" | null };

/**
 * 性能驱动的结束规则（spec 第三节）：
 * - 答满 target（或触达防御性上限 target + maxOverrun）→ target；
 * - 已答 ≥ minBeforeEarlyStop 且（末尾连续 consecutiveLimit 题 < consecutiveScore
 *   或 累计均值 < averageScore）→ early；
 * - 否则继续。
 */
export function checkTermination(
  composites: number[],
  target: number = REAL_MODE.target,
): Termination {
  if (composites.length >= target + REAL_MODE.maxOverrun) return { terminate: true, reason: "target" };
  if (composites.length >= target) return { terminate: true, reason: "target" };
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
  target?: number;
}): { action: NextAction; endEarly: boolean } {
  const followupDue = params.score < FOLLOWUP_THRESHOLD && params.followupCount < 1;
  if (!followupDue) {
    const termination = checkTermination(params.composites, params.target);
    if (termination.terminate) {
      return { action: { action: "finish" }, endEarly: termination.reason === "early" };
    }
  }
  return {
    action: decideNextAction({ score: params.score, followupCount: params.followupCount, isLastQuestion: false }),
    endEarly: false,
  };
}
