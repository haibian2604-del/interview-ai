import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import type { UserLlmSettings } from "@/lib/settings/service";

describe("settings/resolveConfig（用户配置优先、env 逐字段兜底）", () => {
  const ORIG = { ...process.env };
  beforeEach(() => {
    vi.stubEnv("SETTINGS_SECRET", "test-settings-secret-high-entropy");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...ORIG };
  });

  const env = {
    llmBaseUrl: "https://env.example.com/v1",
    llmApiKey: "sk-env-key",
    llmChatModel: "env-chat-model",
    llmEvalModel: "env-eval-model",
  };

  const userRow = (over: Partial<UserLlmSettings>): UserLlmSettings => ({
    llmBaseUrl: null,
    llmApiKeyEnc: null,
    llmChatModel: null,
    llmEvalModel: null,
    ...over,
  });

  it("无用户配置（null 行）：全回落 env", async () => {
    const { resolveConfig } = await import("@/lib/settings/service");
    const cfg = resolveConfig(null, env);
    expect(cfg).toEqual({
      baseURL: "https://env.example.com/v1",
      apiKey: "sk-env-key",
      chatModel: "env-chat-model",
      evalModel: "env-eval-model",
    });
  });

  it("用户覆盖部分字段：其余字段仍回落 env", async () => {
    const { resolveConfig } = await import("@/lib/settings/service");
    const cfg = resolveConfig(
      userRow({ llmChatModel: "user-chat-model", llmBaseUrl: "https://user.example.com/v1" }),
      env,
    );
    expect(cfg.baseURL).toBe("https://user.example.com/v1");
    expect(cfg.chatModel).toBe("user-chat-model");
    expect(cfg.apiKey).toBe("sk-env-key");
    expect(cfg.evalModel).toBe("env-eval-model");
  });

  it("用户 key 密文被解密为明文 apiKey", async () => {
    const { encryptSecret } = await import("@/lib/settings/crypto");
    const { resolveConfig } = await import("@/lib/settings/service");
    const enc = encryptSecret("sk-user-plaintext-key");
    const cfg = resolveConfig(userRow({ llmApiKeyEnc: enc }), env);
    expect(cfg.apiKey).toBe("sk-user-plaintext-key");
  });

  it("用户 key 解密失败（如 SETTINGS_SECRET 轮换）：回落 env key，不炸", async () => {
    const { resolveConfig } = await import("@/lib/settings/service");
    const cfg = resolveConfig(userRow({ llmApiKeyEnc: "v1:not:a:valid-ciphertext" }), env);
    expect(cfg.apiKey).toBe("sk-env-key");
  });

  it("用户全字段配置时完全不依赖 env（env 可为空）", async () => {
    const { encryptSecret } = await import("@/lib/settings/crypto");
    const { resolveConfig } = await import("@/lib/settings/service");
    const cfg = resolveConfig(
      userRow({
        llmBaseUrl: "https://user.example.com/v1",
        llmApiKeyEnc: encryptSecret("sk-user-only"),
        llmChatModel: "user-chat",
        llmEvalModel: "user-eval",
      }),
      {},
    );
    expect(cfg).toEqual({
      baseURL: "https://user.example.com/v1",
      apiKey: "sk-user-only",
      chatModel: "user-chat",
      evalModel: "user-eval",
    });
  });

  it("evalModel 优先级：用户 > env > undefined", async () => {
    const { resolveConfig } = await import("@/lib/settings/service");
    expect(resolveConfig(userRow({ llmEvalModel: "user-eval" }), env).evalModel).toBe("user-eval");
    expect(resolveConfig(userRow({}), env).evalModel).toBe("env-eval-model");
    expect(resolveConfig(userRow({}), { ...env, llmEvalModel: undefined }).evalModel).toBeUndefined();
  });

  it("必填字段（baseURL/apiKey/chatModel）都缺失时抛出带 env key 名的错误", async () => {
    const { resolveConfig } = await import("@/lib/settings/service");
    expect(() => resolveConfig(null, {})).toThrow(/LLM_BASE_URL/);
    expect(() => resolveConfig(null, { llmBaseUrl: "https://x/v1" })).toThrow(/LLM_API_KEY/);
    expect(() =>
      resolveConfig(null, { llmBaseUrl: "https://x/v1", llmApiKey: "sk" }),
    ).toThrow(/LLM_CHAT_MODEL/);
  });

  it("空字符串视同未配置（用户字段与 env 同规则）", async () => {
    const { resolveConfig } = await import("@/lib/settings/service");
    const cfg = resolveConfig(userRow({ llmChatModel: "" }), env);
    expect(cfg.chatModel).toBe("env-chat-model");
    expect(() => resolveConfig(null, { ...env, llmApiKey: "" })).toThrow(/LLM_API_KEY/);
  });
});
