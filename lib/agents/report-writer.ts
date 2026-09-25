import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { getLlmConfig } from "@/lib/settings/service";
import { DIMENSIONS, RUBRIC } from "@/lib/orchestrator/rubric";
import { ReportSchema, type Evaluation, type Report } from "@/lib/ai/schemas";

const PERSONA =
  "你是面试教练，基于逐题评估数据撰写综合报告：总分（0-100）、四维分、优势、改进建议（教练式、可执行）。";

export function buildReportMessages(input: {
  position: string;
  questionContents: string[];
  evaluations: Evaluation[];
}) {
  const perQuestion = input.questionContents
    .map((q, i) => {
      const e = input.evaluations[i];
      return `题${i + 1}：${q}\n评分：${JSON.stringify(e.scores)}\nSTAR 完整度：${e.starCompleteness}\n亮点：${e.strengths}\n不足：${e.improvements}`;
    })
    .join("\n\n");
  const rubricText = DIMENSIONS.map((d) => `${d}=${RUBRIC[d]}`).join("；");
  return [
    { role: "system" as const, content: `${PERSONA}\n维度说明：${rubricText}` },
    { role: "user" as const, content: `岗位：${input.position}\n\n逐题评估：\n${perQuestion}` },
  ];
}

export async function generateReport(
  userId: string,
  input: {
    position: string;
    questionContents: string[];
    evaluations: Evaluation[];
  },
): Promise<Report> {
  const { object } = await generateObject({
    model: getModel("report-writer", await getLlmConfig(userId)),
    schema: ReportSchema,
    messages: buildReportMessages(input),
  });
  return object;
}
