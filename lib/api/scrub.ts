/**
 * 错误摘要的统一出口（settings/test、settings/test-asr、voice/transcribe 三处共用）：
 * 截断 + 抹去一切 key 形态——明文 key 绝不进响应体/日志的红线兜底。
 * 局限：只做整串字面替换，上游若只回显 key 片段不会抹除（打磨台账在案）。
 */
export function scrubSummary(message: string, secrets: (string | undefined)[]): string {
  let out = message;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("***");
  }
  return out.slice(0, 300);
}

/** 草稿字段：仅「非空字符串」覆盖已存配置；未传/空串/非字符串均视同未覆盖 */
export function draftOverride(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}
