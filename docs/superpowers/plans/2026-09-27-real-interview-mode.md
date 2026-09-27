# 真实面试模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有「练习试卷」之外新增「真实面试」模式：综合题型锁定、考官渐进出题（题目不预先存在、历史感知）、回答后可能追问、表现低迷提前收尾。

**Architecture:** 双模式共用一套管线（questions/messages/evaluations/reports、恢复、放弃、语音输入全部复用）。real 模式的差异点收敛在四处：create 跳过出卷、start 现场生成第一题、answer 经终止规则引擎决策、新增 `next-question` 路由现场生成后续题干（60s maxDuration 约束下与 answer 拆分为两个请求，前端自动接续）。练习模式零改动。

**Tech Stack:** Next.js 16 App Router、Supabase（interviews 加 mode 列 + questions 唯一索引）、Vercel AI SDK v7（generateObject 单题 + streamText）、zod v4、vitest 纯函数测试、pnpm。

**Spec:** `docs/plan-real-interview-mode.md`（grill 三轮确认的实现方案，本计划从它论证）。

## Global Constraints

- 包管理只用 **pnpm**；验证 `pnpm vitest run`、`pnpm tsc --noEmit`、`pnpm build`；涉及组件改动另跑 `npx eslint <改动文件>`。
- **练习模式零回归是硬门槛**：现有 125 用例必须全绿；practice 分支代码路径不得改变行为。
- 本仓库是 **Next.js 16**：改路由/配置前先看 `node_modules/next/dist/docs/` 对应文档。
- 中文文案一律进 `lib/copy.ts`（新增 `realMode` 段 + `interviewNew`/`dashboard`/`report` 段扩展）。
- DB 列 snake_case ↔ service/camelCase 映射铁律。
- 500/502 走 `serverErrorResponse(scope, error, status)`；客户端文案通用、日志不含敏感信息。
- 三色油墨纪律：蓝墨 = 进行中/加载/作答；红墨 = 评估与错误；方角 hairline。
- `/api/*` 自兜鉴权（requireUser → 401）。
- **响应头携带中文必须 `encodeURIComponent`**（header 只允许 ISO-8859-1；现有 X-Interview-Scores 全数字不受影响）。
- 终止规则与追问阈值同为**编排器确定性常量**：`REAL_MODE = { target: 10, minBeforeEarlyStop: 5, consecutiveLimit: 3, consecutiveScore: 0.4, averageScore: 0.45, maxQuestions: 15 }`，模型不得决策。
- 综合分定义：单题评估四维（relevance/depth/structure/communication）算术均值（复用 `averageScore`）。
- 不要动 `next-env.d.ts`；每个 Task 结束测试绿 + tsc 零错误 + commit。

---

### Task 1: 0004 迁移 + real-mode 终止规则引擎

**Files:**
- Create: `supabase/migrations/0004_real_mode.sql`
- Create: `lib/orchestrator/real-mode.ts`
- Test: `tests/orchestrator/real-mode.test.ts`

**Interfaces:**
- Consumes: `decideNextAction`、`NextAction`、`FOLLOWUP_THRESHOLD`（`lib/orchestrator/state-machine.ts`）。
- Produces（后续任务逐字使用）:
  - `REAL_MODE` 常量（值见 Global Constraints）
  - `type InterviewMode = "practice" | "real"`
  - `parseMode(v: unknown): InterviewMode`（非 `"real"` 一律 practice）
  - `checkTermination(composites: number[]): { terminate: boolean; reason: "target" | "early" | null }`
  - `decideRealNextAction(params: { score: number; followupCount: number; composites: number[] }): { action: NextAction; endEarly: boolean }`

- [x] **Step 1: 写迁移文件**

`supabase/migrations/0004_real_mode.sql`：

```sql
-- 真实面试模式：interviews 增加模式列；questions 的 (interview_id, idx) 唯一化
-- （渐进出题的并发兜底：重复生成同一题号时第二个 insert 以 23505 失败）
alter table public.interviews
  add column mode text not null default 'practice';
alter table public.interviews
  add constraint interviews_mode_check check (mode in ('practice', 'real'));
create unique index questions_interview_idx_key on public.questions (interview_id, idx);
```

- [x] **Step 2: 写失败测试**

`tests/orchestrator/real-mode.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import {
  REAL_MODE,
  checkTermination,
  decideRealNextAction,
  parseMode,
} from "@/lib/orchestrator/real-mode";

describe("orchestrator/parseMode", () => {
  it("仅 'real' 判为 real，其余（缺省/undefined/乱值）一律 practice", () => {
    expect(parseMode("real")).toBe("real");
    expect(parseMode("practice")).toBe("practice");
    expect(parseMode(undefined)).toBe("practice");
    expect(parseMode(42)).toBe("practice");
  });
});

describe("orchestrator/checkTermination", () => {
  it("答满目标题数 → target 终止", () => {
    const scores = Array.from({ length: REAL_MODE.target }, () => 0.9);
    expect(checkTermination(scores)).toEqual({ terminate: true, reason: "target" });
  });

  it("达到绝对上限 → target 终止（防御性兜底）", () => {
    const scores = Array.from({ length: REAL_MODE.maxQuestions }, () => 0.9);
    expect(checkTermination(scores).reason).toBe("target");
  });

  it("不足下限（< 5 题）即使全低分也不终止", () => {
    expect(checkTermination([0.1, 0.1, 0.1, 0.1])).toEqual({ terminate: false, reason: null });
  });

  it("连续 3 题低于 0.4 且已答 ≥ 5 → early 终止", () => {
    // 前 2 题高分铺垫到 5 题下限，后 3 题连崩
    const scores = [0.9, 0.9, 0.3, 0.2, 0.1];
    expect(checkTermination(scores)).toEqual({ terminate: true, reason: "early" });
  });

  it("连续仅 2 题低分 → 不终止", () => {
    const scores = [0.9, 0.9, 0.9, 0.3, 0.2];
    expect(checkTermination(scores)).toEqual({ terminate: false, reason: null });
  });

  it("累计均值 < 0.45 且已答 ≥ 5 → early 终止（即使无连崩）", () => {
    const scores = [0.45, 0.44, 0.45, 0.44, 0.45]; // 均值 0.446
    expect(checkTermination(scores)).toEqual({ terminate: true, reason: "early" });
  });

  it("均值恰为 0.45 → 不终止（严格小于）", () => {
    const scores = [0.45, 0.45, 0.45, 0.45, 0.45];
    expect(checkTermination(scores)).toEqual({ terminate: false, reason: null });
  });

  it("边界：恰好 5 题且连崩 → early；恰好 5 题健康 → 继续", () => {
    expect(checkTermination([0.9, 0.9, 0.1, 0.1, 0.1]).reason).toBe("early");
    expect(checkTermination([0.9, 0.9, 0.9, 0.9, 0.9])).toEqual({ terminate: false, reason: null });
  });

  it("空数组 → 不终止", () => {
    expect(checkTermination([])).toEqual({ terminate: false, reason: null });
  });
});

describe("orchestrator/decideRealNextAction", () => {
  it("本题该追问时追问优先于终止（与 practice「追问优先于结束」同语义）", () => {
    // 连崩 3 题应 early 终止，但当前题 < 0.65 且未追问 → 先追问
    const r = decideRealNextAction({ score: 0.3, followupCount: 0, composites: [0.9, 0.9, 0.3, 0.2, 0.1] });
    expect(r.action).toEqual({ action: "followup" });
    expect(r.endEarly).toBe(false);
  });

  it("已追问过且命中提前终止 → finish + endEarly", () => {
    const r = decideRealNextAction({ score: 0.3, followupCount: 1, composites: [0.9, 0.9, 0.3, 0.2, 0.1] });
    expect(r.action).toEqual({ action: "finish" });
    expect(r.endEarly).toBe(true);
  });

  it("答满目标 → finish + endEarly=false", () => {
    const r = decideRealNextAction({
      score: 0.9,
      followupCount: 0,
      composites: Array.from({ length: REAL_MODE.target }, () => 0.9),
    });
    expect(r.action).toEqual({ action: "finish" });
    expect(r.endEarly).toBe(false);
  });

  it("健康进行中 → next_question（real 模式永不因索引见底而 finish）", () => {
    const r = decideRealNextAction({ score: 0.9, followupCount: 0, composites: [0.9, 0.9] });
    expect(r.action).toEqual({ action: "next_question" });
  });
});
```

