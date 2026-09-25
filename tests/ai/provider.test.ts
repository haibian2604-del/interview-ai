import { describe, expect, it } from "vitest";

import type { LlmConfig } from "@/lib/settings/service";
import type { getModel } from "@/lib/ai/provider";

describe("getModel(kind, cfg) 路由", () => {
  const cfg: LlmConfig = {
    baseURL: "https://api.example.com/v1",
    apiKey: "sk-test",
    chatModel: "cheap-model",
    evalModel: "strong-model",
  };

  async function modelIdOf(kind: Parameters<typeof getModel>[0], c: LlmConfig) {
    const { getModel } = await import("@/lib/ai/provider");
    return (getModel(kind, c) as unknown as { modelId: string }).modelId;
  }

  it("廉价 Agent（resume-analyst/question-setter/interviewer）使用 cfg.chatModel", async () => {
    expect(await modelIdOf("resume-analyst", cfg)).toBe("cheap-model");
    expect(await modelIdOf("question-setter", cfg)).toBe("cheap-model");
    expect(await modelIdOf("interviewer", cfg)).toBe("cheap-model");
  });

  it("评估/报告 Agent 使用 cfg.evalModel", async () => {
    expect(await modelIdOf("evaluator", cfg)).toBe("strong-model");
    expect(await modelIdOf("report-writer", cfg)).toBe("strong-model");
  });

  it("cfg.evalModel 未配置时评估/报告回落 cfg.chatModel", async () => {
    const noEval = { ...cfg, evalModel: undefined };
    expect(await modelIdOf("evaluator", noEval)).toBe("cheap-model");
    expect(await modelIdOf("report-writer", noEval)).toBe("cheap-model");
  });

  it("provider 使用 cfg 的 baseURL 与 apiKey", async () => {
    const { getModel } = await import("@/lib/ai/provider");
    const m = getModel("interviewer", cfg) as unknown as {
      config: {
        url: (args: { path: string }) => URL;
        headers: () => Record<string, string>;
      };
    };
    expect(m.config.url({ path: "/chat/completions" }).toString()).toMatch(
      /^https:\/\/api\.example\.com\/v1\/chat\/completions/,
    );
    expect(m.config.headers()["authorization"]).toBe("Bearer sk-test");
  });

  it("缺必需 env 时 requireEnv 抛出带 key 名的错误", async () => {
    const { requireEnv } = await import("@/lib/env");
    expect(() => requireEnv("LLM_API_KEY")).toThrow(/LLM_API_KEY/);
  });
});
