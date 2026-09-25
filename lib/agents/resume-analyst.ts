import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { splitInstructions } from "@/lib/ai/instructions";
import { getLlmConfig } from "@/lib/settings/service";
import { ResumeProfileSchema, type ResumeProfile } from "@/lib/ai/schemas";

const PERSONA =
  "你是资深 HR 顾问，擅长从简历原文中提取结构化职业画像。只依据原文提取，不编造。";

export function buildResumeAnalystMessages(rawText: string) {
  return [
    { role: "system" as const, content: PERSONA },
    { role: "user" as const, content: `简历原文：\n${rawText}` },
  ];
}

export async function analyzeResume(userId: string, rawText: string): Promise<ResumeProfile> {
  const { object } = await generateObject({
    model: getModel("resume-analyst", await getLlmConfig(userId)),
    schema: ResumeProfileSchema,
    ...splitInstructions(buildResumeAnalystMessages(rawText)),
  });
  return object;
}