- [x] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run tests/orchestrator/real-mode.test.ts`
Expected: FAIL（模块不存在）

- [x] **Step 4: 实现 lib/orchestrator/real-mode.ts**

```ts
import { FOLLOWUP_THRESHOLD, decideNextAction, type NextAction } from "./state-machine";

/** 真实面试模式的编排器确定性常量（模型不得决策；与 FOLLOWUP_THRESHOLD 同性质） */
export const REAL_MODE = {
  target: 10,
  minBeforeEarlyStop: 5,
  consecutiveLimit: 3,
  consecutiveScore: 0.4,
  averageScore: 0.45,
  maxQuestions: 15,
} as const;

export type InterviewMode = "practice" | "real";

export function parseMode(v: unknown): InterviewMode {
  return v === "real" ? "real" : "practice";
}

export type Termination = { terminate: boolean; reason: "target" | "early" | null };

/**
 * 性能驱动的结束规则（spec 第三节）：
 * - 答满 target（或触达防御性上限）→ target；
 * - 已答 ≥ minBeforeEarlyStop 且（末尾连续 consecutiveLimit 题 < consecutiveScore
 *   或 累计均值 < averageScore）→ early；
 * - 否则继续。
 */
export function checkTermination(composites: number[]): Termination {
  if (composites.length >= REAL_MODE.maxQuestions) return { terminate: true, reason: "target" };
  if (composites.length >= REAL_MODE.target) return { terminate: true, reason: "target" };
  if (composites.length < REAL_MODE.minBeforeEarlyStop) return { terminate: false, reason: null };
  const tail = composites.slice(-REAL_MODE.consecutiveLimit);
  const consecutiveLow =
    tail.length === REAL_MODE.consecutiveLimit && tail.every((s) => s < REAL_MODE.consecutiveScore);
  const avg = composites.reduce((sum, s) => sum + s, 0) / composites.length;
  const avgLow = avg < REAL_MODE.averageScore;
  if (consecutiveLow || avgLow) return { terminate: true, reason: "early" };
  return { terminate: false, reason: null };
}

/**
 * real 模式的行动决策：追问优先于终止（与 practice「追问优先于结束」同语义）；
 * real 模式永不因「索引见底」而 finish——结束只来自 checkTermination。
 */
export function decideRealNextAction(params: {
  score: number;
  followupCount: number;
  composites: number[];
}): { action: NextAction; endEarly: boolean } {
  const followupDue = params.score < FOLLOWUP_THRESHOLD && params.followupCount < 1;
  if (!followupDue) {
    const termination = checkTermination(params.composites);
    if (termination.terminate) {
      return { action: { action: "finish" }, endEarly: termination.reason === "early" };
    }
  }
  return {
    action: decideNextAction({ score: params.score, followupCount: params.followupCount, isLastQuestion: false }),
    endEarly: false,
  };
}
```

- [x] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run tests/orchestrator/real-mode.test.ts && pnpm vitest run`
Expected: PASS（含既有用例零回归）

- [x] **Step 6: Commit**

```bash
git add supabase/migrations/0004_real_mode.sql lib/orchestrator/real-mode.ts tests/orchestrator/real-mode.test.ts
git commit -m "feat(real): 0004 迁移 + 终止规则引擎（性能驱动结束）"
```

---

### Task 2: interviewer 新增 comment 模式（点评不提问）

**Files:**
- Modify: `lib/agents/interviewer.ts:10-43`（InterviewerMode 联合类型与 buildInterviewerMessages）
- Test: `tests/agents/interviewer.test.ts`（追加用例；若文件名不同以 `ls tests/agents/` 实际为准）

**Interfaces:**
- Consumes: 现有 `buildInterviewerMessages` / `streamInterviewer` 签名。
- Produces: `InterviewerMode = "ask" | "followup" | "transition" | "comment"`——real 模式的 answer 路由（Task 5）在 next_question 决策后以 `"comment"` 模式生成「只点评、不提问」的话术。

- [x] **Step 1: 写失败测试**

在 interviewer 测试文件追加：

```ts
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
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/agents/`
Expected: FAIL（"comment" 不在 InterviewerMode 联合类型内，类型错误即失败）

- [x] **Step 3: 实现**

`lib/agents/interviewer.ts` 两处改动：

