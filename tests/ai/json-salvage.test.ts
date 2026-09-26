import { describe, expect, it } from "vitest";
import { repairTruncatedJson, salvageQuestionSet } from "@/lib/ai/json-salvage";

describe("repairTruncatedJson", () => {
  it("完整 JSON 原样返回", () => {
    expect(repairTruncatedJson('{"a":1}')).toBe('{"a":1}');
  });

  it("截断在字符串中间 → 闭合引号与括号", () => {
    expect(repairTruncatedJson('{"questions":[{"content":"讲讲项目的难')).toBe(
      '{"questions":[{"content":"讲讲项目的难"}]}',
    );
  });

  it("截断在冒号后 → 补空字符串值", () => {
    expect(repairTruncatedJson('{"a":"x","b":')).toBe('{"a":"x","b":""}');
  });

  it("截断在逗号后 → 去掉悬挂逗号", () => {
    expect(repairTruncatedJson('{"a":"x",')).toBe('{"a":"x"}');
  });

  it("截断在键名中间 → 裁掉残缺成员", () => {
    expect(repairTruncatedJson('{"a":"x","sk')).toBe('{"a":"x"}');
  });

  it("截断在数值中间 → 裁掉残缺数值", () => {
    expect(repairTruncatedJson('{"score":0.')).toBe('{"score":0}');
  });

  it("截断在转义反斜杠处 → 丢弃悬挂反斜杠再闭合", () => {
    expect(repairTruncatedJson('{"a":"x\\')).toBe('{"a":"x"}');
  });

  it("多层嵌套未闭合 → 逆序补齐所有括号", () => {
    const repaired = repairTruncatedJson('{"questions":[{"a":{"b":["x"');
    expect(() => JSON.parse(repaired)).not.toThrow();
    expect(repaired).toBe('{"questions":[{"a":{"b":["x"]}}]}');
  });
});

describe("salvageQuestionSet", () => {
  it("递归嵌套结构 → 收割全部字段齐全的题目拍平返回", () => {
    const pathological = JSON.stringify({
      questions: [
        { content: "题1", type: "project", skillTag: "A", followupAnchor: "追1" },
        {
          questions: [
            { content: "题2", type: "skill", skillTag: "B", followupAnchor: "追2" },
          ],
        },
      ],
    });
    const salvaged = salvageQuestionSet(pathological);
    expect(salvaged).toBeDefined();
    const questions = salvaged?.questions as { content: string }[];
    expect(questions).toHaveLength(2);
    expect(questions.map((q) => q.content)).toEqual(["题1", "题2"]);
  });

  it("字段不全的题目对象被丢弃，只保留完整题", () => {
    const salvaged = salvageQuestionSet(
      JSON.stringify({
        questions: [
          { content: "只有内容" },
          { content: "完整题", type: "behavioral", skillTag: "C", followupAnchor: "追" },
        ],
      }),
    );
    const questions = salvaged?.questions as { content: string }[];
    expect(questions).toHaveLength(1);
    expect(questions[0].content).toBe("完整题");
  });

  it("type 非法值的题被丢弃", () => {
    const salvaged = salvageQuestionSet(
      JSON.stringify({
        questions: [{ content: "题", type: "系统设计", skillTag: "A", followupAnchor: "追" }],
      }),
    );
    expect(salvaged).toBeUndefined();
  });

  it("截断文本先过 repair 再收割（线上病态输出的完整链路）", () => {
    // 模拟线上输出：嵌套包裹 + 在最后一题 content 中间被 token 上限截断
    const q = (c: string) => ({ content: c, type: "project", skillTag: "S", followupAnchor: "F" });
    const truncated =
      '{"questions":[' +
      JSON.stringify(q("题1")) +
      ',{"questions":[' +
      JSON.stringify(q("题2")) +
      ',{"questions":[' +
      '{"content":"最后一题被拦腰截'; // ← 截断点，followupAnchor 缺失
    const salvaged = salvageQuestionSet(repairTruncatedJson(truncated));
    expect(salvaged).toBeDefined();
    const questions = salvaged?.questions as { content: string }[];
    expect(questions).toHaveLength(2);
    expect(questions.map((x) => x.content)).toEqual(["题1", "题2"]);
  });

  it("超过 10 题只取前 10", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      content: `题${i}`,
      type: "skill",
      skillTag: "S",
      followupAnchor: "F",
    }));
    const salvaged = salvageQuestionSet(JSON.stringify({ questions: many }));
    expect((salvaged?.questions as unknown[]).length).toBe(10);
  });

  it("无法解析或无任何完整题 → undefined", () => {
    expect(salvageQuestionSet("不是 JSON")).toBeUndefined();
    expect(salvageQuestionSet('{"foo":"bar"}')).toBeUndefined();
  });
});
