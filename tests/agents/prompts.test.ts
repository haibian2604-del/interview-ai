import { describe, expect, it } from "vitest";
import {
  buildQuestionSetterMessages,
  buildRealtimeQuestionMessages,
} from "@/lib/agents/question-setter";
import { buildEvaluatorMessages } from "@/lib/agents/evaluator";
import { buildReportMessages } from "@/lib/agents/report-writer";
import { buildInterviewerMessages, INTERVIEWER_PERSONA } from "@/lib/agents/interviewer";
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
    const userContent = msgs.find((m) => m.role === "user")?.content ?? "";
    expect(userContent).toMatch(/题目数量：6/);
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
  it("transcript 角色标注：candidate 前缀候选人，interviewer 前缀面试官", () => {
    const msgs = buildEvaluatorMessages({
      question: { content: "讲讲高并发网关", type: "skill", skillTag: "Go", followupAnchor: "qps 估算" },
      transcript: [
        { role: "interviewer", content: "讲讲高并发网关" },
        { role: "candidate", content: "我用了 Go + 限流" },
        { role: "followup", content: "追问一句" },
      ],
    });
    const userContent = msgs.find((m) => m.role === "user")?.content ?? "";
    expect(userContent).toContain("面试官：讲讲高并发网关");
    expect(userContent).toContain("候选人：我用了 Go + 限流");
    expect(userContent).toContain("面试官：追问一句");
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
  it("history 角色映射：candidate→user，interviewer/followup→assistant", () => {
    const msgs = buildInterviewerMessages("followup", {
      question: q,
      history: [
        { role: "interviewer", content: "介绍项目" },
        { role: "candidate", content: "候选人回答" },
        { role: "followup", content: "追问内容" },
      ],
      followupText: "再追问一句",
    });
    expect(msgs).toEqual([
      { role: "system", content: INTERVIEWER_PERSONA },
      { role: "assistant", content: "介绍项目" },
      { role: "user", content: "候选人回答" },
      { role: "assistant", content: "追问内容" },
      { role: "user", content: expect.stringContaining("再追问一句") },
    ]);
  });
  it("transition 模式包含下一题", () => {
    const next = { ...q, content: "下一题内容" };
    const msgs = buildInterviewerMessages("transition", { question: q, history: [], followupText: null, nextQuestion: next });
    expect(JSON.stringify(msgs)).toContain("下一题内容");
  });
});

describe("buildInterviewerMessages comment 模式", () => {
  it("指令为「只点评上一回答、不提出新问题」", () => {
    const messages = buildInterviewerMessages("comment", {
      question: { content: "题", type: "skill", skillTag: "S", followupAnchor: "F" },
      history: [],
      followupText: null,
    });
    const last = messages[messages.length - 1];
    expect(last.role).toBe("user");
    expect(last.content).toContain("点评");
    expect(last.content).toContain("不要提出新问题");
  });
});

describe("buildResumeAnalystMessages", () => {
  it("包含简历原文", () => {
    expect(JSON.stringify(buildResumeAnalystMessages("十年架构经验"))).toContain("十年架构经验");
  });
});

describe("buildRealtimeQuestionMessages", () => {
  const profile = { summary: "s", skills: [], experiences: [], projects: [] };
  const base = {
    profile,
    jdText: "jd",
    position: "后端",
    askedQuestions: [] as { content: string; skillTag: string }[],
    stage: "opening" as const,
  };

  it("系统指令含综合面试官视角、「恰好一道」硬约束与由简到难总则", () => {
    const messages = buildRealtimeQuestionMessages(base);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("一道");
    expect(messages[0].content).toContain("由简到难");
  });

  it("难度阶段指令进 user prompt（opening 禁项目深挖 / deep 项目题收尾）", () => {
    const opening = buildRealtimeQuestionMessages(base);
    expect(opening[opening.length - 1].content).toContain("开场阶段");
    expect(opening[opening.length - 1].content).toContain("不要出项目深挖");

    const deep = buildRealtimeQuestionMessages({ ...base, stage: "deep" });
    expect(deep[deep.length - 1].content).toContain("收尾阶段");
    expect(deep[deep.length - 1].content).toContain("项目题放在这个阶段");
  });

  it("已问历史进 prompt 且带去重硬指令（skillTag 逐条列出）", () => {
    const messages = buildRealtimeQuestionMessages({
      ...base,
      askedQuestions: [
        { content: "讲讲 RAG 检索", skillTag: "VectorSearch" },
        { content: "讲讲 LangGraph 状态机", skillTag: "LangGraph" },
      ],
    });
    const userMsg = messages[messages.length - 1].content;
    expect(userMsg).toContain("VectorSearch");
    expect(userMsg).toContain("讲讲 RAG 检索");
    expect(userMsg).toContain("不得重复");
  });

  it("lastExchange 存在时进入 prompt（顺延候选人暴露的点）", () => {
    const messages = buildRealtimeQuestionMessages({
      ...base,
      lastExchange: { question: "讲讲项目", answer: "我做了个多租户系统……" },
    });
    expect(messages[messages.length - 1].content).toContain("多租户系统");
  });
});