```ts
type InterviewerMode = "ask" | "followup" | "transition" | "comment";
```

`buildInterviewerMessages` 的模式分支（`else` 之前）插入：

```ts
} else if (mode === "comment") {
  messages.push({
    role: "user",
    content: "简短点评候选人上一题的回答（一两句，不透露评分标准），然后自然收住。不要提出新问题。",
  });
}
```

- [x] **Step 4: 跑测试确认通过 + 全量**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: 全绿

- [x] **Step 5: Commit**

```bash
git add lib/agents/interviewer.ts tests/agents/
git commit -m "feat(real): interviewer comment 模式（点评不提问）"
```

---

### Task 3: 渐进出题 Agent（单题、历史感知）

**Files:**
- Modify: `lib/ai/schemas.ts`（SCHEMA_SHAPE_HINTS 加 question 单题骨架）
- Modify: `lib/ai/json-salvage.ts`（导出单题抢救 `salvageSingleQuestion`）
- Modify: `lib/agents/question-setter.ts`（新增 realtime 出题）
- Test: `tests/ai/json-salvage.test.ts`、`tests/agents/`（question-setter 测试文件追加）

**Interfaces:**
- Consumes: `QuestionSchema`/`Question`、`withSchemaRetry`（opts: shapeHint/salvage）、`getLlmConfig`、`splitInstructions`、`salvageQuestionSet`。
- Produces（Task 4/5 使用）:
  - `generateNextQuestion(userId: string, input: { profile: ResumeProfile; jdText: string; position: string; askedQuestions: { content: string; skillTag: string }[]; lastExchange?: { question: string; answer: string } }): Promise<Question>`

- [x] **Step 1: 写失败测试**

`tests/agents/question-setter.test.ts` 追加（沿用该文件现有 build*Messages 测试风格；导入 `buildRealtimeQuestionMessages`）：

```ts
describe("buildRealtimeQuestionMessages", () => {
  const profile = { summary: "s", skills: [], experiences: [], projects: [] };
  const base = { profile, jdText: "jd", position: "后端", askedQuestions: [] as { content: string; skillTag: string }[] };

  it("系统指令含综合面试官视角与「恰好一道」硬约束", () => {
    const messages = buildRealtimeQuestionMessages(base);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("一道");
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
```

`tests/ai/json-salvage.test.ts` 追加：

```ts
describe("salvageSingleQuestion", () => {
  it("从病态结构收割第一道完整题", () => {
    const q = salvageSingleQuestion('{"questions":[{"content":"题1","type":"project","skillTag":"A","followupAnchor":"F"}]}');
    expect(q?.content).toBe("题1");
  });
  it("收割不到 → undefined", () => {
    expect(salvageSingleQuestion('{"foo":1}')).toBeUndefined();
  });
});
```

- [x] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run tests/agents/ tests/ai/json-salvage.test.ts`
Expected: FAIL（导出不存在）

- [x] **Step 3: 实现**

`lib/ai/schemas.ts` 的 `SCHEMA_SHAPE_HINTS` 追加：

```ts
question:
  '{"content":"题目原文","type":"skill 或 project 或 behavioral 之一","skillTag":"考察点","followupAnchor":"值得追问的具体方向"}',
```

`lib/ai/json-salvage.ts` 末尾追加（复用 `salvageQuestionSet`，注意其返回 `{ questions: Record<string, unknown>[] }`）：

```ts
/** 单题版抢救：收割题目集合后取第一题（渐进出题 Agent 用）；收割不到返回 undefined */
export function salvageSingleQuestion(
  text: string,
): Record<string, string> | undefined {
  const set = salvageQuestionSet(text);
  return set?.questions?.[0];
}
```

`lib/agents/question-setter.ts` 追加（`QuestionSetSchema` 批量出题零改动）：

```ts
/** 渐进出题：真实面试模式下逐题现场生成（历史感知、去重考察点） */
export function buildRealtimeQuestionMessages(input: {
  profile: ResumeProfile;
  jdText: string;
  position: string;
  askedQuestions: { content: string; skillTag: string }[];
  lastExchange?: { question: string; answer: string };
}) {
  const askedList = input.askedQuestions.length
    ? input.askedQuestions.map((q, i) => `${i + 1}. [${q.skillTag}] ${q.content}`).join("\n")
    : "（尚未提问）";
  const lastExchangeBlock = input.lastExchange
    ? `\n候选人最近一轮回答（可顺延其中暴露的点深挖）：\n题目：${input.lastExchange.question}\n回答：${input.lastExchange.answer}`
    : "";
  return [
    {
      role: "system" as const,
      content:
        "你是综合面试官的出题顾问。根据候选人画像、目标 JD 和已问历史，生成恰好一道新面试题。" +
        "硬性要求：①只输出一道题；②考察点（skillTag）与题意不得与已问列表重复；" +
        "③type 从 skill/project/behavioral 中按题意自然选择；④每题必须给出 skillTag 与 followupAnchor。" +
        "\n输出格式：{\"content\":\"…\",\"type\":\"…\",\"skillTag\":\"…\",\"followupAnchor\":\"…\"}，不要嵌套任何包裹键。",
    },
    {
      role: "user" as const,
      content: `目标岗位：${input.position}
目标 JD：
${input.jdText || "（未提供，按岗位常识出题）"}

候选人画像：
${JSON.stringify(input.profile)}

已问题目（不得重复考察点）：
${askedList}${lastExchangeBlock}`,
    },
  ];
}

