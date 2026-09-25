import { describe, expect, it } from "vitest";
import { decideNextAction } from "@/lib/orchestrator/state-machine";
import {
  deriveChatMessages,
  questionFollowupCount,
  rowToQuestion,
  toAgentRole,
} from "@/lib/interview/mappers";

describe("rowToQuestion（snake_case → camelCase 映射铁律）", () => {
  it("把 questions 表行映射为领域 Question", () => {
    expect(
      rowToQuestion({
        content: "讲讲 TCP 拥塞控制",
        type: "skill",
        skill_tag: "网络",
        followup_anchor: "慢启动与拥塞避免的分界",
      }),
    ).toEqual({
      content: "讲讲 TCP 拥塞控制",
      type: "skill",
      skillTag: "网络",
      followupAnchor: "慢启动与拥塞避免的分界",
    });
  });
});

describe("deriveChatMessages（卷面还原）", () => {
  const idxById = new Map([
    ["q1", 0],
    ["q2", 1],
  ]);
  const row = (
    id: string,
    role: string,
    question_id: string,
    content = id,
  ) => ({ id, role, content, question_id });

  it("映射题号与角色，普通轮次不标追问", () => {
    const messages = deriveChatMessages(
      [
        row("m1", "interviewer", "q1", "请答第一题"),
        row("m2", "candidate", "q1", "我的回答"),
        row("m3", "interviewer", "q1", "感谢，下一题是……"),
        row("m4", "candidate", "q2", "第二题回答"),
      ],
      idxById,
    );
    expect(messages.map((m) => m.questionIdx)).toEqual([0, 0, 0, 1]);
    expect(messages.map((m) => m.isFollowupQuestion)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("紧跟首答、其后是追问轮回答的面试官消息标为追问；转场话术不误标", () => {
    const messages = deriveChatMessages(
      [
        row("m1", "interviewer", "q1", "第一题"),
        row("m2", "candidate", "q1", "首答"),
        row("m3", "interviewer", "q1", "追问：展开讲讲"),
        row("m4", "followup", "q1", "追问后的补充回答"),
        row("m5", "interviewer", "q1", "转场 + 第二题题干"),
        row("m6", "candidate", "q2", "第二题回答"),
        row("m7", "interviewer", "q2", "收尾致谢"),
      ],
      idxById,
    );
    expect(
      messages
        .filter((m) => m.role === "interviewer")
        .map((m) => ({ id: m.id, isFollowupQuestion: m.isFollowupQuestion })),
    ).toEqual([
      { id: "m1", isFollowupQuestion: false },
      { id: "m3", isFollowupQuestion: true },
      { id: "m5", isFollowupQuestion: false },
      { id: "m7", isFollowupQuestion: false },
    ]);
  });

  it("question_id 不在题目映射中时题号为 null 且不误标追问", () => {
    const messages = deriveChatMessages(
      [
        row("m1", "interviewer", "ghost", "孤儿消息"),
      ],
      idxById,
    );
    expect(messages[0].questionIdx).toBeNull();
    expect(messages[0].isFollowupQuestion).toBe(false);
  });
});

describe("questionFollowupCount（C1 回归：按本题计数，非全场）", () => {
  const rows = [
    { role: "interviewer", content: "第一题", question_id: "q1" },
    { role: "candidate", content: "首答", question_id: "q1" },
    { role: "interviewer", content: "追问", question_id: "q1" },
    { role: "followup", content: "追后补充", question_id: "q1" },
    { role: "interviewer", content: "转场 + 第二题", question_id: "q1" },
  ];

  it("Q1 已追问：本题计数为 1，Q2 计数为 0", () => {
    expect(questionFollowupCount(rows, "q1")).toBe(1);
    expect(questionFollowupCount(rows, "q2")).toBe(0);
  });

  it("同题追问过一次后不再追问（每题最多 1 次）", () => {
    expect(
      decideNextAction({ score: 0.3, followupCount: questionFollowupCount(rows, "q1"), isLastQuestion: false }),
    ).toEqual({ action: "next_question" });
  });
});

describe("toAgentRole（C2 回归：followup 轮回答按候选人喂 Agent）", () => {
  it("interviewer → interviewer；candidate / followup → candidate", () => {
    expect(toAgentRole("interviewer")).toBe("interviewer");
    expect(toAgentRole("candidate")).toBe("candidate");
    expect(toAgentRole("followup")).toBe("candidate");
  });
});
