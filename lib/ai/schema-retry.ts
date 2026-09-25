import type { z } from "zod";

/** 从模型原始输出中提取 JSON 候选（处理 markdown 围栏、前后缀散文噪声） */
export function extractJsonCandidate(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

const CORRECTIVE =
  "你上一次的输出不符合要求的 JSON 结构（键名或顶层结构不对）。请严格只输出符合系统要求的 JSON 对象：键名必须使用要求中的英文原样，结构必须完全一致，不要输出 markdown 围栏、解释或其他任何键名。";

/**
 * 结构化输出的容错包装（廉价中文模型经常无视 JSON Schema 指令）：
 * 1. 正常调用；2. 失败时先从原始输出提取 JSON 直接对 schema 校验；
 * 3. 仍不行则带纠错指令重试一次；4. 重试输出同样先过提取。
 * run 接收可选纠错指令（追加为一条 user 消息），不依赖网络即可单测。
 */
export async function withSchemaRetry<T>(
  schema: z.ZodType<T>,
  run: (corrective?: string) => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const text = (e as { text?: unknown })?.text;
    if (typeof text !== "string") throw e;

    const candidate = extractJsonCandidate(text);
    if (candidate) {
      try {
        return schema.parse(JSON.parse(candidate));
      } catch {
        // 提取到的 JSON 仍不符合 schema → 走纠错重试
      }
    }

    try {
      return await run(CORRECTIVE);
    } catch (e2) {
      const text2 = (e2 as { text?: unknown })?.text;
      const candidate2 = typeof text2 === "string" ? extractJsonCandidate(text2) : undefined;
      if (candidate2) {
        try {
          return schema.parse(JSON.parse(candidate2));
        } catch {
          // 重试输出也不合法 → 抛出重试错误（保留 .text 供上层诊断）
        }
      }
      throw (e2 ?? e);
    }
  }
}