export async function generateNextQuestion(
  userId: string,
  input: Parameters<typeof buildRealtimeQuestionMessages>[0],
): Promise<Question> {
  const cfg = await getLlmConfig(userId);
  return withSchemaRetry(
    QuestionSchema,
    async (corrective) => {
      const built = buildRealtimeQuestionMessages(input);
      const { instructions, messages } = splitInstructions(
        corrective ? [...built, { role: "user" as const, content: corrective }] : built,
      );
      const { object } = await generateObject({
        model: getModel("question-setter", cfg),
        maxOutputTokens: 4096, // 单题输出极短，无截断风险；与全局调用口径一致
        schema: QuestionSchema,
        instructions,
        messages,
      });
      return object;
    },
    {
      shapeHint: SCHEMA_SHAPE_HINTS.question,
      salvage: salvageSingleQuestion,
    },
  );
}
```

（import 处补：`QuestionSchema`、`Question`、`salvageSingleQuestion`。）

- [x] **Step 4: 跑测试确认通过 + 全量**

Run: `pnpm vitest run && pnpm tsc --noEmit`
Expected: 全绿

- [x] **Step 5: Commit**

```bash
git add lib/ai/schemas.ts lib/ai/json-salvage.ts lib/agents/question-setter.ts tests/
git commit -m "feat(real): 渐进出题 Agent（单题、历史感知、去重考察点）"
```

---

### Task 4: create / start 路由 real 分支 + 画像加载助手

**Files:**
- Create: `lib/interview/profile.ts`
- Modify: `app/api/interview/create/route.ts`
- Modify: `app/api/interview/start/route.ts`
- Test: `tests/interview/profile.test.ts`（若有 mock supabase 先例则跟随；否则只测纯部分 + tsc/build 验证）

**Interfaces:**
- Consumes: Task 1 `parseMode`、Task 3 `generateNextQuestion`、`analyzeResume`（`lib/agents/resume-analyst.ts`）、`ResumeProfile`。
- Produces:
  - `loadInterviewProfile(supabase, userId, resumeId): Promise<ResumeProfile>`——`structured_json` 已存在则直接用，否则 analyzeResume 并回写（写库失败抛错）。
  - create real 行为：`mode="real"` → 跳过出卷，`interview_type: "mixed"`、`question_count: 0`、`status: "ready"`，直接返回 `{ interviewId }`。
  - start real 行为：`question_count === 0` 时现场生成第一题（idx 0）落库并置 `question_count: 1`，其余（幂等分支、in_progress 推进、流式 ask、消息落盘）与 practice 共用。

- [x] **Step 1: 实现 profile 加载助手**

`lib/interview/profile.ts`：

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { analyzeResume } from "@/lib/agents/resume-analyst";
import type { ResumeProfile } from "@/lib/ai/schemas";

type Db = SupabaseClient;

/**
 * 面试用的候选人画像：已结构化直接用；否则现场分析并回写
 * （写库失败仅记日志——画像已拿到，回写失败不影响本场面试）。
 * 与 create practice 分支的区别：回写失败不回滚（这里没有"整卷"要回滚）。
 */
export async function loadInterviewProfile(
  supabase: Db,
  userId: string,
  resumeId: string,
): Promise<ResumeProfile> {
  const { data: resume, error } = await supabase
    .from("resumes")
    .select("raw_text, structured_json")
    .eq("id", resumeId)
    .eq("user_id", userId)
    .single();
  if (error || !resume) throw new Error(error?.message ?? "resume not found");
  const existing = (resume.structured_json as ResumeProfile | null) ?? null;
  if (existing) return existing;
  const profile = await analyzeResume(userId, resume.raw_text);
  const { error: writeError } = await supabase
    .from("resumes")
    .update({ structured_json: profile })
    .eq("id", resumeId);
  if (writeError) {
    console.error("[interview/profile] writeback structured_json failed:", writeError.message);
  }
  return profile;
}
```

- [x] **Step 2: create 路由 real 分支**

`app/api/interview/create/route.ts`：body 类型加 `mode?: unknown`；`clampQuestionCount` 之后加：

```ts
const mode = parseMode(body.mode);
```

interview insert 改为：

```ts
    .insert({
      user_id: user.id,
      resume_id: resume.id,
      position: body.position,
      jd_text: body.jdText ?? null,
      interview_type: mode === "real" ? "mixed" : body.interviewType,
      question_count: mode === "real" ? 0 : count,
      status: mode === "real" ? "ready" : "generating",
      mode,
    })
```

insert 成功后：

```ts
  // 真实面试：不出卷不建题库，第一题由 start 现场生成（考官「翻档案」的开场感）
  if (mode === "real") {
    return NextResponse.json({ interviewId: interview.id });
  }
```

practice 路径（try 块内全部逻辑）零改动。import 处补 `parseMode`。

- [x] **Step 3: start 路由 real 分支**

`app/api/interview/start/route.ts`：select 加 `mode, resume_id, position, jd_text`；在「加载当前题」之前插入 real 首题生成：

```ts
  // 真实面试：首题现场生成（ready 且题库为空时）。并发双开场靠 questions(interview_id, idx)
  // 唯一索引兜底：后到方 insert 23505 后改读已有行。
  let currentQuestion = question; // 见下方重构说明
```

具体重构：把现有「加载当前题」与后续流程之间插入——

```ts
  if (interview.mode === "real" && !question) {
    if (interview.status !== "ready") {
      return NextResponse.json({ error: COPY.api.questionNotFound }, { status: 404 });
    }
    const profile = await loadInterviewProfile(supabase, user.id, interview.resume_id);
    const generated = await generateNextQuestion(user.id, {
      profile,
      jdText: interview.jd_text ?? "",
      position: interview.position,
      askedQuestions: [],
    });
    const { data: inserted, error: insertError } = await supabase
      .from("questions")
      .insert({
        interview_id: interviewId,
        idx: 0,
        content: generated.content,
        type: generated.type,
        skill_tag: generated.skillTag,
        followup_anchor: generated.followupAnchor,
      })
      .select("*")
      .single();
    // 唯一索引兜底：并发双开场时后到方读已有行
    const row = inserted ?? (
      await supabase
        .from("questions")
        .select("*")
        .eq("interview_id", interviewId)
        .eq("idx", 0)
        .single()
    ).data;
    if (!row) {
      return serverErrorResponse("[interview/start] insert first question failed:", insertError?.message ?? "no row", 500);
    }
    const { error: countError } = await supabase
      .from("interviews")
      .update({ question_count: 1 })
      .eq("id", interviewId);
    if (countError) {
      return serverErrorResponse("[interview/start] update question_count failed:", countError.message, 500);
    }
    question = row;
  }
```

（现有 `const { data: question, ... }` 声明改为 `let question`；import 处补 `generateNextQuestion`、`loadInterviewProfile`。practice 路径：`mode !== "real" && !question` 仍走原 404。）

- [x] **Step 4: 验证 + Commit**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: 全绿（practice 行为零变化）

```bash
git add lib/interview/profile.ts app/api/interview/create/route.ts app/api/interview/start/route.ts
git commit -m "feat(real): create/start real 分支（不出卷、首题现场生成）"
```

---

