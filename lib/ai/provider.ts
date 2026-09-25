import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { optionalEnv, requireEnv } from "@/lib/env";

export type AgentKind =
  | "resume-analyst"
  | "question-setter"
  | "interviewer"
  | "evaluator"
  | "report-writer";

/** 评估/报告用强模型，其余用廉价模型（Global Constraints） */
const STRONG_KINDS: AgentKind[] = ["evaluator", "report-writer"];

export function getModel(kind: AgentKind): LanguageModel {
  const baseURL = requireEnv("LLM_BASE_URL");
  const apiKey = requireEnv("LLM_API_KEY");
  const chatModel = requireEnv("LLM_CHAT_MODEL");
  const modelId =
    STRONG_KINDS.includes(kind)
      ? (optionalEnv("LLM_EVAL_MODEL") ?? chatModel)
      : chatModel;
  const provider = createOpenAICompatible({ name: "llm", baseURL, apiKey });
  return provider(modelId);
}
