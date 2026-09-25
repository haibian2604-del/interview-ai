import { describe, expect, it } from "vitest";
import {
  EvaluationSchema,
  QuestionSetSchema,
  ReportSchema,
} from "@/lib/ai/schemas";

describe("QuestionSetSchema", () => {
  const q = {
    content: "介绍一个你负责的项目",
    type: "project" as const,
    skillTag: "项目管理",
    followupAnchor: "技术选型理由",
  };
  it("接受 1-10 题（模型少给几题不该整体失败，question_count 按实际行数对账）", () => {
    expect(() => QuestionSetSchema.parse({ questions: [q, q, q] })).not.toThrow();
    expect(() => QuestionSetSchema.parse({ questions: [q] })).not.toThrow();
  });
  it("拒绝空题库", () => {
    expect(() => QuestionSetSchema.parse({ questions: [] })).toThrow();
  });
  it("拒绝未知题型", () => {
    expect(() =>
      QuestionSetSchema.parse({
        questions: [{ ...q, type: "coding" }, q, q],
      }),
    ).toThrow();
  });
});

describe("EvaluationSchema", () => {
  it("接受合法评分", () => {
    const e = {
      scores: { relevance: 0.8, depth: 0.6, structure: 0.7, communication: 0.9 },
      starCompleteness: 0.5,
      strengths: "思路清晰",
      improvements: "缺少量化结果",
    };
    expect(() => EvaluationSchema.parse(e)).not.toThrow();
  });
  it("拒绝超出 0-1 的分数", () => {
    expect(() =>
      EvaluationSchema.parse({
        scores: { relevance: 1.5, depth: 0.6, structure: 0.7, communication: 0.9 },
        starCompleteness: 0.5,
        strengths: "s",
        improvements: "i",
      }),
    ).toThrow();
  });
});

describe("ReportSchema", () => {
  const base = {
    dimensionScores: { relevance: 80, depth: 70, structure: 90, communication: 75 },
    summary: "总体良好",
    strengths: "沟通",
    improvements: "深度",
  };
  it("overallScore 与维度分必须在 0-100", () => {
    expect(() => ReportSchema.parse({ ...base, overallScore: 82 })).not.toThrow();
    expect(() => ReportSchema.parse({ ...base, overallScore: 120 })).toThrow();
  });
});
