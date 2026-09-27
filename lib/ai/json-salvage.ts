/**
 * 针对廉价/网关模型的两类高频病态输出的抢救逻辑：
 * 1. 输出在 token 上限处被拦腰截断（JSON 未闭合）→ 逐字符扫描补齐引号与括号；
 * 2. questions 数组被写成递归嵌套（题目对象里又包 {"questions":[...]}）→
 *    递归收割任意深度里字段完整的题目对象拍平回收。
 * 抢救只是容错兜底，产出仍要过 zod schema 校验，不合法照样走纠错重试。
 */

/** type 字段别名映射：模型常写中文标签或大小写变体，能救回就不丢题 */
const TYPE_ALIASES: Record<string, string> = {
  skill: "skill",
  project: "project",
  behavioral: "behavioral",
  技能: "skill",
  项目: "project",
  行为: "behavioral",
  行为面试: "behavioral",
  star: "behavioral",
};

function closeJson(text: string): string {
  let inString = false;
  let escaped = false;
  const stack: string[] = [];
  for (const ch of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let out = text;
  if (escaped) out = out.slice(0, -1);
  if (inString) out += '"';
  // 断在逗号后 → 去掉悬挂逗号；断在冒号后 → 补空字符串值
  out = out.replace(/,\s*$/, "");
  out = out.replace(/:\s*$/, ':""');
  for (let i = stack.length - 1; i >= 0; i -= 1) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

/** 补齐被截断的 JSON（闭合未完字符串/括号，裁掉残缺尾部成员）。已完整则原样返回。 */
export function repairTruncatedJson(text: string): string {
  const direct = closeJson(text);
  try {
    JSON.parse(direct);
    return direct;
  } catch {
    // 末尾断在键名/数值中间 → 从尾部逐字符裁剪再闭合，找到第一个能解析的位置
  }
  const limit = Math.min(text.length, 2000);
  for (let cut = 1; cut <= limit; cut += 1) {
    const candidate = closeJson(text.slice(0, text.length - cut));
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // 继续裁剪
    }
  }
  return text;
}

/** 递归收割题目对象（宽容版）：content 必须是真实题干；其余字段能修则修、修不了给兜底。
 * 丢一道题 = 用户少答一题，而 type/skillTag 轻度失真只是标签误差——两害取其轻。 */
function collectQuestionLike(value: unknown): Record<string, string>[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectQuestionLike);
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content.trim() : "";
    if (!content) {
      return Object.values(obj).flatMap(collectQuestionLike);
    }
    const rawType = typeof obj.type === "string" ? obj.type.trim().toLowerCase() : "";
    const type = TYPE_ALIASES[rawType] ?? "skill";
    const skillTag =
      typeof obj.skillTag === "string" && obj.skillTag.trim() ? obj.skillTag.trim() : "综合";
    const followupAnchor =
      typeof obj.followupAnchor === "string" && obj.followupAnchor.trim()
        ? obj.followupAnchor.trim()
        : content; // 锚点缺失时以题干自身兜底：追问仍有的放矢
    return [{ content, type, skillTag, followupAnchor }];
  }
  return [];
}

/**
 * 从病态结构（嵌套包裹/递归 questions/字段残缺）中抢救题目集合。
 * 只要求 content 是真实题干，其余字段修复或兜底；一道都收不到时返回 undefined（交回纠错重试）。
 */
export function salvageQuestionSet(text: string): Record<string, unknown> | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  const found = collectQuestionLike(value).slice(0, 10);
  return found.length > 0 ? { questions: found } : undefined;
}

/** 单题版抢救：收割题目集合后取第一题（渐进出题 Agent 用）；收割不到返回 undefined */
export function salvageSingleQuestion(
  text: string,
): Record<string, string> | undefined {
  const set = salvageQuestionSet(text);
  const questions = set?.questions;
  return Array.isArray(questions) && questions.length > 0
    ? (questions[0] as Record<string, string>)
    : undefined;
}
