import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { splitInstructions } from "@/lib/ai/instructions";
import { withSchemaRetry } from "@/lib/ai/schema-retry";
import { getLlmConfig } from "@/lib/settings/service";
import { QuestionSetSchema, type Question, type ResumeProfile } from "@/lib/ai/schemas";
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
        "你是严格的面试出题官。根据候选人画像和目标 JD 出题。每题必须给出 skillTag（考察点）和 followupAnchor（如果回答含糊，最值得追问的具体方向）。不要出与 JD 和简历无关的泛泛题。",
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
  }, { shapeHint: SCHEMA_SHAPE_HINTS.questionSet });
  return result.questions;
}
