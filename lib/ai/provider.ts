import type { LanguageModel } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LlmConfig } from "@/lib/settings/service";

export type AgentKind =
  | "resume-analyst"
  | "question-setter"
  | "interviewer"
  | "evaluator"
  | "report-writer";

/** 评估/报告用强模型，其余用廉价模型（Global Constraints） */
const STRONG_KINDS: AgentKind[] = ["evaluator", "report-writer"];

/** 模型路由只认传入配置（用户配置优先、env 兜底的合并结果由 lib/settings/service 产出） */
export function getModel(kind: AgentKind, cfg: LlmConfig): LanguageModel {
  const modelId =
    STRONG_KINDS.includes(kind)
      ? (cfg.evalModel ?? cfg.chatModel)
      : cfg.chatModel;
  const provider = createOpenAICompatible({ name: "llm", baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  return provider(modelId);
}
