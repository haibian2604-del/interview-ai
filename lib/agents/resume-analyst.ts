import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { splitInstructions } from "@/lib/ai/instructions";
import { withSchemaRetry } from "@/lib/ai/schema-retry";
import { getLlmConfig } from "@/lib/settings/service";
import { ResumeProfileSchema, type ResumeProfile } from "@/lib/ai/schemas";
import { SCHEMA_SHAPE_HINTS } from "@/lib/ai/schemas";

const PERSONA =
  "你是资深 HR 顾问，擅长从简历原文中提取结构化职业画像。只依据原文提取，不编造。以 JSON 格式输出。";

export function buildResumeAnalystMessages(rawText: string) {
  return [
    { role: "system" as const, content: PERSONA },
    { role: "user" as const, content: `简历原文：\n${rawText}` },
  ];
}

export async function analyzeResume(userId: string, rawText: string): Promise<ResumeProfile> {
  const cfg = await getLlmConfig(userId);
  return withSchemaRetry(ResumeProfileSchema, async (corrective) => {
    const built = buildResumeAnalystMessages(rawText);
    const { instructions, messages } = splitInstructions(
      corrective ? [...built, { role: "user" as const, content: corrective }] : built,
    );
    const { object } = await generateObject({
      model: getModel("resume-analyst", cfg),
      // 模型/网关默认输出上限可能截断长 JSON（实测画像被掐断），显式给足；
      // 4096 为几乎所有模型的输出上限下限——更大值会被部分网关直接 400 拒绝
      maxOutputTokens: 4096,
      schema: ResumeProfileSchema,
      instructions,
      messages,
    });
    return object;
  }, { shapeHint: SCHEMA_SHAPE_HINTS.resumeProfile });
}
