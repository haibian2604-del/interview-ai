import { generateObject } from "ai";
import { getModel } from "@/lib/ai/provider";
import { DIMENSIONS, RUBRIC } from "@/lib/orchestrator/rubric";
import { EvaluationSchema, type Evaluation, type Question } from "@/lib/ai/schemas";

const PERSONA =
  "你是一位以严格著称的面试评估官。独立评估候选人的回答，与面试官话术无关。避免普遍给高分：只有真正出色的回答才配高分。";

export function buildEvaluatorMessages(input: {
  question: Question;
  transcript: { role: string; content: string }[];
}) {
  const rubricText = DIMENSIONS.map((d) => `- ${d}: ${RUBRIC[d]}`).join("\n");
  const transcriptText = input.transcript
    .map((m) => `${m.role === "candidate" ? "候选人" : "面试官"}：${m.content}`)
    .join("\n");
  return [
    {
      role: "system" as const,
      content: `${PERSONA}\n评分维度与标准（每维 0-1 分）：\n${rubricText}`,
    },
    {
      role: "user" as const,
      content: `题目（考察点：${input.question.skillTag}；追问锚点：${input.question.followupAnchor}）：\n${input.question.content}\n\n对话记录：\n${transcriptText}`,
    },
  ];
}

export async function evaluateAnswer(input: {
  question: Question;
  transcript: { role: string; content: string }[];
}): Promise<Evaluation> {
  const { object } = await generateObject({
    model: getModel("evaluator"),
    schema: EvaluationSchema,
    messages: buildEvaluatorMessages(input),
  });
  return object;
}
