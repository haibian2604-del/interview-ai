import { describe, expect, it, beforeEach, afterEach } from "vitest";

describe("getModel / requireEnv", () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    process.env.LLM_BASE_URL = "https://api.example.com/v1";
    process.env.LLM_API_KEY = "sk-test";
    process.env.LLM_CHAT_MODEL = "cheap-model";
    process.env.LLM_EVAL_MODEL = "strong-model";
  });
  afterEach(() => { process.env = { ...ORIG }; });

  it("廉价 Agent 使用 CHAT 模型", async () => {
    const { getModel } = await import("@/lib/ai/provider");
    const m = getModel("interviewer") as unknown as { modelId: string };
    expect(m.modelId).toBe("cheap-model");
  });

  it("评估/报告 Agent 使用 EVAL 模型", async () => {
    const { getModel } = await import("@/lib/ai/provider");
    const m = getModel("evaluator") as unknown as { modelId: string };
    expect(m.modelId).toBe("strong-model");
  });

  it("EVAL 未配置时回落 CHAT", async () => {
    delete process.env.LLM_EVAL_MODEL;
    const { getModel } = await import("@/lib/ai/provider");
    const m = getModel("report-writer") as unknown as { modelId: string };
    expect(m.modelId).toBe("cheap-model");
  });

  it("缺必需 env 时抛出带 key 名的错误", async () => {
    delete process.env.LLM_API_KEY;
    const { requireEnv } = await import("@/lib/env");
    expect(() => requireEnv("LLM_API_KEY")).toThrow(/LLM_API_KEY/);
  });
});
