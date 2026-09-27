import type { Question } from "@/lib/ai/schemas";

/**
 * camelCase ↔ snake_case 映射铁律（Task 9 Critical 教训）：
 * questions 表行（skill_tag / followup_anchor）在传给 Agent 前必须映射为领域 Question。
 */
export function rowToQuestion(row: {
  content: string;
  type: string;
  skill_tag: string;
  followup_anchor: string;
}): Question {
  return {
    content: row.content,
    type: row.type as Question["type"],
    skillTag: row.skill_tag,
    followupAnchor: row.followup_anchor,
  };
}

/** 逐题批改章的数据（evaluations 表行的 camelCase 形状） */
export type StampData = {
  scores: { relevance: number; depth: number; structure: number; communication: number };
  starCompleteness: number;
};

export type ChatRole = "interviewer" | "candidate" | "followup";

/** 卷面消息（messages 表行的展示形状，question_id 已换算为题号） */
export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  questionIdx: number | null;
  /** 面试官的追问话术（带「追问」标记） */
  isFollowupQuestion: boolean;
};

/**
 * 从 DB 消息行推导卷面消息（纯函数，供服务端渲染卷面还原）：
 * - question_id → 题号 idx；
 * - 追问话术判定：紧跟在首答（role=candidate）之后、且下一条是该题追问轮回答
 *   （role=followup）的 interviewer 消息。转场话术（含下一题题干）虽也跟在
 *   回答之后，但其后没有追问轮回答，不会被误标。
 */
export function deriveChatMessages(
  rows: { id: string; role: string; content: string; question_id: string | null }[],
  questionIdxById: Map<string, number>,
): ChatMessage[] {
  const roleOf = (r: string): ChatRole =>
    r === "interviewer" || r === "candidate" || r === "followup" ? (r as ChatRole) : "candidate";

  const messages: ChatMessage[] = rows.map((row) => ({
    id: row.id,
    role: roleOf(row.role),
    content: row.content,
    questionIdx: row.question_id ? (questionIdxById.get(row.question_id) ?? null) : null,
    isFollowupQuestion: false,
  }));

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const prev = messages[i - 1];
    const next = messages[i + 1];
    m.isFollowupQuestion =
      m.role === "interviewer" &&
      m.questionIdx !== null &&
      prev?.role === "candidate" &&
      prev.questionIdx === m.questionIdx &&
      next?.role === "followup" &&
      next.questionIdx === m.questionIdx;
  }
  return messages;
}

/** Agent 侧的角色口径：追问轮回答（role=followup）也是候选人的原话（C2） */
export type AgentRole = "interviewer" | "candidate";

export function toAgentRole(role: string): AgentRole {
  return role === "interviewer" ? "interviewer" : "candidate";
}

/**
 * 本题候选人已作答轮数（C1 状态机契约的数据源：「本题未追问过才追问」）。
 * 第 2 轮起即为追问轮回答，所以已答轮数 = 已耗尽的追问预算。
 * 同时数 role=candidate 与 role=followup（后者是追问轮回答的落盘角色，UI 徽章同源）；
 * 兼容旧数据：若历史卷面因计数 bug 出现同题多轮作答，预算视为已耗尽（自愈，不再追问）。
 */
export function candidateTurnCount(
  rows: { role: string; question_id: string | null }[],
  questionId: string,
): number {
  return rows.filter(
    (r) => (r.role === "candidate" || r.role === "followup") && r.question_id === questionId,
  ).length;
}
