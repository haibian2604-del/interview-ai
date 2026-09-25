// 题量区间与出题对账的单一事实来源：
// schema 只约束模型产出 3-10 题，不保证等于请求值，
// 因此入服务前先钳制请求值，落库后再以 questions 实际行数回写 question_count。
export const QUESTION_COUNT_MIN = 3;
export const QUESTION_COUNT_MAX = 10;
export const QUESTION_COUNT_DEFAULT = 6;

export function clampQuestionCount(value: number | undefined | null): number {
  if (value == null || Number.isNaN(value)) return QUESTION_COUNT_DEFAULT;
  return Math.min(
    QUESTION_COUNT_MAX,
    Math.max(QUESTION_COUNT_MIN, Math.round(value)),
  );
}
