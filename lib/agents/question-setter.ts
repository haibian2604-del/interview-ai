import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { splitInstructions } from "@/lib/ai/instructions";
import { withSchemaRetry } from "@/lib/ai/schema-retry";
import { salvageQuestionSet, salvageSingleQuestion } from "@/lib/ai/json-salvage";
import { getLlmConfig } from "@/lib/settings/service";
import { questionStage, type Difficulty, type QuestionStage } from "@/lib/orchestrator/real-mode";
import {
  QuestionSetSchema,
  QuestionSchema,
  type Question,
  type ResumeProfile,
} from "@/lib/ai/schemas";
import { SCHEMA_SHAPE_HINTS } from "@/lib/ai/schemas";

const TYPE_HINT: Record<string, string> = {
  skill: "考察技能栈掌握深度",
  project: "深挖简历项目经历",
  behavioral: "行为面试题（STAR）",
  mixed: "混合：技能、项目、行为题搭配",
};

/** 难度阶梯的阶段指令（编排器 questionStage 决定当前阶段，模型只执行） */
const STAGE_HINT: Record<QuestionStage, string> = {
  opening:
    "开场阶段（第 1-3 题）：出基础热身题——基于候选人简历与 JD 的基础问题（技能栈确认、经历概述、岗位理解），难度从低起步让候选人进入状态；不要出项目深挖或高难系统题。",
  core: "核心考察阶段（中段）：出中等偏上难度的题——围绕岗位核心技能与 JD 要求考察细节与深度。",
  deep: "收尾阶段（最后几题）：出全场最高难度的题——优先深挖简历项目的技术决策与取舍（项目题放在这个阶段），或考察系统设计与权衡。",
};

export function buildQuestionSetterMessages(input: {
  profile: ResumeProfile;
  jdText: string;
  position: string;
  interviewType: string;
  count: number;
}) {
  return [
    {
      role: "system" as const,
      content:
        "你是严格的面试出题官。根据候选人画像和目标 JD 出题。每题必须给出 skillTag（考察点）和 followupAnchor（如果回答含糊，最值得追问的具体方向）。不要出与 JD 和简历无关的泛泛题。" +
        "\n输出格式硬性要求：输出合法 JSON——最外层是 {\"questions\":[...]}，questions 数组必须扁平——每个元素直接是一道题的对象，且只含 content、type、skillTag、followupAnchor 四个字段；数组元素内部绝不允许再出现 questions 键或任何其他嵌套包裹。",
    },
    {
      role: "user" as const,
      content: `目标岗位：${input.position}
题型要求：${TYPE_HINT[input.interviewType] ?? input.interviewType}
题目数量：${input.count}

候选人画像：
${JSON.stringify(input.profile, null, 2)}

目标 JD：
${input.jdText || "（未提供，按岗位常识出题）"}`,
    },
  ];
}

export async function generateQuestions(
  userId: string,
  input: {
    profile: ResumeProfile;
    jdText: string;
    position: string;
    interviewType: "skill" | "project" | "behavioral" | "mixed";
    count: number;
  },
): Promise<Question[]> {
  const cfg = await getLlmConfig(userId);
  const result = await withSchemaRetry(QuestionSetSchema, async (corrective) => {
    const built = buildQuestionSetterMessages(input);
    const { instructions, messages } = splitInstructions(
      corrective ? [...built, { role: "user" as const, content: corrective }] : built,
    );
    const { object } = await generateObject({
      model: getModel("question-setter", cfg),
      // 模型/网关默认输出上限可能截断长 JSON（实测画像被掐断），显式给足；
      // 4096 为几乎所有模型的输出上限下限——更大值会被部分网关直接 400 拒绝
      maxOutputTokens: 4096,
      schema: QuestionSetSchema,
      instructions,
      messages,
    });
    return object;
  }, {
    shapeHint: SCHEMA_SHAPE_HINTS.questionSet,
    salvage: salvageQuestionSet,
    // 业务校验：模型少给题（如要 3 道只给 1 道）就带原因逼重试补齐；
    // 多给的由出口截断到 count，保证与用户选择一致
    validate: (value) =>
      value.questions.length >= input.count
        ? null
        : `题目数量不足：要求正好 ${input.count} 道，实际只给了 ${value.questions.length} 道，必须补齐到 ${input.count} 道`,
  });
  return result.questions.slice(0, input.count);
}

