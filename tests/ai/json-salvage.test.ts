import { describe, expect, it } from "vitest";
import {
  repairTruncatedJson,
  salvageQuestionSet,
  salvageSingleQuestion,
} from "@/lib/ai/json-salvage";

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

  it("字段不全的题被兜底保留：type 落 skill、skillTag 落「综合」、锚点以题干兜底", () => {
    const salvaged = salvageQuestionSet(
      JSON.stringify({
        questions: [
          { content: "只有内容" },
          { content: "完整题", type: "behavioral", skillTag: "C", followupAnchor: "追" },
        ],
      }),
    );
    const questions = salvaged?.questions as {
      content: string;
      type: string;
      skillTag: string;
      followupAnchor: string;
    }[];
    expect(questions).toHaveLength(2);
    expect(questions[1]).toEqual({ content: "完整题", type: "behavioral", skillTag: "C", followupAnchor: "追" });
    expect(questions[0]).toEqual({
      content: "只有内容",
      type: "skill",
      skillTag: "综合",
      followupAnchor: "只有内容",
    });
  });

  it("type 中文标签/大小写变体 → 别名映射；彻底未知 → 兜底 skill（不丢题）", () => {
    const salvaged = salvageQuestionSet(
      JSON.stringify({
        questions: [
          { content: "题1", type: "项目", skillTag: "A", followupAnchor: "追" },
          { content: "题2", type: "Behavioral", skillTag: "B", followupAnchor: "追" },
          { content: "题3", type: "系统设计", skillTag: "C", followupAnchor: "追" },
        ],
      }),
    );
    const questions = salvaged?.questions as { content: string; type: string }[];
    expect(questions.map((q) => [q.content, q.type])).toEqual([
      ["题1", "project"],
      ["题2", "behavioral"],
      ["题3", "skill"],
    ]);
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
    const questions = salvaged?.questions as { content: string; followupAnchor: string }[];
    // 宽容收割：截断的最后一题保留（题干残缺但可用），字段兜底
    expect(questions).toHaveLength(3);
    expect(questions[2].followupAnchor).toBe(questions[2].content);
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

describe("salvageSingleQuestion", () => {
  it("从病态结构收割第一道完整题", () => {
    const q = salvageSingleQuestion('{"questions":[{"content":"题1","type":"project","skillTag":"A","followupAnchor":"F"}]}');
    expect(q?.content).toBe("题1");
  });
  it("收割不到 → undefined", () => {
    expect(salvageSingleQuestion('{"foo":1}')).toBeUndefined();
  });
});