### Task 5: answer real 分支 + next-question 路由

**Files:**
- Create: `lib/interview/scores.ts`
- Create: `app/api/interview/[id]/next-question/route.ts`
- Modify: `app/api/interview/answer/route.ts`
- Test: `tests/interview/scores.test.ts`（若 mock 成本高则 tsc/build 验证；纯逻辑已由 Task 1 覆盖）

**Interfaces:**
- Consumes: Task 1 `decideRealNextAction`/`checkTermination`；Task 2 `"comment"` 模式；Task 3 `generateNextQuestion`；Task 4 `loadInterviewProfile`；`averageScore`；`teeWithPersist`；`rowToQuestion`。
- Produces:
  - `loadCompositeScores(supabase, interviewId): Promise<number[]>`——按题序返回各题综合分（缺评估的题跳过）。
  - next-question 响应头 `X-Question-Meta`：`encodeURIComponent(JSON.stringify({ idx, skillTag, content }))`；body = 面试官「ask」流。重复生成（23505 兜底）时返回 JSON `{ duplicate: true, meta }` 而非流。
  - answer real 响应：`next_question` 时头 `X-Interview-Next: generate`（practice 不带）；`finish` 且提前结束时头 `X-Interview-End: early`。

- [x] **Step 1: 实现分数加载助手**

`lib/interview/scores.ts`：

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { averageScore, type Dimension } from "@/lib/orchestrator/state-machine";

/** 按题序返回各题综合分（四维均值；缺评估的题跳过）。终止规则引擎的输入。 */
export async function loadCompositeScores(
  supabase: SupabaseClient,
  interviewId: string,
): Promise<number[]> {
  const { data: qRows, error: qError } = await supabase
    .from("questions")
    .select("id")
    .eq("interview_id", interviewId)
    .order("idx");
  if (qError) throw new Error(qError.message);
  const ids = (qRows ?? []).map((q) => q.id as string);
  if (ids.length === 0) return [];
  const { data: eRows, error: eError } = await supabase
    .from("evaluations")
    .select("question_id, scores")
    .in("question_id", ids);
  if (eError) throw new Error(eError.message);
  const byQuestion = new Map(
    (eRows ?? []).map((e) => [e.question_id as string, e.scores as Record<Dimension, number>]),
  );
  return ids
    .map((id) => byQuestion.get(id))
    .filter((s): s is Record<Dimension, number> => !!s)
    .map((s) => averageScore(s));
}
```

- [x] **Step 2: answer 路由 real 分支**

`app/api/interview/answer/route.ts`：interview select 加 `mode`；import 补 `decideRealNextAction`、`loadCompositeScores`。

决策块（现有 `const next = decideNextAction({...})`）改为：

```ts
  // 编排器确定性决策（唯一事实来源）。real 模式：追问优先于终止；结束只来自终止规则引擎。
  let next: ReturnType<typeof decideNextAction>;
  let endEarly = false;
  if (interview.mode === "real") {
    const composites = await loadCompositeScores(supabase, interviewId);
    const real = decideRealNextAction({
      score: averageScore(evaluation.scores),
      followupCount,
      composites,
    });
    next = real.action;
    endEarly = real.endEarly;
  } else {
    next = decideNextAction({
      score: averageScore(evaluation.scores),
      followupCount,
      isLastQuestion: idx === interview.question_count - 1,
    });
  }
```

话术模式选择（现有 `next.action === "followup" ? "followup" : "transition"`）改为：

```ts
    const interviewerMode =
      next.action === "followup"
        ? "followup"
        : next.action === "finish"
          ? "transition"
          : interview.mode === "real"
            ? "comment"
            : "transition";
