import { describe, expect, it } from "vitest";

import { COPY } from "@/lib/copy";
import {
  SETTINGS_FIELD_LIMITS,
  validateLlmSettingsInput,
} from "@/lib/settings/validation";

describe("settings/validateLlmSettingsInput（合法输入）", () => {
  it("完整合法输入：trim 后逐字段放行", () => {
    const result = validateLlmSettingsInput({
      llmBaseUrl: "  https://api.example.com/v1  ",
      llmApiKey: "  sk-abc12345  ",
      llmChatModel: "  gpt-4o-mini  ",
      llmEvalModel: "  gpt-4o  ",
    });
    expect(result).toEqual({
      ok: true,
      value: {
        llmBaseUrl: "https://api.example.com/v1",
        llmApiKey: "sk-abc12345",
        llmChatModel: "gpt-4o-mini",
        llmEvalModel: "gpt-4o",
      },
    });
  });

  it("部分字段提交：未提交的字段不出现在 value（保持不变语义）", () => {
    const result = validateLlmSettingsInput({ llmChatModel: "gpt-4o-mini" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({ llmChatModel: "gpt-4o-mini" });
    expect("llmBaseUrl" in result.value).toBe(false);
    expect("llmApiKey" in result.value).toBe(false);
    expect("llmEvalModel" in result.value).toBe(false);
  });

  it("空 body：全部字段保持不变", () => {
    const result = validateLlmSettingsInput({});
    expect(result).toEqual({ ok: true, value: {} });
  });

  it("http:// 与带端口/路径/查询的 URL 都合法", () => {
    for (const url of [
      "http://localhost:8000/v1",
      "https://host:443/path?query=1",
      "https://a.io",
    ]) {
      const result = validateLlmSettingsInput({ llmBaseUrl: url });
      expect(result).toEqual({ ok: true, value: { llmBaseUrl: url } });
    }
  });

  it("边界长度：URL 500 / key 8 / 模型 200 恰好放行", () => {
    const urlOk = "https://a.io/" + "a".repeat(SETTINGS_FIELD_LIMITS.baseUrlMax - "https://a.io/".length);
    expect(urlOk).toHaveLength(SETTINGS_FIELD_LIMITS.baseUrlMax);
    expect(validateLlmSettingsInput({ llmBaseUrl: urlOk })).toEqual({
      ok: true,
      value: { llmBaseUrl: urlOk },
    });
    expect(validateLlmSettingsInput({ llmApiKey: "a".repeat(8) })).toEqual({
      ok: true,
      value: { llmApiKey: "a".repeat(8) },
    });
    expect(validateLlmSettingsInput({ llmChatModel: "m".repeat(200) })).toEqual({
      ok: true,
      value: { llmChatModel: "m".repeat(200) },
    });
  });
});

describe("settings/validateLlmSettingsInput（非法输入）", () => {
  it("非对象 body（null / 数组 / 字符串 / 数字）：errInvalidBody", () => {
    for (const bad of [null, [], "obj", 42, true, undefined]) {
      expect(validateLlmSettingsInput(bad)).toEqual({
        ok: false,
        error: COPY.settings.errInvalidBody,
      });
    }
  });

  it("非字符串字段值：errInvalidType", () => {
    expect(validateLlmSettingsInput({ llmBaseUrl: 123 })).toEqual({
      ok: false,
      error: COPY.settings.errInvalidType,
    });
    expect(validateLlmSettingsInput({ llmApiKey: { k: 1 } })).toEqual({
      ok: false,
      error: COPY.settings.errInvalidType,
    });
    expect(validateLlmSettingsInput({ llmChatModel: true })).toEqual({
      ok: false,
      error: COPY.settings.errInvalidType,
    });
    expect(validateLlmSettingsInput({ llmEvalModel: null })).toEqual({
      ok: false,
      error: COPY.settings.errInvalidType,
    });
  });

  it("非法 URL：缺协议 / ftp:// / 不可被 new URL 解析，均 errBaseUrlFormat", () => {
    for (const bad of [
      "api.example.com/v1",
      "ftp://api.example.com",
      "//api.example.com",
      "https://",
      "https://exa mple.com/v1",
    ]) {
      expect(validateLlmSettingsInput({ llmBaseUrl: bad })).toEqual({
        ok: false,
        error: COPY.settings.errBaseUrlFormat,
      });
    }
  });

  it("超长：URL 501 / key 501 / 模型 201，各自 errXxxTooLong / errApiKeyLength", () => {
    const urlTooLong =
      "https://a.io/" +
      "a".repeat(SETTINGS_FIELD_LIMITS.baseUrlMax - "https://a.io/".length + 1);
    expect(validateLlmSettingsInput({ llmBaseUrl: urlTooLong })).toEqual({
      ok: false,
      error: COPY.settings.errBaseUrlTooLong,
    });
    expect(validateLlmSettingsInput({ llmApiKey: "a".repeat(501) })).toEqual({
      ok: false,
      error: COPY.settings.errApiKeyLength,
    });
    expect(validateLlmSettingsInput({ llmChatModel: "m".repeat(201) })).toEqual({
      ok: false,
      error: COPY.settings.errModelTooLong,
    });
    expect(validateLlmSettingsInput({ llmEvalModel: "m".repeat(201) })).toEqual({
      ok: false,
      error: COPY.settings.errModelTooLong,
    });
  });

  it("API Key 过短（非空且 <8）：errApiKeyLength", () => {
    for (const len of [1, 7]) {
      expect(validateLlmSettingsInput({ llmApiKey: "k".repeat(len) })).toEqual({
        ok: false,
        error: COPY.settings.errApiKeyLength,
      });
    }
    // 长度按 trim 后计：空白补齐到 8 仍按 1 个字符拒绝
    expect(validateLlmSettingsInput({ llmApiKey: " k       " })).toEqual({
      ok: false,
      error: COPY.settings.errApiKeyLength,
    });
  });
});

describe("settings/validateLlmSettingsInput（空串清除语义）", () => {
  it("显式空串 = 清除该字段：value 保留空串（进 upsert 载荷写空）", () => {
    expect(validateLlmSettingsInput({ llmBaseUrl: "" })).toEqual({
      ok: true,
      value: { llmBaseUrl: "" },
    });
    expect(validateLlmSettingsInput({ llmApiKey: "   " })).toEqual({
      ok: true,
      value: { llmApiKey: "" },
    });
    expect(validateLlmSettingsInput({ llmChatModel: "" })).toEqual({
      ok: true,
      value: { llmChatModel: "" },
    });
    expect(validateLlmSettingsInput({ llmEvalModel: "  " })).toEqual({
      ok: true,
      value: { llmEvalModel: "" },
    });
  });

  it("空串清除不触发长度校验（清除是合法动作）", () => {
    const result = validateLlmSettingsInput({ llmApiKey: "" });
    expect(result).toEqual({ ok: true, value: { llmApiKey: "" } });
  });
});

describe("settings/validateLlmSettingsInput（ASR 字段）", () => {
  it("ASR 三字段合法输入：trim 放行", () => {
    const result = validateLlmSettingsInput({
      asrBaseUrl: " https://asr.example.com/v1 ",
      asrApiKey: " sk-asr-123456 ",
      asrModel: " whisper-1 ",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({
      asrBaseUrl: "https://asr.example.com/v1",
      asrApiKey: "sk-asr-123456",
      asrModel: "whisper-1",
    });
  });

  it("ASR 字段部分提交：未提交字段不出现在 value", () => {
    const result = validateLlmSettingsInput({ asrModel: "whisper-1" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({ asrModel: "whisper-1" });
    expect("asrBaseUrl" in result.value).toBe(false);
  });

  it("ASR 空串 = 清除语义，原样放行空串", () => {
    const result = validateLlmSettingsInput({ asrBaseUrl: "", asrApiKey: "", asrModel: "" });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value).toEqual({ asrBaseUrl: "", asrApiKey: "", asrModel: "" });
  });

  it("ASR 非法 URL / key 过短 / key 过长 → 报错（文案与 LLM 字段同源）", () => {
    expect(validateLlmSettingsInput({ asrBaseUrl: "ftp://a.io" }).ok).toBe(false);
    expect(validateLlmSettingsInput({ asrApiKey: "short" }).ok).toBe(false);
    expect(validateLlmSettingsInput({ asrApiKey: "a".repeat(501) }).ok).toBe(false);
    expect(validateLlmSettingsInput({ asrModel: "m".repeat(201) }).ok).toBe(false);
  });
});
