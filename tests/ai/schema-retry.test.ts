import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJsonCandidate, withSchemaRetry } from "@/lib/ai/schema-retry";

const Schema = z.object({ questions: z.array(z.object({ content: z.string() })).min(1) });

function noObjectError(text: string): Error {
  return Object.assign(new Error("No object generated: response did not match schema."), { text });
}

describe("extractJsonCandidate", () => {
  it("处理 markdown 围栏与前后缀散文", () => {
    expect(extractJsonCandidate('好的，以下是题目：```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJsonCandidate('前缀 {"a":{"b":2}} 后缀')).toBe('{"a":{"b":2}}');
    expect(extractJsonCandidate("没有花括号")).toBeUndefined();
  });
});

describe("withSchemaRetry", () => {
  it("首次成功直接返回，不重试", async () => {
    let calls = 0;
    const r = await withSchemaRetry(Schema, async () => {
      calls++;
      return { questions: [{ content: "q" }] };
    });
    expect(calls).toBe(1);
    expect(r.questions).toHaveLength(1);
  });

  it("schema 失败但原始输出含合法 JSON（围栏/噪声）→ 提取直接命中，不重试", async () => {
    let calls = 0;
    const r = await withSchemaRetry(Schema, async () => {
      calls++;
      throw noObjectError('```json\n{"questions":[{"content":"讲讲项目"}]}\n```');
    });
    expect(calls).toBe(1);
    expect(r.questions[0].content).toBe("讲讲项目");
  });

  it("输出是错误结构（如中文键名画像体）→ 带纠错指令重试一次并成功", async () => {
    let calls = 0;
    let gotCorrective: string | undefined;
    const r = await withSchemaRetry(Schema, async (corrective) => {
      calls++;
      if (calls === 1) {
        expect(corrective).toBeUndefined();
        throw noObjectError('{"职业画像": {"求职意向": "AI 工程师"}}');
      }
      gotCorrective = corrective;
      return { questions: [{ content: "q" }] };
    });
    expect(calls).toBe(2);
    expect(gotCorrective).toContain("JSON");
    expect(r.questions[0].content).toBe("q");
  });

  it("重试仍输出合法 JSON 但结构错误 → 提取兜底；提取也失败 → 抛重试错误", async () => {
    const bad = noObjectError('{"仍然":"错误"}');
    await expect(
      withSchemaRetry(Schema, async () => {
        throw bad;
      }),
    ).rejects.toBe(bad);
  });

  it("非 NoObjectGeneratedError（无 text）直接透传，不重试", async () => {
    let calls = 0;
    const boom = new Error("network down");
    await expect(
      withSchemaRetry(Schema, async () => {
        calls++;
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(calls).toBe(1);
  });

  it("截断 JSON → 截断修复后直接命中，不重试", async () => {
    let calls = 0;
    const r = await withSchemaRetry(Schema, async () => {
      calls++;
      throw noObjectError('前缀 {"questions":[{"content":"讲讲项目"');
    });
    expect(calls).toBe(1);
    expect(r.questions[0].content).toBe("讲讲项目");
  });

  it("嵌套病态结构 → salvage 拍平回收，不重试", async () => {
    let calls = 0;
    const r = await withSchemaRetry(
      Schema,
      async () => {
        calls += 1;
        throw noObjectError(JSON.stringify({
          questions: [{ content: "题1" }, { questions: [{ content: "题2" }] }],
        }));
      },
      { salvage: (raw) => {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const found: { content: string }[] = [];
        const walk = (v: unknown) => {
          if (Array.isArray(v)) return v.forEach(walk);
          if (v && typeof v === "object") {
            const obj = v as Record<string, unknown>;
            if (typeof obj.content === "string") found.push({ content: obj.content });
            else Object.values(obj).forEach(walk);
          }
        };
        walk(parsed);
        return found.length > 0 ? { questions: found } : undefined;
      } },
    );
    expect(calls).toBe(1);
    expect(r.questions.map((q) => q.content)).toEqual(["题1", "题2"]);
  });

  it("修复与 salvage 都救不回 → 走纠错重试", async () => {
    let calls = 0;
    const r = await withSchemaRetry(
      Schema,
      async () => {
        calls++;
        if (calls === 1) throw noObjectError('{"完全不":"相干"}');
        return { questions: [{ content: "q" }] };
      },
      { salvage: () => undefined },
    );
    expect(calls).toBe(2);
    expect(r.questions[0].content).toBe("q");
  });

  it("schema 通过但业务校验不过（如题数不足）→ 带原因重试，重试通过才采用", async () => {
    let calls = 0;
    const gotCorrective: string[] = [];
    const r = await withSchemaRetry(
      Schema,
      async (corrective) => {
        calls++;
        gotCorrective.push(corrective ?? "");
        return { questions: calls === 1 ? [{ content: "q1" }] : [{ content: "q1" }, { content: "q2" }] };
      },
      {
        validate: (value) =>
          value.questions.length >= 2 ? null : `题目数量不足：实际 ${value.questions.length} 道`,
      },
    );
    expect(calls).toBe(2);
    expect(gotCorrective[1]).toContain("题目数量不足");
    expect(r.questions).toHaveLength(2);
  });

  it("重试后业务校验仍不过 → 保留首个 schema 合法结果，不抛错", async () => {
    let calls = 0;
    const r = await withSchemaRetry(
      Schema,
      async () => {
        calls++;
        return { questions: [{ content: `q${calls}` }] };
      },
      { validate: (value) => (value.questions.length >= 2 ? null : "数量不足") },
    );
    expect(calls).toBe(2);
    expect(r.questions[0].content).toBe("q1");
  });

  it("无 validate 时行为不变（单次成功不重试）", async () => {
    let calls = 0;
    await withSchemaRetry(Schema, async () => {
      calls++;
      return { questions: [{ content: "q" }] };
    });
    expect(calls).toBe(1);
  });
});