```

real 的 `next_question` 分支**不加载下一题**（题还不存在），现有「if next.action === 'next_question' 加载 idx+1」块加守卫：

```ts
  if (next.action === "next_question" && interview.mode !== "real") {
```

响应头追加（practice 零变化——两个新头只在 real 且对应条件下出现）：

```ts
      ...(interview.mode === "real" && next.action === "next_question"
        ? { "X-Interview-Next": "generate" }
        : {}),
      ...(endEarly ? { "X-Interview-End": "early" } : {}),
```

- [x] **Step 3: 实现 next-question 路由**

`app/api/interview/[id]/next-question/route.ts`：

```ts
import { NextResponse } from "next/server";
import { createSupabaseServerClient, requireUser } from "@/lib/supabase/server";
import { generateNextQuestion } from "@/lib/agents/question-setter";
import { loadInterviewProfile } from "@/lib/interview/profile";
import { loadCompositeScores } from "@/lib/interview/scores";
import { rowToQuestion } from "@/lib/interview/mappers";
import { checkTermination } from "@/lib/orchestrator/real-mode";
import { teeWithPersist } from "@/lib/interview/stream-persist";
import { COPY } from "@/lib/copy";
import { serverErrorResponse } from "@/lib/api/server-error";

export const maxDuration = 300;

/** 真实面试专用：现场生成下一题并流式题干。practice 调用 → 409。 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: interviewId } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: COPY.api.unauthorized }, { status: 401 });
  }

  const supabase = await createSupabaseServerClient();
  const { data: interview, error: interviewError } = await supabase
    .from("interviews")
    .select("id, status, current_question_index, mode, resume_id, position, jd_text")
    .eq("id", interviewId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (interviewError) {
    return serverErrorResponse("[interview/next-question] load interview failed:", interviewError.message, 500);
  }
  if (!interview) return NextResponse.json({ error: COPY.interview.notFound }, { status: 404 });
  if (interview.mode !== "real" || interview.status !== "in_progress") {
    return NextResponse.json({ error: COPY.interview.notInProgress }, { status: 409 });
  }

  // 双重检查终止规则（answer 已查过一次；这里是竞态兜底——已该收尾时不再生成新题）
  const composites = await loadCompositeScores(supabase, interviewId);
  if (checkTermination(composites).terminate) {
    return NextResponse.json({ error: COPY.interview.notInProgress }, { status: 409 });
  }

  const idx = interview.current_question_index;
  const nextIdx = idx + 1;

  // 竞态/重试兜底：该题已存在（唯一索引）→ 不重复生成不重复落盘
  const { data: existing } = await supabase
    .from("questions")
    .select("*")
    .eq("interview_id", interviewId)
    .eq("idx", nextIdx)
    .maybeSingle();
  if (existing) {
    const meta = { idx: nextIdx, skillTag: existing.skill_tag, content: existing.content };
    return NextResponse.json(
      { duplicate: true, meta },
      { headers: { "X-Question-Meta": encodeURIComponent(JSON.stringify(meta)) } },
    );
  }

  let generated;
  try {
    const profile = await loadInterviewProfile(supabase, user.id, interview.resume_id);
    const { data: askedRows } = await supabase
      .from("questions")
      .select("content, skill_tag")
      .eq("interview_id", interviewId)
      .order("idx");
    // 最近一轮问答（顺延候选人暴露的点深挖）：最后一条候选人消息
    const { data: lastCandidate } = await supabase
      .from("messages")
      .select("content")
      .eq("interview_id", interviewId)
      .in("role", ["candidate", "followup"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    generated = await generateNextQuestion(user.id, {
      profile,
      jdText: interview.jd_text ?? "",
      position: interview.position,
      askedQuestions: (askedRows ?? []).map((q) => ({ content: q.content, skillTag: q.skill_tag })),
      lastExchange: lastCandidate
        ? { question: (askedRows ?? [])[idx]?.content ?? "", answer: lastCandidate.content }
        : undefined,
    });
  } catch (e) {
    return serverErrorResponse("[interview/next-question] generate question failed:", e, 502);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("questions")
    .insert({
      interview_id: interviewId,
      idx: nextIdx,
      content: generated.content,
      type: generated.type,
      skill_tag: generated.skillTag,
      followup_anchor: generated.followupAnchor,
    })
    .select("*")
    .single();
  if (insertError) {
    // 唯一索引兜底：并发重试时后到方读已有行，返回 duplicate 而非报错
    if (insertError.code === "23505") {
      const { data: row } = await supabase
        .from("questions")
        .select("*")
        .eq("interview_id", interviewId)
        .eq("idx", nextIdx)
        .single();
      if (row) {
        const meta = { idx: nextIdx, skillTag: row.skill_tag, content: row.content };
        return NextResponse.json(
          { duplicate: true, meta },
          { headers: { "X-Question-Meta": encodeURIComponent(JSON.stringify(meta)) } },
        );
      }
    }
    return serverErrorResponse("[interview/next-question] insert question failed:", insertError.message, 500);
  }

  const { error: countError } = await supabase
    .from("interviews")
    .update({ question_count: nextIdx + 1 })
    .eq("id", interviewId);
  if (countError) {
    return serverErrorResponse("[interview/next-question] update question_count failed:", countError.message, 500);
  }

  let result: Awaited<ReturnType<typeof import("@/lib/agents/interviewer").streamInterviewer>>;
  try {
    result = await (await import("@/lib/agents/interviewer")).streamInterviewer(user.id, "ask", {
      question: rowToQuestion(inserted),
      history: [],
      followupText: null,
    });
  } catch (e) {
    return serverErrorResponse("[interview/next-question]", e, 502);
  }

  const textStreamForClient = teeWithPersist(
    result.textStream,
    async (full) => {
      const { error } = await supabase.from("messages").insert({
        interview_id: interviewId,
        question_id: inserted.id,
        role: "interviewer",
        content: full,
      });
      if (error) throw new Error(error.message);
    },
    "interview/next-question",
  );

  const meta = { idx: nextIdx, skillTag: inserted.skill_tag, content: inserted.content };
  return new Response(textStreamForClient, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Interview-Action": "ask",
      "X-Question-Meta": encodeURIComponent(JSON.stringify(meta)),
    },
  });
}
```

> 实施注：顶部的动态 `await import` 写法仅为展示依赖，实现时改为顶部静态 import `streamInterviewer` 与 `rowToQuestion`（现有路由的常规写法）。

- [x] **Step 4: 验证 + Commit**

Run: `pnpm vitest run && pnpm tsc --noEmit && pnpm build`
Expected: 全绿

```bash
git add lib/interview/scores.ts app/api/interview/answer/route.ts "app/api/interview/[id]/next-question/route.ts"
git commit -m "feat(real): answer 终止决策 + next-question 渐进出题路由"
```

---

### Task 6: 创建页模式卡

**Files:**
- Modify: `app/interview/new/page.tsx`
- Modify: `lib/copy.ts`（interviewNew 段追加键）

**Interfaces:**
- Consumes: Task 4 的 create real 语义。
- Produces: body 带 `mode`（`"real"` 或不传）；real 模式跳过 PrintingPanel（create 是即时的）。

- [x] **Step 1: copy.ts interviewNew 段追加键**

```ts
    modeLabel: "面试模式",
    modePracticeName: "练习试卷",
    modePracticeDesc: "自选题型与题量，一次性出卷，逐题作答",
    modeRealName: "真实面试",
    modeRealDesc: "综合题型 · 目标 10 题 · 考官按你的回答渐进出题，表现低迷会提前收尾",
```

- [x] **Step 2: 实现模式卡**

`app/interview/new/page.tsx`：

1. state 追加 `const [mode, setMode] = useState<"practice" | "real">("practice");`
2. 卷首之后、第一步 section 之前插入模式卡（样式对齐简历卡 radiogroup 的选中态：选中 `border-ink bg-ink/[0.04]`）：

```tsx
              {/* 第零步 · 定模式 */}
              <section className="rounded-none border border-ink/15 bg-transparent">
                <StepHeader label={copy.modeLabel} title={copy.modeLabel} hint={copy.modeRealDesc} />
                <div className="grid grid-cols-1 gap-3 px-6 py-6 sm:grid-cols-2">
                  {(
                    [
                      { value: "practice", name: copy.modePracticeName, desc: copy.modePracticeDesc },
                      { value: "real", name: copy.modeRealName, desc: copy.modeRealDesc },
                    ] as const
                  ).map((option) => {
                    const selected = mode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={selected}
                        disabled={busy}
                        onClick={() => setMode(option.value)}
                        className={`rounded-none border px-4 py-4 text-left transition-colors focus-visible:border-ink-blue focus-visible:outline-none ${
                          selected ? "border-ink bg-ink/[0.04]" : "border-ink/15 hover:border-ink/40"
                        }`}
                      >
                        <p className="font-heading text-lg font-semibold">{option.name}</p>
                        <p className="mt-1.5 text-xs leading-5 text-pencil">{option.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
```

3. 「第三步 · 定题」section 整体包进 `{mode === "practice" && ( ... )}`（real 模式隐藏题型/题数）。
4. `create()`：body 追加 `mode`；real 分支不进 printing 态（create 即时返回）：

```ts
    setError(null);
    if (mode === "practice") setPhase("printing");
```

body JSON 追加 `mode,`（practice 也显式传，服务端 parseMode 容错）。

- [x] **Step 3: 验证 + Commit**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm build && npx eslint app/interview/new/page.tsx`
Expected: 全绿

```bash
git add app/interview/new/page.tsx lib/copy.ts
git commit -m "feat(real): 创建页双模式卡（真实面试锁综合、隐藏题型题数）"
```

---

### Task 7: 面试页接续（自动生成下一题）+ 进度展示

**Files:**
- Modify: `app/interview/[id]/page.tsx`（select 加 mode、传 prop）
- Modify: `components/interview/chat-stream.tsx`
- Modify: `lib/copy.ts`（新增 realMode 段）

**Interfaces:**
- Consumes: Task 5 的响应头（`X-Interview-Next`、`X-Question-Meta`、`X-Interview-End`）与 409 语义；`REAL_MODE.target`。
- Produces: real 模式完整前端体验（自动接续、加载态、重试、目标进度）。

- [x] **Step 1: copy.ts 新增 realMode 段**

```ts
  realMode: {
    loadingNext: "考官翻阅你的档案……",
    nextFailed: "下一题生成失败",
    retry: "继续",
    earlyEndTemplate: "提前结束 · 实答 {n} 题",
  },
```

- [x] **Step 2: 面试页传 mode**

`app/interview/[id]/page.tsx`：interview select 加 `mode`；`<ChatStream … mode={interview.mode} />`（TS 上 mode 为 string，传 `interview.mode === "real" ? "real" : "practice"`）。

- [x] **Step 3: ChatStream 改造**

`components/interview/chat-stream.tsx`（import 处补 `REAL_MODE`、`useSyncExternalStore` 已在）：

1. props 追加 `mode: "practice" | "real"`；questions 改为本地 state：

```ts
  const [questionList, setQuestionList] = useState(props.questions);
```

（文件内原 `questions` 的三处只读使用——`questionCount`、`currentQuestion`、渲染——替换如下。）

2. 派生量（`safeIndex` 附近）：

```ts
  const targetCount = props.mode === "real" ? REAL_MODE.target : questionList.length;
  // 渲染与提交用「实际已生成的题」；进度与答题卡用 targetCount（real）或 questionList.length（practice）
  const pendingGeneration =
    props.mode === "real" && status === "in_progress" && currentIndex >= questionList.length && !ended;
```

`questionCount` 的三处现有使用替换：QuestionProgress 传 `questionCount={targetCount}`；移动端 Progress 的除数用 `targetCount`；`safeIndex` 改为 `Math.min(currentIndex, targetCount - 1)`（real 下允许指向尚未生成的题——此时 `currentQuestion` 为 undefined，题干区自动隐藏，正好是加载态）。

3. 新 state：`const [nextError, setNextError] = useState<string | null>(null);` `inputDisabled` 追加 `|| pendingGeneration`。
4. 自动接续 effect（放在现有开场 effect 之后）：

```ts
  const nextStartedRef = useRef(false);
  useEffect(() => {
    if (props.mode !== "real" || status !== "in_progress") return;
    if (currentIndex < questionList.length) return;
    if (nextStartedRef.current) return;
    nextStartedRef.current = true;
    void fetchNextQuestion().finally(() => {
      nextStartedRef.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.mode, status, currentIndex, questionList.length]);
```

5. `fetchNextQuestion`（放在 `startInterview` 之后）：

```ts
  /** 真实面试：现场生成下一题并流式提问。409 = 已终结（拉状态收口）或竞态兜底。 */
  async function fetchNextQuestion() {
    setPendingGeneration(true);
    setNextError(null);
    try {
      const res = await fetch(`/api/interview/${interviewId}/next-question`, { method: "POST" });
      if (res.status === 409) {
        const statusRes = await fetch(`/api/interview/${interviewId}/status`);
        if (statusRes.ok) {
          const s = (await statusRes.json()) as { status: InterviewStatus };
          if (s.status === "completed") {
            setStatus("completed");
            window.setTimeout(() => router.push(`/report/${interviewId}`), 1600);
            return;
          }
        }
        setNextError(COPY.realMode.nextFailed);
        return;
      }
      if (!res.ok) {
        setNextError(COPY.realMode.nextFailed);
        return;
      }
      const contentType = res.headers.get("Content-Type") ?? "";
      const metaRaw = res.headers.get("X-Question-Meta");
      let meta: { idx: number; skillTag: string; content: string } | null = null;
      try {
        meta = metaRaw ? (JSON.parse(decodeURIComponent(metaRaw)) as typeof meta) : null;
      } catch {
        meta = null;
      }
      if (!meta) {
        setNextError(COPY.realMode.nextFailed);
        return;
      }
      if (contentType.includes("application/json")) {
        // duplicate 兜底：题已存在（竞态/重试），补全列表即可，流已在库
        setQuestionList((prev) =>
          prev.some((_, i) => i === meta!.idx) ? prev : [...prev, { content: meta!.content, skillTag: meta!.skillTag }],
        );
        setCurrentIndex(meta.idx);
        return;
      }
      setQuestionList((prev) => [...prev, { content: meta.content, skillTag: meta.skillTag }]);
      setCurrentIndex(meta.idx);
      await streamIntoBubble(res, { questionIdx: meta.idx, isFollowupQuestion: false });
    } catch {
      setNextError(COPY.realMode.nextFailed);
    } finally {
      setPendingGeneration(false);
    }
  }
```

（`setPendingGeneration` 需为 state：`const [pendingGeneration, setPendingGeneration] = useState(false);` 并把第 2 点的派生 `pendingGeneration` 更名为 `shouldGenerate`——即：派生布尔 `shouldGenerate` 驱动 effect，state `pendingGeneration` 驱动 UI 禁用与加载态。）

6. 加载/失败 UI：作答流 `<ol>` 内、`{isCompleted && …}` 之前追加：

```tsx
          {pendingGeneration && (
            <li className="flex justify-center py-4">
              <p className="mirror-breathe font-mono text-xs tracking-[0.35em] text-ink-blue">
                {COPY.realMode.loadingNext}
              </p>
            </li>
          )}
          {nextError && (
            <li className="flex justify-center py-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-none border-ink/25 text-ink/60 hover:text-ink"
                onClick={() => void fetchNextQuestion()}
              >
                {COPY.realMode.retry}
              </Button>
            </li>
          )}
```

（`mirror-breathe` keyframes 已由 question-progress 的 BREATHE_CSS 提供——若 ChatStream 作用域内不存在，把该 `<style>` 块复制进 ChatStream 渲染树；已有 `mirror-print-pulse`/`mirror-stamp-in` 先例。）

7. 提交守卫：`submitAnswer` 开头追加 `if (props.mode === "real" && !questionList[safeIndex]) return;`。

- [x] **Step 4: 验证 + Commit**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm build && npx eslint components/interview/ "app/interview/[id]/page.tsx"`
Expected: 全绿

```bash
git add "app/interview/[id]/page.tsx" components/interview/chat-stream.tsx lib/copy.ts
git commit -m "feat(real): 面试页自动接续渐进出题 + 目标进度展示"
```

---

### Task 8: Dashboard / 报告页模式徽章与提前结束标注

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/report/[id]/page.tsx`
- Modify: `lib/copy.ts`（dashboard/report 段各追加键）

**Interfaces:**
- Consumes: Task 1 `REAL_MODE.target`；DB `mode`、`question_count` 列。
- Produces: 徽章逻辑（可推导，不落库）：`mode === "real" && status === "completed" && question_count < REAL_MODE.target` → 提前结束。

- [x] **Step 1: copy.ts 追加键**

dashboard 段：

```ts
    modeReal: "真实面试",
    modePractice: "练习试卷",
    earlyEndTemplate: "提前结束 · {n} 题",
```

report 段（同名键，值一致）：

```ts
    modeReal: "真实面试",
    modePractice: "练习试卷",
    earlyEndTemplate: "提前结束 · 实答 {n} 题 / 目标 10",
```

- [x] **Step 2: Dashboard**

`app/dashboard/page.tsx`：select 追加 `mode, question_count`；`InterviewRow` 类型同步。行内 status 徽章旁追加：

```tsx
<span
  className={`border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.2em] ${
    row.mode === "real" ? "border-ink-red/60 text-ink-red" : "border-ink/30 text-ink/60"
  }`}
>
  {row.mode === "real" ? copy.modeReal : copy.modePractice}
</span>
{row.mode === "real" && row.status === "completed" && row.question_count < REAL_MODE.target && (
  <span className="border border-ink/30 px-1.5 py-0.5 font-mono text-[10px] tracking-[0.2em] text-ink/60">
    {copy.earlyEndTemplate.replace("{n}", String(row.question_count))}
  </span>
)}
```

（插入点 = 现有 `statusStamp(...)` 徽章渲染处旁；`row` 为该处实际变量名。红墨描边 = 真实面试的「评估」语义；practice 保持灰。）

- [x] **Step 3: 报告页**

`app/report/[id]/page.tsx`：interview select 追加 `mode, question_count`；卷首区域（position 标题附近）追加同一组徽章（earlyEnd 用 report 段模板）。片段同 Step 2（`row` → `interview`，模板用 report 版）。

- [x] **Step 4: 验证 + Commit**

Run: `pnpm tsc --noEmit && pnpm vitest run && pnpm build`
Expected: 全绿

```bash
git add app/dashboard/page.tsx "app/report/[id]/page.tsx" lib/copy.ts
git commit -m "feat(real): 列表与报告的模式徽章、提前结束标注"
```

---

### Task 9: 全量验证 + 交付收尾

**Files:**
- Modify: `docs/superpowers/plans/2026-09-27-real-interview-mode.md`（勾账）
- Modify: `README.md`（如需补充 0004 迁移说明至 env/初始化小节）

- [x] **Step 1: 机器验证**

```bash
pnpm vitest run && pnpm tsc --noEmit && pnpm build
grep -rn "window.confirm\|window.alert" app components lib | grep -v "替代 window"
```

Expected: 全绿；grep 仅既有豁免。确认 practice 零回归：现有 125 用例 + 本计划新增用例全部通过。

- [x] **Step 2: 用户手动步骤清单（写进报告，不写 README 步骤节）**

1. Supabase SQL Editor 执行 `supabase/migrations/0004_real_mode.sql`；
2. 创建页选「真实面试」卡 → 岗位/JD → 开考；
3. 冒烟路径：正常答满 10 题收尾 / 故意连答 5 题极短回答触发提前收尾 / 中途刷新验证恢复 / 追问轮正常 / 语音输入可用 / Dashboard 与报告徽章正确。

- [x] **Step 3: 计划勾账 + Commit**

把本计划 Task 1-9 的 `- [ ]` 改为 `- [x]`。

```bash
git add -A
git commit -m "docs(real): 真实面试模式交付收尾"
```

（push 由控制器在终审后统一执行。）

---

## Self-Review 记录

- **Spec 覆盖**：渐进生成=T3/T5；终止规则=T1/T5；追问语义不变（real 复用 decideNextAction 的 followup 分支，T1 测试锁定「追问优先于终止」）；自动接续=T7；模式卡=T6；徽章=T8；管线复用=create/start/answer 的 practice 分支零改动（T4/T5 显式守卫）；迁移=T1。spec 第七节「答题卡圆点按目标 10 固定渲染」=T7 displayCount。
- **已知取舍**：① start/next-question 的并发双开场依赖客户端守卫 + 唯一索引 23505 兜底，极端竞态下第二个标签页可能看到 404/重复气泡——与 practice 同源风险，不扩散修复（台账记录）；② real 模式 answer 推进 `current_question_index` 时题目行尚未存在，恢复路径靠 ChatStream 的 `currentIndex >= questionList.length` 派生（确定性，无新状态）；③ 路由不写单测（仓库先例：路由薄、纯函数下沉 lib），practice 零回归由全量测试保证。
- **类型一致性**：`InterviewMode`/`parseMode`（T1）→ T4 路由；`generateNextQuestion` 签名（T3）→ T4/T5；`checkTermination`/`decideRealNextAction`（T1）→ T5；`X-Question-Meta` 的 `{idx, skillTag, content}` 形状（T5）→ T7 消费；`REAL_MODE.target`（T1）→ T7/T8。
