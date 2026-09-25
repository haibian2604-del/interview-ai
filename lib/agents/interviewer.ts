import { streamText } from "ai";
import { getModel } from "@/lib/ai/provider";
import { splitInstructions } from "@/lib/ai/instructions";
import { getLlmConfig } from "@/lib/settings/service";
import type { Question } from "@/lib/ai/schemas";

export const INTERVIEWER_PERSONA =
  "你是一位专业、友好的中文面试官。语气自然口语化，一次只问一个问题，不透露评分标准，不替候选人回答。";

type InterviewerMode = "ask" | "followup" | "transition";

export function buildInterviewerMessages(
  mode: InterviewerMode,
  payload: {
    question: Question;
    history: { role: "interviewer" | "candidate" | "followup"; content: string }[];
    followupText: string | null;
    nextQuestion?: Question;
  },
) {
  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: INTERVIEWER_PERSONA },
  ];
  for (const m of payload.history) {
    messages.push({
      role: m.role === "candidate" ? "user" : "assistant",
      content: m.content,
    });
  }
  if (mode === "ask") {
    messages.push({ role: "user", content: `请向候选人提出这道题：${payload.question.content}` });
  } else if (mode === "followup") {
    messages.push({ role: "user", content: `用你自己的话向候选人追问（不要逐字念）：${payload.followupText}` });
  } else {
    messages.push({
      role: "user",
      content: payload.nextQuestion
        ? `感谢候选人上一题的回答，简短过渡（一句话），然后提出下一题：${payload.nextQuestion.content}`
        : `面试已全部结束，向候选人致谢并简短收尾（两三句话）。`,
    });
  }
  return messages;
}

export async function streamInterviewer(
  userId: string,
  mode: InterviewerMode,
  payload: Parameters<typeof buildInterviewerMessages>[1],
) {
  return streamText({
    model: getModel("interviewer", await getLlmConfig(userId)),
    ...splitInstructions(buildInterviewerMessages(mode, payload)),
  });
}