/** 难度基线的整场指令（用户创建时选择，叠加在难度阶梯之上） */
const DIFFICULTY_HINT: Record<Difficulty, string> = {
  easy:
    "整场难度基线：简单——以基础知识点为主：概念澄清、原理简述、基础应用与最佳实践；" +
    "即使收尾阶段也以基础综合应用为主，项目场景考察题整场不超过一两道。",
  medium:
    "整场难度基线：中等——按难度阶梯由简到难，收尾阶段进行项目深挖与综合考察。",
  hard:
    "整场难度基线：困难——以项目场景考察题为主：从开场即围绕简历项目的真实场景出题" +
    "（给定业务场景、线上故障、技术取舍让候选人分析），难度仍随阶梯递进至全场最高。",
};

/** 渐进出题：真实面试模式下逐题现场生成（历史感知、去重考察点、难度阶梯 + 难度基线） */
export function buildRealtimeQuestionMessages(input: {
  profile: ResumeProfile;
  jdText: string;
  position: string;
  askedQuestions: { content: string; skillTag: string }[];
  stage: QuestionStage;
  difficulty: Difficulty;
  /** 目标题数（10/15/20）：难度阶梯阶段边界按它等比划分 */
  target: number;
  lastExchange?: { question: string; answer: string };
}) {
  const askedList = input.askedQuestions.length
    ? input.askedQuestions.map((q, i) => `${i + 1}. [${q.skillTag}] ${q.content}`).join("\n")
    : "（尚未提问）";
  const lastExchangeBlock = input.lastExchange
    ? `\n候选人最近一轮回答（可顺延其中暴露的点深挖）：\n题目：${input.lastExchange.question}\n回答：${input.lastExchange.answer}`
    : "";
  return [
    {
      role: "system" as const,
      content:
        "你是综合面试官的出题顾问。根据候选人画像、目标 JD 和已问历史，生成恰好一道新面试题。" +
        "整场难度必须由简到难：开局基础热身，中段核心考察，收尾项目深挖/全场最高难度。" +
        "硬性要求：①只输出一道题；②考察点（skillTag）与题意不得与已问列表重复；" +
        "③type 从 skill/project/behavioral 中按题意自然选择；④每题必须给出 skillTag 与 followupAnchor。" +
        "\n输出格式：输出合法 JSON——{\"content\":\"…\",\"type\":\"…\",\"skillTag\":\"…\",\"followupAnchor\":\"…\"}，不要嵌套任何包裹键。",
    },
    {
      role: "user" as const,
      content: `目标岗位：${input.position}
目标 JD：
${input.jdText || "（未提供，按岗位常识出题）"}

整场难度基线（候选人自选，必须严格遵守）：
${DIFFICULTY_HINT[input.difficulty]}

当前难度阶段（必须严格遵守）：
${STAGE_HINT[input.stage]}

候选人画像：
${JSON.stringify(input.profile)}

已问题目（不得重复考察点）：
${askedList}${lastExchangeBlock}`,
    },
  ];
}

export async function generateNextQuestion(
  userId: string,
  input: Omit<Parameters<typeof buildRealtimeQuestionMessages>[0], "stage">,
): Promise<Question> {
  const cfg = await getLlmConfig(userId);
  return withSchemaRetry(
    QuestionSchema,
    async (corrective) => {
      // 难度阶梯由编排器确定性决定（已问题数 + 目标题数 → 阶段），调用方无需传
      const built = buildRealtimeQuestionMessages({
        ...input,
        stage: questionStage(input.askedQuestions.length, input.target),
      });
      const { instructions, messages } = splitInstructions(
        corrective ? [...built, { role: "user" as const, content: corrective }] : built,
      );
      const { object } = await generateObject({
        model: getModel("question-setter", cfg),
        maxOutputTokens: 4096, // 单题输出极短，无截断风险；与全局调用口径一致
        schema: QuestionSchema,
        instructions,
        messages,
      });
      return object;
    },
    {
      shapeHint: SCHEMA_SHAPE_HINTS.question,
      salvage: salvageSingleQuestion,
    },
  );
}
