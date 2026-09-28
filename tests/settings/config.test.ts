import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

import type { UserLlmSettings } from "@/lib/settings/service";
import { mapPresetRows, resolveAsrConfig } from "@/lib/settings/service";

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

describe("settings/resolveAsrConfig", () => {
  // overrideKey 用例需要走 safeDecrypt（用户已存 key 回落链），与上方 describe 同样 stub 密钥
  const ORIG = { ...process.env };
  beforeEach(() => {
    vi.stubEnv("SETTINGS_SECRET", "test-settings-secret-high-entropy");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = { ...ORIG };
  });

  const base = {
    asrBaseUrl: null,
    asrApiKeyEnc: null,
    asrModel: null,
    llmBaseUrl: null,
    llmApiKeyEnc: null,
  };

  it("用户 ASR 配置齐全 → 优先使用", () => {
    const cfg = resolveAsrConfig({
      user: { ...base, asrBaseUrl: "https://asr.example.com/v1", asrModel: "whisper-1" },
      env: { asrApiKey: "env-asr-key" },
    });
    expect(cfg).toEqual({ baseURL: "https://asr.example.com/v1", apiKey: "env-asr-key", model: "whisper-1" });
  });

  it("baseURL 逐级回落：用户 ASR → 用户 LLM → env ASR → env LLM", () => {
    // 注：brief 原文此用例 env 为 {}（无任何 apiKey），与实现「apiKey 缺失 → null」矛盾；
    // 这里补 env key 让配置可解析，仅调整 apiKey 来源，baseURL 的逐级回落语义不变。
    const viaLlm = resolveAsrConfig({
      user: { ...base, llmBaseUrl: "https://llm.example.com/v1", asrModel: "m" },
      env: { asrApiKey: "k" },
    });
    expect(viaLlm?.baseURL).toBe("https://llm.example.com/v1");
    const viaEnvAsr = resolveAsrConfig({
      user: { ...base, asrModel: "m" },
      env: { asrBaseUrl: "https://a.io", asrApiKey: "k" },
    });
    expect(viaEnvAsr?.baseURL).toBe("https://a.io");
    const viaEnvLlm = resolveAsrConfig({
      user: { ...base, asrModel: "m" },
      env: { llmBaseUrl: "https://l.io", asrApiKey: "k" },
    });
    expect(viaEnvLlm?.baseURL).toBe("https://l.io");
  });

  it("apiKey 逐级回落：env ASR → env LLM（密文解密链路不在纯函数测试覆盖内）", () => {
    const viaEnvAsr = resolveAsrConfig({
      user: { ...base, asrBaseUrl: "https://a.io", asrModel: "m" },
      env: { asrApiKey: "k1" },
    });
    expect(viaEnvAsr?.apiKey).toBe("k1");
    const viaEnvLlm = resolveAsrConfig({
      user: { ...base, asrBaseUrl: "https://a.io", asrModel: "m" },
      env: { llmApiKey: "k2" },
    });
    expect(viaEnvLlm?.apiKey).toBe("k2");
  });

  it("overrideKey 最高优先级：压过用户已存 key 与 env（test-asr 草稿 key 场景）", async () => {
    const { encryptSecret } = await import("@/lib/settings/crypto");
    const viaOverride = resolveAsrConfig({
      user: { ...base, asrBaseUrl: "https://a.io", asrModel: "m" },
      env: { asrApiKey: "k1", llmApiKey: "k2" },
      overrideKey: "draft-key",
    });
    expect(viaOverride?.apiKey).toBe("draft-key");
    // 压过用户已存的 LLM key（密文列解密回落链）
    const viaOverrideOverUserLlm = resolveAsrConfig({
      user: {
        ...base,
        asrBaseUrl: "https://a.io",
        asrModel: "m",
        llmApiKeyEnc: encryptSecret("sk-stored-llm-key"),
      },
      env: { llmApiKey: "k2" },
      overrideKey: "draft-key",
    });
    expect(viaOverrideOverUserLlm?.apiKey).toBe("draft-key");
  });

  it("model 只认用户配置与 env ASR_MODEL，缺 model → null（功能未配置）", () => {
    expect(
      resolveAsrConfig({
        user: { ...base, asrBaseUrl: "https://a.io" },
        env: { asrApiKey: "k" },
      }),
    ).toBeNull();
  });

  it("user 为 null 且 env 不足三项 → null；env 三项齐全 → 可用", () => {
    expect(resolveAsrConfig({ user: null, env: { asrApiKey: "k" } })).toBeNull();
    const cfg = resolveAsrConfig({
      user: null,
      env: { asrBaseUrl: "https://a.io", asrApiKey: "k", asrModel: "m" },
    });
    expect(cfg).toEqual({ baseURL: "https://a.io", apiKey: "k", model: "m" });
  });
});

describe("settings/mapPresetRows（端点预设防御性映射）", () => {
  it("丢弃缺字段 / 空串 / 非字符串的脏行，合法行透传", () => {
    expect(
      mapPresetRows([
        { label: "DeepSeek", url: "https://api.deepseek.com" },
        { label: "", url: "https://x.io" },
        { label: "GLM", url: "" },
        { label: 42, url: "https://y.io" },
        { label: null, url: null },
      ]),
    ).toEqual([{ label: "DeepSeek", url: "https://api.deepseek.com" }]);
  });

  it("null / undefined 行集视为无预设", () => {
    expect(mapPresetRows(null)).toEqual([]);
  });
});
