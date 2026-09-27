import type { Question } from "@/lib/ai/schemas";

/**
 * 「项目题问穿」技能（参考 ASu-skills /interview 的 Grill 模式裁剪）：
 * 项目题不问泛泛题，每题锁定简历中的一条可验证 Claim（主张），追问只追最关键的缺失证据，
 * 并有明确的降阶与停止条件——把简历问穿，但不无限追问（每题追问次数仍由状态机硬顶）。
 * 适用范围：真实面试模式下的项目题（isProjectGrillApplicable 路由）。
 */

export const PROJECT_GRILL = { id: "project-grill", name: "项目题问穿" } as const;

/** 仅真实面试的项目题启用（practice 题库一次性出卷、非项目题维持通用链路） */
export function isProjectGrillApplicable(mode: string, questionType: string): boolean {
  return mode === "real" && questionType === "project";
}

/** 五类 Claim 与各自的验证重点（技能核心分类法） */
export const CLAIM_TAXONOMY: ReadonlyArray<{ kind: string; probe: string }> = [
  { kind: "Ownership（个人边界）", probe: "追问个人范围、亲自实现的部分、关键决策；项目整体成果不自动算成个人成果" },
  { kind: "Metric（指标口径）", probe: "追问 baseline、统计周期、数据来源与个人归因，不接受只报百分比" },
  { kind: "Technical（技术作用）", probe: "追到技术在项目里的输入输出、具体作用与选型原因，不满足于百科定义" },
  { kind: "Architecture（架构边界）", probe: "追问组件与数据流、替代方案、故障处理和扩展限制" },
  { kind: "Result（真实结果）", probe: "追问是否真实交付、谁在使用、如何衡量、个人动作与团队结果的边界" },
];

/**
 * 出题侧契约：注入真实面试的单题生成提示词。
 * 题型由模型自然选择——本契约只在它选了项目题时生效：
 * 锁定一条 Claim、skillTag 用 Claim 主题、followupAnchor 给下一层追问方向。
 */
export function projectGrillQuestionContract(): string {
  const claims = CLAIM_TAXONOMY.map((c) => `${c.kind}：${c.probe}`).join("；");
  return (
    `项目题问穿契约（本题 type 选 project 时必须遵守）：不出泛泛的项目题，锁定简历中的一条具体 Claim 出题，` +
    `判断候选人是否真的做过。skillTag 用该 Claim 的主题（与已问列表去重）；` +
    `followupAnchor 写下一层最值得追问的具体方向（替代方案、统计口径、个人边界或故障场景）。` +
    `五类 Claim 与验证重点：${claims}。`
  );
}

/**
 * 追问侧指令：真实面试项目题触发追问时，拼进面试官的 followupText。
 * 只追一个最关键缺失证据 + 风险信号清单 + 卡住降阶（停止条件由状态机硬顶兜底）。
 */
export function projectGrillFollowupDirectives(input: {
  anchor: string;
  improvements: string;
}): string {
  return (
    `本项目题正在问穿一条 Claim（考察点：${input.anchor}），评估发现回答的不足：${input.improvements}。` +
    `追问规则：只追一个最关键的缺失证据，一次只问一个问题；` +
    `优先追这些风险信号——模糊词（负责/优化/提升）没有对象动作和证据；报了数字说不清口径（baseline/周期/来源）；` +
    `强表述（主导/架构/Owner）划不清个人边界；只会 happy path 说不清失败与回滚；背术语定义说不清在项目中的作用；` +
    `与简历或前面的回答矛盾。候选人明显卡住时降阶为最小事实问题；不要替候选人补造项目事实。`
  );
}

/** 供路由快速取通用追问文案的类型对齐（防止误用 Question 多余字段） */
export type ProjectGrillQuestion = Pick<Question, "skillTag" | "followupAnchor">;
