import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { splitInstructions } from "@/lib/ai/instructions";
import { withSchemaRetry } from "@/lib/ai/schema-retry";
import { salvageQuestionSet, salvageSingleQuestion } from "@/lib/ai/json-salvage";
import { getLlmConfig } from "@/lib/settings/service";
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
        "\n输出格式硬性要求：最外层是 {\"questions\":[...]}，questions 数组必须扁平——每个元素直接是一道题的对象，且只含 content、type、skillTag、followupAnchor 四个字段；数组元素内部绝不允许再出现 questions 键或任何其他嵌套包裹。",
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

/** 渐进出题：真实面试模式下逐题现场生成（历史感知、去重考察点） */
export function buildRealtimeQuestionMessages(input: {
  profile: ResumeProfile;
  jdText: string;
  position: string;
  askedQuestions: { content: string; skillTag: string }[];
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
        "硬性要求：①只输出一道题；②考察点（skillTag）与题意不得与已问列表重复；" +
        "③type 从 skill/project/behavioral 中按题意自然选择；④每题必须给出 skillTag 与 followupAnchor。" +
        "\n输出格式：{\"content\":\"…\",\"type\":\"…\",\"skillTag\":\"…\",\"followupAnchor\":\"…\"}，不要嵌套任何包裹键。",
    },
    {
      role: "user" as const,
      content: `目标岗位：${input.position}
目标 JD：
${input.jdText || "（未提供，按岗位常识出题）"}

候选人画像：
${JSON.stringify(input.profile)}

已问题目（不得重复考察点）：
${askedList}${lastExchangeBlock}`,
    },
  ];
}

export async function generateNextQuestion(
  userId: string,
  input: Parameters<typeof buildRealtimeQuestionMessages>[0],
): Promise<Question> {
  const cfg = await getLlmConfig(userId);
  return withSchemaRetry(
    QuestionSchema,
    async (corrective) => {
      const built = buildRealtimeQuestionMessages(input);
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
