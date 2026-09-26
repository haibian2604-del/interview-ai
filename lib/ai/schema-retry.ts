import type { z } from "zod";
import { repairTruncatedJson } from "@/lib/ai/json-salvage";

/** 从模型原始输出中提取 JSON 候选（处理 markdown 围栏、前后缀散文噪声） */
export function extractJsonCandidate(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

const CORRECTIVE =
  "你上一次的输出不符合要求的 JSON 结构（键名或顶层结构不对）。请严格只输出符合系统要求的 JSON 对象：键名必须使用要求中的英文原样，结构必须完全一致，不要输出 markdown 围栏、解释或其他任何键名。";

/** 依次尝试：原文解析 → 提取候选 → 截断修复 → salvage 抢救，命中即过 schema */
function attemptParse<T>(
  schema: z.ZodType<T>,
  text: string,
  salvage?: (raw: string) => unknown,
): T | undefined {
  const extracted = extractJsonCandidate(text);
  // 输出可能被截断到连一个 "}" 都没有（此时提取不到候选），从首个 "{" 起交给截断修复
  const braceStart = text.indexOf("{");
  const base = extracted ?? (braceStart >= 0 ? text.slice(braceStart) : text);
  const repaired = repairTruncatedJson(base);
  for (const candidate of [extracted, extracted === repaired ? undefined : repaired]) {
    if (candidate === undefined) continue;
    try {
      return schema.parse(JSON.parse(candidate));
    } catch {
      // 尝试下一个候选
    }
  }
  if (salvage) {
    try {
      const salvaged = salvage(repaired);
      if (salvaged !== undefined) return schema.parse(salvaged);
    } catch {
      // 抢救失败 → 交回纠错重试
    }
  }
  return undefined;
}

/**
 * 结构化输出的容错包装（廉价中文模型经常无视 JSON Schema 指令）：
 * 1. 正常调用；2. 失败时先尝试截断修复与 salvage 抢救直接回收；
 * 3. 仍不行则带纠错指令重试一次；4. 重试输出同样先过提取与抢救。
 * run 接收可选纠错指令（追加为一条 user 消息），不依赖网络即可单测。
 */
export async function withSchemaRetry<T>(
  schema: z.ZodType<T>,
  run: (corrective?: string) => Promise<T>,
  opts?: { shapeHint?: string; salvage?: (raw: string) => unknown },
): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const text = (e as { text?: unknown })?.text;
    if (typeof text !== "string") throw e;

    const recovered = attemptParse(schema, text, opts?.salvage);
    if (recovered !== undefined) return recovered;

    const corrective =
      opts?.shapeHint === undefined
        ? CORRECTIVE
        : `${CORRECTIVE}\n目标结构示例（字段名逐字照抄，值仅示意）：\n${opts.shapeHint}`;
    try {
      return await run(corrective);
    } catch (e2) {
      const text2 = (e2 as { text?: unknown })?.text;
      const recovered2 = typeof text2 === "string" ? attemptParse(schema, text2, opts?.salvage) : undefined;
      if (recovered2 !== undefined) return recovered2;
      throw (e2 ?? e);
    }
  }
}
