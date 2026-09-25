import { describe, expect, it } from "vitest";
import { buildQuestionSetterMessages } from "@/lib/agents/question-setter";
import { buildEvaluatorMessages } from "@/lib/agents/evaluator";
import { buildReportMessages } from "@/lib/agents/report-writer";
import { buildInterviewerMessages } from "@/lib/agents/interviewer";
import { buildResumeAnalystMessages } from "@/lib/agents/resume-analyst";

const profile = {
  summary: "5 年后端",
  skills: ["Go", "K8s"],
  experiences: [{ company: "A", title: "后端", highlights: ["高并发网关"] }],
  projects: [{ name: "P", highlights: ["性能提升 30%"] }],
};

describe("buildQuestionSetterMessages", () => {
  it("包含简历画像、JD、岗位与题数要求", () => {
    const msgs = buildQuestionSetterMessages({
      profile,
      jdText: "负责支付网关",
      position: "后端工程师",
      interviewType: "mixed",
      count: 6,
    });
    const text = JSON.stringify(msgs);
    expect(text).toContain("Go");
    expect(text).toContain("支付网关");
    expect(text).toContain("后端工程师");
    expect(text).toContain("6");
  });
});

describe("buildEvaluatorMessages", () => {
  it("包含 rubric 维度、题目与回答原文", () => {
    const msgs = buildEvaluatorMessages({
      question: { content: "讲讲高并发网关", type: "skill", skillTag: "Go", followupAnchor: "qps 估算" },
      transcript: [
        { role: "interviewer", content: "讲讲高并发网关" },
        { role: "candidate", content: "我用了 Go + 限流" },
      ],
    });
    const text = JSON.stringify(msgs);
    expect(text).toContain("relevance");
    expect(text).toContain("深度");
    expect(text).toContain("限流");
  });
});

describe("buildReportMessages", () => {
  it("包含全部逐题评估", () => {
    const msgs = buildReportMessages({
      position: "后端工程师",
      questionContents: ["Q1", "Q2"],
      evaluations: [
        { scores: { relevance: 0.9, depth: 0.8, structure: 0.7, communication: 0.9 }, starCompleteness: 0.8, strengths: "s1", improvements: "i1" },
        { scores: { relevance: 0.5, depth: 0.4, structure: 0.6, communication: 0.7 }, starCompleteness: 0.4, strengths: "s2", improvements: "i2" },
      ],
    });
    const text = JSON.stringify(msgs);
    expect(text).toContain("Q1");
    expect(text).toContain("i2");
  });
});

describe("buildInterviewerMessages", () => {
  const q = { content: "介绍项目", type: "project" as const, skillTag: "x", followupAnchor: "技术选型" };
  it("ask 模式注入人格与题目", () => {
    const msgs = buildInterviewerMessages("ask", { question: q, history: [], followupText: null });
    const text = JSON.stringify(msgs);
    expect(text).toContain("面试官");
    expect(text).toContain("介绍项目");
  });
  it("followup 模式包含追问文案", () => {
    const msgs = buildInterviewerMessages("followup", {
      question: q,
      history: [{ role: "candidate", content: "回答" }],
      followupText: "你提到技术选型，为什么选它？",
    });
    expect(JSON.stringify(msgs)).toContain("技术选型");
  });
  it("transition 模式包含下一题", () => {
    const next = { ...q, content: "下一题内容" };
    const msgs = buildInterviewerMessages("transition", { question: q, history: [], followupText: null, nextQuestion: next });
    expect(JSON.stringify(msgs)).toContain("下一题内容");
  });
});

describe("buildResumeAnalystMessages", () => {
  it("包含简历原文", () => {
    expect(JSON.stringify(buildResumeAnalystMessages("十年架构经验"))).toContain("十年架构经验");
  });
});
